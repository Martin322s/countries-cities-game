import { useQuery } from '@tanstack/react-query';

import type { RoomId } from '@/domain';
import { useAuthSession } from '@/features/auth/authContext';

import { roomKeys } from '../api/queryKeys';
import type { RoomError } from '../api/roomErrors';
import {
  fetchMemberRoom,
  fetchRoomMembers,
  type RoomMember,
  type RoomSummary,
} from '../api/roomsApi';

/**
 * The room for `code` if this browser's player is an active member, else `null`.
 * Kept fresh by realtime invalidation (see useRoomChannel), not by polling.
 */
export function useMemberRoom(code: string | null) {
  const { state } = useAuthSession();
  const playerId = state.status === 'ready' ? state.playerId : null;
  return useQuery<RoomSummary | null, RoomError>({
    queryKey: roomKeys.byCode(code ?? ''),
    queryFn: () => fetchMemberRoom(code ?? ''),
    enabled: code !== null && playerId !== null,
  });
}

export function useRoomMembers(roomId: RoomId | null) {
  return useQuery<RoomMember[], RoomError>({
    queryKey: roomKeys.members(roomId ?? ('' as RoomId)),
    queryFn: () => fetchRoomMembers(roomId ?? ('' as RoomId)),
    enabled: roomId !== null,
  });
}
