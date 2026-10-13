import {
  MIN_PLAYERS,
  resultsAction,
  type GamePhase,
  type GameProgress,
  type RoomId,
} from '@/domain';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { useFinishGame, useStartNextRound } from '../../hooks/useGameQueries';

interface NextRoundControlsProps {
  roomId: RoomId;
  isHost: boolean;
  phase: GamePhase;
  progress: GameProgress;
}

/**
 * What happens after a round's results. Rounds 1–27: the host starts the next round
 * (ready check — no letter yet). Round 28: the host opens the final standings. The
 * server re-checks everything (host, phase, letters, ≥ 2 eligible players).
 */
export function NextRoundControls({ roomId, isHost, phase, progress }: NextRoundControlsProps) {
  const nextRound = useStartNextRound(roomId);
  const finish = useFinishGame(roomId);
  const action = resultsAction(phase, progress);
  const pending = nextRound.isPending || finish.isPending;
  // A request that lost a race (double click, two tabs) is not an error for the player.
  const error = [nextRound.error, finish.error].find(
    (candidate) => candidate && candidate.code !== 'round_already_started',
  );

  return (
    <section
      aria-label="Следваща стъпка"
      className="flex flex-col items-center gap-3 rounded-panel border border-white/10 bg-white/[0.03] p-5 text-center"
    >
      <p className="text-sm font-semibold text-fg-muted">
        Изиграни букви:{' '}
        <span className="font-display font-black text-brand-300 tabular-nums">
          {progress.lettersUsed} / {progress.totalRounds}
        </span>
      </p>

      {action === 'none' ? (
        <p className="text-sm text-fg-subtle" role="status">
          Подготвяме следващата стъпка...
        </p>
      ) : isHost ? (
        <>
          {action === 'next_round' ? (
            <Button
              size="lg"
              className="w-full sm:w-auto sm:min-w-64"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                nextRound.mutate(undefined);
              }}
            >
              {nextRound.isPending ? 'Подготвяне...' : 'НОВ РУНД'}
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full sm:w-auto sm:min-w-72"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                finish.mutate(undefined);
              }}
            >
              ВИЖ КРАЙНОТО КЛАСИРАНЕ
            </Button>
          )}
          {action === 'next_round' && progress.eligiblePlayers < MIN_PLAYERS ? (
            <p className="max-w-sm text-xs text-fg-subtle">
              За нов рунд са нужни поне {MIN_PLAYERS} свързани играчи от играта.
            </p>
          ) : null}
        </>
      ) : (
        <p className="font-display text-lg font-bold" role="status">
          {action === 'next_round'
            ? 'Изчакваме хоста за следващия рунд...'
            : 'Изчакваме хоста да завърши играта...'}
        </p>
      )}

      {error ? (
        <Notice tone="error">
          {roomErrorMessage(error.code, action === 'finish_game' ? 'finish' : 'next_round')}
        </Notice>
      ) : null}
    </section>
  );
}
