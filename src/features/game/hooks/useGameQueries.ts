import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CategoryId, PlayerId, RoomId, RoundId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import type { RoomError } from '@/features/rooms/api/roomErrors';

import {
  fetchGameState,
  fetchOwnAnswers,
  lockAnswers,
  setResultsReady,
  setRoundReady,
  finishGame,
  startGame,
  startNextRound,
} from '../api/gameApi';
import type { GameState } from '../api/gameState';

/** Phase, timing and participant statuses. Kept fresh by realtime invalidation. */
export function useGameState(roomId: RoomId) {
  return useQuery<GameState, RoomError>({
    queryKey: roomKeys.game(roomId),
    queryFn: () => fetchGameState(roomId),
  });
}

export function useOwnAnswers(roundId: RoundId | null, playerId: PlayerId) {
  return useQuery<Partial<Record<CategoryId, string>>, RoomError>({
    queryKey: roomKeys.ownAnswers(roundId ?? ('' as RoundId)),
    queryFn: () => fetchOwnAnswers(roundId ?? ('' as RoundId), playerId),
    enabled: roundId !== null,
    // The local draft is the source of truth while typing; don't overwrite it.
    staleTime: Infinity,
  });
}

function useGameMutation<TVariables>(
  roomId: RoomId,
  run: (variables: TVariables) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, TVariables>({
    mutationFn: async (variables) => {
      await run(variables);
      return null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) }),
  });
}

export function useStartGame(roomId: RoomId) {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, undefined>({
    mutationFn: async () => {
      await startGame(roomId);
      return null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

export function useRoundReady(roomId: RoomId) {
  return useGameMutation<undefined>(roomId, () => setRoundReady(roomId));
}

export function useResultsReady(roomId: RoomId) {
  return useGameMutation<undefined>(roomId, () => setResultsReady(roomId));
}

export function useLockAnswers(roomId: RoomId) {
  return useGameMutation<RoundId>(roomId, (roundId) => lockAnswers(roomId, roundId));
}

/** Host: RESULTS → next round's ready check. All clients follow via realtime. */
export function useStartNextRound(roomId: RoomId) {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, undefined>({
    mutationFn: async () => {
      await startNextRound(roomId);
      return null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}

/** Host: after round 28's RESULTS → FINISHED. */
export function useFinishGame(roomId: RoomId) {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, undefined>({
    mutationFn: async () => {
      await finishGame(roomId);
      return null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: roomKeys.all }),
  });
}
