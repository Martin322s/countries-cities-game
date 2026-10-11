import { readyProgress, type PlayerId, type RoomId, type RoundParticipant } from '@/domain';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { useServerNowEvery } from '../clock/useServerTime';
import { useRoundReady } from '../hooks/useGameQueries';
import { ParticipantList } from './ParticipantList';
import { ReadyConfirmed } from './ReadyConfirmed';

interface RoundWaitingScreenProps {
  roomId: RoomId;
  playerId: PlayerId;
  hostPlayerId: PlayerId;
  roundNumber: number;
  participants: readonly RoundParticipant[];
  onlinePlayerIds: ReadonlySet<PlayerId>;
}

/** Pre-round ready check. The letter does not exist yet — it is drawn when all are ready. */
export function RoundWaitingScreen({
  roomId,
  playerId,
  hostPlayerId,
  roundNumber,
  participants,
  onlinePlayerIds,
}: RoundWaitingScreenProps) {
  const now = useServerNowEvery(5_000);
  const ready = useRoundReady(roomId);
  const me = participants.find((p) => p.playerId === playerId);
  const iAmReady = me?.roundReady ?? false;
  const progress = readyProgress(participants, 'round', now);

  return (
    <div className="flex flex-col items-center gap-6 rounded-panel bg-ink-900/40 glass p-6 text-center sm:p-8">
      <div>
        <p className="font-display text-sm font-bold tracking-[0.3em] text-brand-300 uppercase">
          Рунд {roundNumber}
        </p>
        <h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">Готови ли сте?</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Буквата се тегли, когато всички натиснат „ГОТОВ“.
        </p>
      </div>

      <p className="font-display text-lg font-bold tabular-nums" aria-live="polite">
        <span className="text-brand-300">{progress.ready}</span>
        <span className="text-fg-subtle"> / {progress.required} готови</span>
      </p>

      <div className="w-full text-left">
        <ParticipantList
          label="Готовност на играчите"
          participants={participants}
          currentPlayerId={playerId}
          hostPlayerId={hostPlayerId}
          onlinePlayerIds={onlinePlayerIds}
          now={now}
          statusOf={(p) =>
            p.roundReady ? { label: 'Готов', done: true } : { label: 'Не е готов', done: false }
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
      <p className="text-xs text-fg-subtle">
        Не чакаме играч, който е без връзка повече от 45 секунди.
      </p>
    </div>
  );
}
