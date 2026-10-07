import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import type { PlayerId, RoomId } from '@/domain';
import { applyMemberRowChange, type MemberRowChange } from '@/features/rooms/api/memberCache';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import { toRoomSummary, type RoomMember, type RoomSummary } from '@/features/rooms/api/roomsApi';
import type { Database } from '@/shared/lib/database.types';
import { getSupabaseClient } from '@/shared/lib/supabase';
import { reportError } from '@/shared/lib/telemetry';

import type { ChannelStatus } from './connectionState';

type RoomRow = Database['public']['Tables']['rooms']['Row'];
type RoomPlayerRow = Database['public']['Tables']['room_players']['Row'];

export interface RoomChannelState {
  status: ChannelStatus;
  /** True once the channel has been subscribed at least once (distinguishes reconnects). */
  everConnected: boolean;
  /** Players currently present on the room channel (Realtime Presence keys). */
  onlinePlayerIds: ReadonlySet<PlayerId>;
}

const INITIAL_STATE: RoomChannelState = {
  status: 'connecting',
  everConnected: false,
  onlinePlayerIds: new Set(),
};

export const roomTopic = (roomId: RoomId) => `room:${roomId}`;

export function applyRoomPlayerChange(
  queryClient: QueryClient,
  roomId: RoomId,
  payload: RealtimePostgresChangesPayload<RoomPlayerRow>,
): void {
  const key = roomKeys.members(roomId);
  // If a roster fetch is already in flight, its (older) snapshot would land after this
  // event and overwrite it — e.g. several players joining within a second while a
  // focus/reconnect refetch runs. Invalidating cancels that fetch and reads again after
  // the change, so no join is ever lost.
  if (
    payload.eventType === 'DELETE' ||
    !queryClient.getQueryData(key) ||
    queryClient.isFetching({ queryKey: key }) > 0
  ) {
    void queryClient.invalidateQueries({ queryKey: key });
    return;
  }
  const row: MemberRowChange = payload.new;
  queryClient.setQueryData<RoomMember[]>(key, (members) =>
    members ? applyMemberRowChange(members, row) : members,
  );
}

function applyRoomChange(
  queryClient: QueryClient,
  payload: RealtimePostgresChangesPayload<RoomRow>,
): void {
  if (payload.eventType !== 'UPDATE') {
    void queryClient.invalidateQueries({ queryKey: roomKeys.all });
    return;
  }
  const summary: RoomSummary = toRoomSummary(payload.new);
  queryClient.setQueryData(roomKeys.byCode(summary.code), summary);
  // Phase, round and host changes all affect the game read model.
  void queryClient.invalidateQueries({ queryKey: roomKeys.game(summary.id) });
  // results_revision bumps on every host invalidation/restore → refetch results.
  void queryClient.invalidateQueries({ queryKey: roomKeys.resultsOf(summary.id) });
}

/**
 * One private Realtime channel per room (`room:<id>`), authorized by RLS on
 * realtime.messages for active members only. It carries:
 *  - Postgres Changes for `rooms` and `room_players` → merged into the query cache
 *  - Postgres Changes for `answer_sheets` / `ready_checks` (status only) → game refetch
 *    (answers and rounds.letter are deliberately NOT published)
 *  - Postgres Changes for `visibility_events` → fair-play activity refetch
 *  - Presence keyed by player id → who is connected right now
 *
 * supabase-js rejoins the channel automatically after socket drops; each successful
 * (re)subscribe refetches room data to fill any gap of missed events.
 */
export function useRoomChannel(roomId: RoomId | null, playerId: PlayerId | null): RoomChannelState {
  const queryClient = useQueryClient();
  const channelKey = roomId && playerId ? `${roomId}:${playerId}` : null;
  const [state, setState] = useState<{ key: string | null; value: RoomChannelState }>({
    key: null,
    value: INITIAL_STATE,
  });

  useEffect(() => {
    if (!roomId || !playerId || !channelKey) return;
    const supabase = getSupabaseClient();
    let disposed = false;

    const update = (patch: Partial<RoomChannelState>) => {
      if (disposed) return;
      setState((current) => ({
        key: channelKey,
        value: { ...(current.key === channelKey ? current.value : INITIAL_STATE), ...patch },
      }));
    };

    const topic = roomTopic(roomId);
    let channel: RealtimeChannel | null = null;

    const start = async () => {
      // Make sure the socket carries the current JWT before joining a private channel.
      await supabase.realtime.setAuth();
      // supabase.channel() returns an existing channel for the same topic. A previous
      // view of this room (fast remount, StrictMode) may still be tearing its channel
      // down, so remove it first rather than attaching handlers to a dying channel.
      for (const existing of supabase.getChannels()) {
        if (existing.topic === `realtime:${topic}`) await supabase.removeChannel(existing);
      }
      if (disposed) return;
      channel = subscribe(
        supabase.channel(topic, {
          config: {
            private: true,
            presence: { key: playerId, enabled: true },
            // Report SUBSCRIBED only once the change stream is live, so the gap-filling
            // refetch below cannot race ahead of replication.
            postgres_changes_options: { wait: true },
          },
        }),
      );
    };

    const subscribe = (created: RealtimeChannel): RealtimeChannel =>
      created
        .on<RoomPlayerRow>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
          (payload) => {
            applyRoomPlayerChange(queryClient, roomId, payload);
          },
        )
        .on<RoomRow>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
          (payload) => {
            applyRoomChange(queryClient, payload);
          },
        )
        // Readiness and lock status only — these rows carry no answer content.
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'answer_sheets', filter: `room_id=eq.${roomId}` },
          () => {
            void queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'ready_checks', filter: `room_id=eq.${roomId}` },
          () => {
            void queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
          },
        )
        // Fair-play activity: who was away and when (no content, no reasons).
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'visibility_events',
            filter: `room_id=eq.${roomId}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: roomKeys.activityOf(roomId) });
          },
        )
        .on('presence', { event: 'sync' }, () => {
          update({ onlinePlayerIds: new Set(Object.keys(created.presenceState()) as PlayerId[]) });
        })
        // SUBSCRIBED can arrive before the Postgres change stream is live (observed with
        // a slow replication start): changes in between would never be delivered. The
        // server confirms the stream with a system message — fill the gap again then.
        .on('system', {}, (payload: unknown) => {
          if (isPostgresChangesReady(payload)) {
            void queryClient.invalidateQueries({ queryKey: roomKeys.all });
          }
        })
        .subscribe((status, error) => {
          if (disposed) return;
          switch (status) {
            case REALTIME_SUBSCRIBE_STATES.SUBSCRIBED:
              update({ status: 'subscribed', everConnected: true });
              void created.track({ onlineAt: new Date().toISOString() });
              // Fill any gap of events missed while (re)connecting.
              void queryClient.invalidateQueries({ queryKey: roomKeys.all });
              return;
            case REALTIME_SUBSCRIBE_STATES.CLOSED:
              update({ status: 'closed' });
              return;
            case REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR:
            case REALTIME_SUBSCRIBE_STATES.TIMED_OUT:
              reportError('realtime_failure', error ?? status, status);
              update({ status: 'error' });
              return;
          }
        });

    void start().catch((error: unknown) => {
      reportError('realtime_failure', error, 'start');
      update({ status: 'error' });
    });

    return () => {
      disposed = true;
      if (channel) {
        void channel.untrack();
        void supabase.removeChannel(channel);
      }
    };
  }, [roomId, playerId, channelKey, queryClient]);

  return state.key === channelKey ? state.value : INITIAL_STATE;
}

/** The server's "Subscribed to PostgreSQL" confirmation for this channel. */
export function isPostgresChangesReady(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'extension' in payload &&
    payload.extension === 'postgres_changes' &&
    'status' in payload &&
    payload.status === 'ok'
  );
}
