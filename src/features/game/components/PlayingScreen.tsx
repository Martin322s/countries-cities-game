import { useEffect, useRef, useState } from 'react';

import {
  shouldMonitorVisibility,
  toAnswerValues,
  type AnswerValues,
  type PlayerId,
  type RoomId,
  type RoundParticipant,
} from '@/domain';
import { useCue, useGameAudio } from '@/features/audio/gameAudio';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Notice } from '@/shared/ui/Notice';

import { ActivityHeaderSlot } from '../activity/components/ActivityHeaderSlot';
import { ActivityPanel } from '../activity/components/ActivityPanel';
import { AwayBadge } from '../activity/components/AwayBadge';
import { useVisibilityReporter } from '../activity/useVisibilityReporter';
import type { GameRound } from '../api/gameState';
import { useServerNowAt, useServerNowEvery } from '../clock/useServerTime';
import { useAnswerDraft, type SaveAnswersFn, type SaveStatus } from '../hooks/useAnswerDraft';
import { letterCue, readyCue } from '../gameCues';
import { useLockAnswers, useOwnAnswers } from '../hooks/useGameQueries';
import { AnswerForm } from './AnswerForm';
import { ParticipantList } from './ParticipantList';
import { ReadyConfirmed } from './ReadyConfirmed';
import { RoundTimer } from './RoundTimer';

/** Flush pending answers this long before the deadline so the last edit makes it. */
const FINAL_FLUSH_BEFORE_MS = 1_500;
/**
 * The letter's moment in the spotlight. Purely visual: the overlay never takes
 * pointer events and the fields are live from started_at, so typing can start at once.
 */
const LETTER_REVEAL_MS = 1_100;

interface PlayingScreenProps {
  roomId: RoomId;
  playerId: PlayerId;
  hostPlayerId: PlayerId;
  round: GameRound & { timeline: { startedAt: number; endsAt: number } };
  participants: readonly RoundParticipant[];
  onlinePlayerIds: ReadonlySet<PlayerId>;
  /** ends_at has passed (from the authoritative deadline, before the server catches up). */
  timeUp: boolean;
  /** Injected for tests. */
  save?: SaveAnswersFn;
}

export function PlayingScreen(props: PlayingScreenProps) {
  const ownAnswers = useOwnAnswers(props.round.id, props.playerId);

  if (ownAnswers.isPending) {
    return (
      <p role="status" className="py-16 text-center text-fg-muted">
        Зареждане на отговорите...
      </p>
    );
  }
  if (ownAnswers.isError) {
    return (
      <Notice tone="error">
        Неуспешно зареждане на отговорите.{' '}
        <button type="button" className="underline" onClick={() => void ownAnswers.refetch()}>
          Опитай отново
        </button>
      </Notice>
    );
  }
  // Remounts per round, so a later round starts from its own persisted answers.
  return <AnswerSheet key={props.round.id} {...props} initial={toAnswerValues(ownAnswers.data)} />;
}

/** One quiet shared line — no spinner per autosave, fixed height (no layout shift). */
const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Запазваме...',
  saving: 'Запазваме...',
  saved: 'Запазено',
  retrying: 'Няма връзка — пазим отговорите и опитваме отново...',
  closed: '',
};

function AnswerSheet({
  roomId,
  playerId,
  hostPlayerId,
  round,
  participants,
  onlinePlayerIds,
  timeUp,
  save,
  initial,
}: PlayingScreenProps & { initial: AnswerValues }) {
  const { startedAt, endsAt } = round.timeline;
  const draft = useAnswerDraft({ roomId, roundId: round.id, initial, ...(save ? { save } : {}) });
  const lock = useLockAnswers(roomId);
  const [locking, setLocking] = useState(false);
  const readyRef = useRef<HTMLButtonElement>(null);
  const now = useServerNowAt(startedAt + LETTER_REVEAL_MS, endsAt - FINAL_FLUSH_BEFORE_MS);
  const statusNow = useServerNowEvery(5_000);

  const me = participants.find((p) => p.playerId === playerId);
  const myLocked = me?.answersLockedAt != null;
  const locked = myLocked || timeUp;
  const nearDeadline = now >= endsAt - FINAL_FLUSH_BEFORE_MS;
  const revealing = now < startedAt + LETTER_REVEAL_MS;
  const { flush, close } = draft;
  const audio = useGameAudio();
  useCue(now < startedAt + LETTER_REVEAL_MS + 400, letterCue(round.id, startedAt));

  // Fair-play: report page visibility only while this player can still edit answers.
  useVisibilityReporter({
    roomId,
    roundId: round.id,
    active: shouldMonitorVisibility({
      stage: timeUp ? 'time_up' : 'playing',
      isParticipant: me !== undefined,
      left: me?.left ?? true,
      answersLocked: myLocked,
    }),
  });

  // Last chance to persist edits before the server deadline.
  useEffect(() => {
    if (nearDeadline && !locked) void flush();
  }, [nearDeadline, locked, flush]);

  // Once locked (by READY or by time), nothing more may be sent.
  useEffect(() => {
    if (locked) close();
  }, [locked, close]);

  const lockAnswers = async () => {
    setLocking(true);
    try {
      await flush();
      await lock.mutateAsync(round.id);
      audio.cue(readyCue(round.id));
    } catch {
      // Shown via lock.error.
    } finally {
      setLocking(false);
    }
  };

  const finished = participants.filter((p) => !p.left && p.answersLockedAt !== null).length;
  const active = participants.filter((p) => !p.left).length;

  return (
    <div className="flex flex-col gap-4">
      {revealing && round.letter ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 grid animate-fade-in place-items-center bg-ink-950/55"
        >
          <div className="flex flex-col items-center">
            <p className="font-display text-base font-bold tracking-[0.4em] text-fg-muted uppercase">
              Буква
            </p>
            <p className="animate-letter-reveal text-gradient-brand font-display letter-glyph text-[clamp(9rem,40vw,16rem)] leading-none font-black">
              {round.letter}
            </p>
          </div>
        </div>
      ) : null}

      <div className="sticky top-2 z-30 flex items-center justify-between gap-3 rounded-2xl bg-ink-900/85 glass px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            key={revealing ? 'revealing' : 'settled'}
            className={cn(
              'grid size-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-brand-400 to-accent-500 font-display letter-glyph text-4xl font-black text-ink-950 shadow-glow sm:size-16 sm:text-5xl',
              // The letter "lands" in the header right after the spotlight.
              !revealing && now < startedAt + LETTER_REVEAL_MS + 1_500 && 'animate-letter-settle',
            )}
          >
            <span className="sr-only">Буква: </span>
            {round.letter ?? '…'}
          </span>
          <ActivityHeaderSlot
            roomId={roomId}
            roundId={round.id}
            playerId={playerId}
            participants={participants}
          >
            <div className="leading-tight">
              <p className="text-[0.65rem] font-bold tracking-[0.2em] text-fg-subtle uppercase">
                Рунд {round.number}
              </p>
              <p className="font-semibold text-fg">
                {finished} / {active} готови
              </p>
            </div>
          </ActivityHeaderSlot>
        </div>
        <RoundTimer roundId={round.id} endsAt={endsAt} answersLocked={myLocked} />
      </div>

      {timeUp ? <Notice tone="warning">Времето изтече — отговорите са заключени.</Notice> : null}

      <AnswerForm
        values={draft.values}
        onChange={draft.setValue}
        readOnly={locked || locking}
        nextFocusRef={readyRef}
        autoFocusFirst
      />

      <div className="flex flex-col items-center gap-2">
        {lock.error ? (
          <Notice tone="error">{roomErrorMessage(lock.error.code, 'answers')}</Notice>
        ) : null}
        {myLocked ? (
          <ReadyConfirmed detail="Отговорите ти са заключени. Изчакваме останалите..." />
        ) : !locked ? (
          <Button
            ref={readyRef}
            size="lg"
            className="w-full sm:w-auto sm:min-w-80"
            loading={locking}
            onClick={() => void lockAnswers()}
          >
            ГОТОВ — ЗАКЛЮЧИ ОТГОВОРИТЕ
          </Button>
        ) : null}
        <p
          aria-live="polite"
          className={cn(
            'min-h-4 text-xs',
            draft.status === 'retrying' ? 'text-status-warning' : 'text-fg-subtle',
          )}
        >
          {locked ? '' : SAVE_STATUS_LABELS[draft.status]}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-bold tracking-[0.2em] text-fg-subtle uppercase">Играчи</h2>
        <ParticipantList
          label="Кой е готов"
          participants={participants}
          currentPlayerId={playerId}
          hostPlayerId={hostPlayerId}
          onlinePlayerIds={onlinePlayerIds}
          now={statusNow}
          statusOf={(p) =>
            p.answersLockedAt !== null
              ? { label: 'Готов', done: true }
              : { label: 'Пише...', done: false }
          }
          badgeOf={(p) =>
            p.playerId === playerId ? null : (
              <AwayBadge roomId={roomId} roundId={round.id} playerId={p.playerId} />
            )
          }
        />
      </div>

      <ActivityPanel
        roomId={roomId}
        roundId={round.id}
        players={participants}
        playerId={playerId}
      />
    </div>
  );
}
