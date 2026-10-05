import { isGamePhase, type GamePhase, type PlayerId, type RoomId } from '@/domain';
import type { Database } from '@/shared/lib/database.types';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { reportError } from '@/shared/lib/telemetry';

import { RoomError, toRoomError } from './roomErrors';

type RoomRow = Database['public']['Tables']['rooms']['Row'];
type RoomPlayerRow = Database['public']['Tables']['room_players']['Row'];

/** What the lobby needs to know about a room. */
export interface RoomSummary {
  id: RoomId;
  code: string;
  capacity: number;
  hostPlayerId: PlayerId;
  phase: GamePhase;
}

/** Server membership data. Connection status is derived separately (presence). */
export interface RoomMember {
  id: PlayerId;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
}

export function toRoomSummary(
  row: Pick<RoomRow, 'id' | 'code' | 'capacity' | 'host_player_id' | 'phase'>,
): RoomSummary {
  // The DB enum and the domain union must stay identical; guard against drift at runtime.
  const phase: string = row.phase;
  if (!isGamePhase(phase)) throw new RoomError('unknown', `Unknown phase ${phase}`);
  return {
    id: row.id as RoomId,
    code: row.code,
    capacity: row.capacity,
    hostPlayerId: row.host_player_id as PlayerId,
    phase,
  };
}

export function toRoomMember(
  row: Pick<RoomPlayerRow, 'player_id' | 'display_name' | 'joined_at' | 'last_seen_at'>,
): RoomMember {
  return {
    id: row.player_id as PlayerId,
    displayName: row.display_name,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Runs a backend call and guarantees that any failure surfaces as a typed RoomError.
 * Unexpected (non-whitelisted) failures are logged in development only.
 */
export async function callBackend<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const roomError = toRoomError(error);
    // Expected failures (whitelisted codes, offline) are normal game flow; anything
    // else is a real problem worth knowing about — sanitized, without payloads.
    if (roomError.code === 'unknown') reportError('rpc_failure', error);
    throw roomError;
  }
}

/* ---------------------------------------------------------------------------
 * Mutations — all go through server-validated RPCs. Identity is auth.uid() on
 * the server; no player or host id is ever sent from the client.
 * ------------------------------------------------------------------------- */

export function createRoom(input: { displayName: string; capacity: number }): Promise<string> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient().rpc('create_room', {
      p_display_name: input.displayName,
      p_capacity: input.capacity,
    });
    if (error) throw error;
    return data;
  });
}

/** Joins, or restores an existing membership (rejoin). Returns the canonical code. */
export function joinRoom(input: { code: string; displayName: string }): Promise<string> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient().rpc('join_room', {
      p_code: input.code,
      p_display_name: input.displayName,
    });
    if (error) throw error;
    // An unknown code is not an exception on the server (so that guessing can be
    // rate limited): it returns null.
    const code = data as string | null;
    if (code === null) throw new RoomError('room_not_found');
    return code;
  });
}

export function leaveRoom(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('leave_room', { p_room_id: roomId });
    if (error) throw error;
  });
}

export function sendHeartbeat(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('heartbeat', { p_room_id: roomId });
    if (error) throw error;
  });
}

/* ---------------------------------------------------------------------------
 * Reads — plain selects; RLS only returns rows of rooms the caller is an active
 * member of. A non-member and a non-existent room are indistinguishable here,
 * so codes cannot be probed through table reads.
 * ------------------------------------------------------------------------- */

/** The room with this code if the caller is an active member, otherwise `null`. */
export function fetchMemberRoom(code: string): Promise<RoomSummary | null> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient()
      .from('rooms')
      .select('id, code, capacity, host_player_id, phase')
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    return data ? toRoomSummary(data) : null;
  });
}

/** Active members ordered by join time (the order used for host election). */
export function fetchRoomMembers(roomId: RoomId): Promise<RoomMember[]> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient()
      .from('room_players')
      .select('player_id, display_name, joined_at, last_seen_at')
      .eq('room_id', roomId)
      .is('left_at', null)
      .order('joined_at', { ascending: true })
      .order('player_id', { ascending: true });
    if (error) throw error;
    return data.map(toRoomMember);
  });
}
