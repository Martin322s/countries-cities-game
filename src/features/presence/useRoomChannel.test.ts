import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { RoomId } from '@/domain';
import { applyMemberRowChange, type MemberRowChange } from '@/features/rooms/api/memberCache';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import type { RoomMember } from '@/features/rooms/api/roomsApi';
import type { Database } from '@/shared/lib/database.types';

import { applyRoomPlayerChange, isPostgresChangesReady } from './useRoomChannel';

type RoomPlayerRow = Database['public']['Tables']['room_players']['Row'];

const roomId = 'room-1' as RoomId;
const row = (id: string, name: string, joinedAt: string): MemberRowChange => ({
  player_id: id,
  display_name: name,
  joined_at: joinedAt,
  last_seen_at: joinedAt,
  left_at: null,
});
const insert = (change: MemberRowChange) =>
  ({
    eventType: 'INSERT',
    new: change,
    old: {},
  }) as unknown as RealtimePostgresChangesPayload<RoomPlayerRow>;

describe('lobby roster realtime merge', () => {
  it('never loses a join that arrives while a roster refetch is in flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = roomKeys.members(roomId);
    const stoyan = row('a', 'Стоян', '2026-01-01T10:00:00Z');
    const desi = row('b', 'Деси', '2026-01-01T10:01:00Z');
    let server: MemberRowChange[] = [stoyan];
    // The server read is a snapshot taken when the request starts, answered later.
    const queryFn = async (): Promise<RoomMember[]> => {
      const snapshot = server.reduce<RoomMember[]>(applyMemberRowChange, []);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return snapshot;
    };
    const observer = new QueryObserver(queryClient, { queryKey: key, queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => {
      expect(queryClient.getQueryData<RoomMember[]>(key)).toHaveLength(1);
    });

    // A refetch (window focus, reconnect gap-fill…) starts with the old roster…
    void queryClient.refetchQueries({ queryKey: key });
    // …then Деси joins, and her realtime event arrives before that refetch returns.
    server = [stoyan, desi];
    applyRoomPlayerChange(queryClient, roomId, insert(desi));

    // Bounded wait (not a fixed sleep): the reconciling refetch must end with both.
    await vi.waitFor(() => {
      expect(queryClient.isFetching({ queryKey: key })).toBe(0);
      expect(queryClient.getQueryData<RoomMember[]>(key)?.map((m) => m.displayName)).toEqual([
        'Стоян',
        'Деси',
      ]);
    });
    unsubscribe();
  });

  it('merges a join directly into the cache when nothing is being fetched', () => {
    const queryClient = new QueryClient();
    const key = roomKeys.members(roomId);
    queryClient.setQueryData<RoomMember[]>(
      key,
      [row('a', 'Стоян', '2026-01-01T10:00:00Z')].reduce<RoomMember[]>(applyMemberRowChange, []),
    );
    applyRoomPlayerChange(queryClient, roomId, insert(row('b', 'Деси', '2026-01-01T10:01:00Z')));
    expect(queryClient.getQueryData<RoomMember[]>(key)).toHaveLength(2);
  });
});

describe('postgres change stream readiness', () => {
  it('recognises the server confirmation that changes are streaming', () => {
    expect(
      isPostgresChangesReady({
        message: 'Subscribed to PostgreSQL',
        status: 'ok',
        extension: 'postgres_changes',
        channel: 'room:1',
      }),
    ).toBe(true);
    expect(isPostgresChangesReady({ status: 'error', extension: 'postgres_changes' })).toBe(false);
    expect(isPostgresChangesReady({ status: 'ok', extension: 'presence' })).toBe(false);
    expect(isPostgresChangesReady(null)).toBe(false);
  });
});
