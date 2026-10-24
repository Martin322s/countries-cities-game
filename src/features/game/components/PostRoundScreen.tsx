import { readyProgress, type PlayerId, type RoomId, type RoundParticipant } from '@/domain';
import { useCue } from '@/features/audio/gameAudio';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import type { GameRound } from '../api/gameState';
import { useServerNowEvery } from '../clock/useServerTime';
import { allReadyCue } from '../gameCues';
import { useResultsReady } from '../hooks/useGameQueries';
import { ParticipantList } from './ParticipantList';
import { ReadyConfirmed } from './ReadyConfirmed';

interface PostRoundScreenProps {
  roomId: RoomId;
  playerId: PlayerId;
  hostPlayerId: PlayerId;
  round: GameRound;
  participants: readonly RoundParticipant[];
  onlinePlayerIds: ReadonlySet<PlayerId>;
}

/**
 * The breath between frantic play and the reveal: answers are locked, everyone
 * confirms they are ready to see the results.
 */
export function PostRoundScreen({
  roomId,
  playerId,
  hostPlayerId,
  round,
  participants,
  onlinePlayerIds,
}: PostRoundScreenProps) {
  const now = useServerNowEvery(5_000);
  const ready = useResultsReady(roomId);
  const me = participants.find((p) => p.playerId === playerId);
  const iAmReady = me?.resultsReady ?? false;
  const progress = readyProgress(participants, 'results', now);
  const allLocked = round.lockReason === 'all_ready' && round.timeline.lockedAt !== null;
  useCue(allLocked, allLocked ? allReadyCue(round.id, round.timeline.lockedAt ?? 0) : null);

  return (
    <div className="flex flex-col items-center gap-6 rounded-panel bg-ink-900/40 glass p-6 text-center sm:p-8">
      <div className="flex flex-col items-center gap-2">
        {round.letter ? (
          <span className="grid size-16 animate-pop-in place-items-center rounded-2xl bg-linear-to-br from-brand-400 to-accent-500 font-display letter-glyph text-4xl font-black text-ink-950 shadow-glow">
            <span className="sr-only">Буква: </span>
            {round.letter}
          </span>
        ) : null}
        <h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">
          {round.lockReason === 'timeout' ? 'ВРЕМЕТО ИЗТЕЧЕ' : 'РУНДЪТ ПРИКЛЮЧИ'}
        </h1>
        <p className="text-fg-muted">
          Отговорите са заключени. Когато всички са готови, започва проверката.
        </p>
      </div>

      <p className="font-display text-lg font-bold tabular-nums" aria-live="polite">
        <span className="text-brand-300">{progress.ready}</span>
        <span className="text-fg-subtle"> / {progress.required} готови за резултатите</span>
      </p>

      <div className="w-full text-left">
        <ParticipantList
          label="Готовност за резултатите"
          participants={participants}
          currentPlayerId={playerId}
          hostPlayerId={hostPlayerId}
          onlinePlayerIds={onlinePlayerIds}
          now={now}
          statusOf={(p) =>
            p.resultsReady ? { label: 'Готов', done: true } : { label: 'Не е готов', done: false }
          }
        />
      </div>

      {ready.error ? (
        <Notice tone="error">{roomErrorMessage(ready.error.code, 'ready')}</Notice>
      ) : null}

      {iAmReady ? (
        <ReadyConfirmed detail="Изчакваме останалите..." />
      ) : (
        <Button
          size="lg"
          className="w-full sm:w-auto sm:min-w-80"
          disabled={!me || me.left}
          loading={ready.isPending}
          onClick={() => {
            ready.mutate(undefined);
          }}
        >
          ГОТОВ
        </Button>
      )}
    </div>
  );
}
