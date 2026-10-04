import type { PlayerId } from '@/domain';

import type { RoomMember } from './roomsApi';

/** The realtime row shape we merge (subset of room_players). */
export interface MemberRowChange {
  player_id: string;
  display_name: string;
  joined_at: string;
  last_seen_at: string;
  left_at: string | null;
}

function compareMembers(a: RoomMember, b: RoomMember): number {
  const byJoinTime = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
  if (byJoinTime !== 0) return byJoinTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Applies one realtime INSERT/UPDATE of a room_players row to the cached member list.
 * Pure: returns a new array, ordered like the server query (joined_at, player_id).
 *
 * - a row with `left_at` set removes the member (left or seat expired)
 * - otherwise the member is inserted or replaced (rejoin, heartbeat, rename)
 */
export function applyMemberRowChange(
  members: readonly RoomMember[],
  row: MemberRowChange,
): RoomMember[] {
  const id = row.player_id as PlayerId;
  const others = members.filter((member) => member.id !== id);
  if (row.left_at !== null) return others;

  const updated: RoomMember = {
    id,
    displayName: row.display_name,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
  };
  return [...others, updated].sort(compareMembers);
}
