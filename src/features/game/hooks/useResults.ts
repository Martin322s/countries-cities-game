import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  revealMilestones,
  revealProgress,
  type CategoryId,
  type PlayerId,
  type RevealProgress,
  type RoomId,
  type RoundId,
} from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import type { RoomError } from '@/features/rooms/api/roomErrors';

import { fetchGameSummary, type GameSummary } from '../api/gameSummary';
import { fetchRoundResults, setAnswerInvalidated, type RoundResults } from '../api/roundResults';
import { serverNow, subscribeServerClock } from '../clock/serverClock';

/**
 * Server-computed results. The current round is refreshed by realtime
 * (rooms.results_revision bumps); a historical (or finished) round is immutable, so
 * it is cached for good once loaded.
 */
export function useRoundResults(roomId: RoomId, roundId: RoundId, { immutable = false } = {}) {
  return useQuery<RoundResults, RoomError>({
    queryKey: roomKeys.results(roomId, roundId),
    queryFn: () => fetchRoundResults(roomId, roundId),
    ...(immutable ? { staleTime: Infinity, gcTime: Infinity } : {}),
  });
}

/** Cumulative standings over every revealed round (final standings once FINISHED). */
export function useGameSummary(roomId: RoomId) {
  return useQuery<GameSummary, RoomError>({
    queryKey: roomKeys.summary(roomId),
    queryFn: () => fetchGameSummary(roomId),
  });
}

export interface InvalidationRequest {
  playerId: PlayerId;
  category: CategoryId;
  invalidated: boolean;
}

export function useSetAnswerInvalidated(roomId: RoomId, roundId: RoundId) {
  const queryClient = useQueryClient();
  return useMutation<null, RoomError, InvalidationRequest>({
    mutationFn: async (request) => {
      await setAnswerInvalidated({ roomId, roundId, ...request });
      return null;
    },
    // The host sees the new scores immediately; everyone else via realtime.
    onSettled: () => queryClient.invalidateQueries({ queryKey: roomKeys.resultsOf(roomId) }),
  });
}

/**
 * Where the synchronized reveal is right now, from the server's reveal_at and the
 * estimated server clock. Re-renders only at timeline boundaries (≈ 12 times), never
 * per animation frame. A refresh mid-reveal resumes at the current position.
 *
 * Monotonic: if the server-clock estimate is corrected backwards (a new, more precise
 * sample), the reveal never steps back — revealed cells and totals stay revealed.
 */
export function useRevealProgress(revealAt: number | null): RevealProgress {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (revealAt === null) return;
    const current = serverNow();
    const timeouts = revealMilestones(revealAt)
      .filter((milestone) => milestone > current)
      .map((milestone) =>
        window.setTimeout(
          () => {
            setNow((previous) => Math.max(previous, serverNow()));
          },
          milestone - current + 10,
        ),
      );
    const unsubscribe = subscribeServerClock(() => {
      setNow((previous) => Math.max(previous, serverNow()));
    });
    return () => {
      for (const id of timeouts) window.clearTimeout(id);
      unsubscribe();
    };
  }, [revealAt]);

  return revealProgress(revealAt, now);
}
