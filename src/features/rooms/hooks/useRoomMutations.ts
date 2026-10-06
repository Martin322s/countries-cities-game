import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RoomId } from '@/domain';
import { writeLocal } from '@/shared/lib/storage';

import { roomKeys } from '../api/queryKeys';
import type { RoomError } from '../api/roomErrors';
import { createRoom, joinRoom, leaveRoom } from '../api/roomsApi';

export const LAST_DISPLAY_NAME_KEY = 'darzhavi-i-gradove.lastDisplayName';

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation<string, RoomError, { displayName: string; capacity: number }>({
    mutationFn: createRoom,
    onSuccess: async (code, { displayName }) => {
      writeLocal(LAST_DISPLAY_NAME_KEY, displayName.trim());
      await queryClient.invalidateQueries({ queryKey: roomKeys.byCode(code) });
    },
  });
}

export function useJoinRoom() {
  const queryClient = useQueryClient();
  return useMutation<string, RoomError, { code: string; displayName: string }>({
    mutationFn: joinRoom,
    onSuccess: async (code, { displayName }) => {
      writeLocal(LAST_DISPLAY_NAME_KEY, displayName.trim());
      await queryClient.invalidateQueries({ queryKey: roomKeys.byCode(code) });
    },
  });
}

export function useLeaveRoom() {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, { roomId: RoomId; code: string }>({
    mutationFn: async ({ roomId }) => {
      await leaveRoom(roomId);
      return null;
    },
    onSuccess: (_result, { roomId, code }) => {
      // Drop cached membership so nothing stale flashes if the player comes back.
      queryClient.removeQueries({ queryKey: roomKeys.byCode(code) });
      queryClient.removeQueries({ queryKey: roomKeys.members(roomId) });
    },
  });
}
