import { useMemo, useState } from 'react';

import {
  isRoundEditable,
  rankLeaderboard,
  type GamePhase,
  type GameProgress,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { useCue } from '@/features/audio/gameAudio';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { BanIcon, CheckIcon, DuplicateIcon } from '@/shared/ui/icons';
import { Notice } from '@/shared/ui/Notice';

import { RoundActivitySummary } from '../../activity/components/ActivityPanel';
import type { RevealedRound } from '../../api/gameState';
import { revealCue } from '../../gameCues';
import {
  useRevealProgress,
  useRoundResults,
  useSetAnswerInvalidated,
} from '../../hooks/useResults';
import { InvalidationDialog, type SelectedCell } from './InvalidationDialog';
import { Leaderboard } from './Leaderboard';
import { NextRoundControls } from './NextRoundControls';
import { ResultsTable } from './ResultsTable';
import { RoundNavigator } from './RoundNavigator';
import { SuspenseOverlay } from './SuspenseOverlay';

interface ResultsScreenProps {
  roomId: RoomId;
  /** The game's current round (the one being revealed / shown). */
  roundId: RoundId;
  playerId: PlayerId;
  hostPlayerId: PlayerId;
  phase: GamePhase;
  progress: GameProgress;
  revealedRounds: readonly RevealedRound[];
  /** FINISHED shows its own final standings and has no next step. */
  variant?: 'live' | 'finished';
}

export function ResultsScreen({
  roomId,
  roundId,
  playerId,
  hostPlayerId,
  phase,
  progress,
  revealedRounds,
  variant = 'live',
}: ResultsScreenProps) {
  const [viewedRoundId, setViewedRoundId] = useState<RoundId | null>(null);
  const viewingId = viewedRoundId ?? roundId;
  const isHistorical = viewingId !== roundId;
  const results = useRoundResults(roomId, viewingId, {
    immutable: isHistorical || phase === 'FINISHED',
  });
  // History is shown as-is; only the current round plays the synchronized reveal.
  const progressOfReveal = useRevealProgress(
    isHistorical ? null : (results.data?.round.revealAt ?? null),
  );
  // LIVE = dramatic, HISTORY = inspectable: only the current round's live reveal makes
  // sound (one cue per timeline boundary; the player's own cells pick the category tone).
  const revealAt = results.data?.round.revealAt ?? null;
  const ownCells = results.data?.players.find((p) => p.playerId === playerId)?.cells;
  const cue =
    !isHistorical && variant === 'live' && revealAt !== null && results.data
      ? revealCue(results.data.round.id, revealAt, progressOfReveal, (index) => {
          return ownCells?.[index]?.state ?? null;
        })
      : null;
  useCue(cue !== null, cue);
  const invalidate = useSetAnswerInvalidated(roomId, roundId);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const isHost = hostPlayerId === playerId;
  const canEdit = isHost && isRoundEditable({ isCurrentRound: !isHistorical, phase });

  const leaderboard = useMemo(() => {
    const data = results.data;
    if (!data) return [];
    const roundPoints = new Map(data.players.map((p) => [p.playerId, p.roundPoints]));
    return rankLeaderboard(
      data.standings.map((standing) => ({
        playerId: standing.playerId,
        displayName: standing.displayName,
        totalPoints: standing.totalPoints,
        roundPoints: roundPoints.get(standing.playerId) ?? null,
        order: standing.order,
        left: standing.left,
      })),
    );
  }, [results.data]);

  if (!results.data) {
    return results.error ? (
      <Notice tone="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {roomErrorMessage(results.error.code, 'results')}
          <Button variant="ghost" onClick={() => void results.refetch()}>
            Опитай отново
          </Button>
        </div>
      </Notice>
    ) : isHistorical ? (
      <p role="status" className="py-16 text-center text-fg-muted">
        Зареждане на рунда...
      </p>
    ) : (
      <>
        <SuspenseOverlay />
        <p role="status" className="py-16 text-center text-fg-muted">
          Проверяваме отговорите...
        </p>
      </>
    );
  }

  const { round, players } = results.data;
  const reveal = progressOfReveal;
  const live = !reveal.complete;
  const me = players.find((player) => player.playerId === playerId);
  const myStanding = results.data.standings.find((s) => s.playerId === playerId);
  const announcement =
    isHistorical || !reveal.complete
      ? isHistorical
        ? `Преглеждаш предишен рунд ${round.number}.`
        : 'Проверяваме отговорите...'
      : `Резултатите са готови.${me && myStanding ? ` Имаш ${me.roundPoints} точки в този рунд и ${myStanding.totalPoints} общо.` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      {reveal.stage === 'suspense' ? <SuspenseOverlay /> : null}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {round.letter ? (
            <span className="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-brand-400 to-accent-500 font-display letter-glyph text-3xl font-black text-ink-950">
              <span className="sr-only">Буква: </span>
              {round.letter}
            </span>
          ) : null}
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-fg-subtle uppercase">
              Рунд {round.number} / {progress.totalRounds}
            </p>
            <h1 className="font-display text-2xl font-black sm:text-3xl">
              {isHistorical ? 'ПРЕДИШЕН РУНД' : 'РЕЗУЛТАТИ'}
            </h1>
          </div>
        </div>
        {reveal.complete && revealedRounds.length > 1 ? (
          <RoundNavigator
            rounds={revealedRounds}
            viewingId={viewingId}
            currentId={roundId}
            totalRounds={progress.totalRounds}
            onSelect={(id) => {
              setSelected(null);
              setViewedRoundId(id === roundId ? null : id);
            }}
          />
        ) : null}
      </header>

      {isHistorical ? (
        <Notice tone="info" className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Това е рунд {round.number} — само за преглед. Резултатите му вече не могат да се
            променят.
          </span>
          <Button
            variant="ghost"
            className="h-9 px-3"
            onClick={() => {
              setSelected(null);
              setViewedRoundId(null);
            }}
          >
            Към текущия рунд
          </Button>
        </Notice>
      ) : canEdit && reveal.revealedCategories > 0 ? (
        <p className="text-xs text-fg-muted">
          Като хост можеш да докоснеш отговор, за да го отбележиш като невалиден или да го
          възстановиш.
        </p>
      ) : null}

      <div
        className={cn('grid gap-5', variant === 'live' && '2xl:grid-cols-[minmax(0,1fr)_18rem]')}
      >
        <div
          className={cn(
            'min-w-0 rounded-panel border border-white/10 bg-ink-900 p-3 shadow-panel sm:p-4',
            reveal.stage !== 'suspense' && 'animate-fade-in',
            reveal.stage === 'suspense' && 'invisible',
          )}
        >
          <ResultsTable
            key={viewingId}
            players={players}
            currentPlayerId={playerId}
            revealedCategories={reveal.revealedCategories}
            scoresRevealed={reveal.scoresRevealed}
            live={live}
            canEdit={canEdit}
            onSelectCell={(player, cell) => {
              invalidate.reset();
              setSelected({ player, cell });
            }}
          />
          <Legend />
        </div>

        {variant === 'live' ? (
          <div
            className={cn(
              'rounded-panel bg-ink-900/60 glass p-4',
              !reveal.leaderboardRevealed && 'opacity-40',
            )}
          >
            {reveal.leaderboardRevealed ? (
              <div>
                <Leaderboard
                  entries={leaderboard}
                  currentPlayerId={playerId}
                  live={!isHistorical && !reveal.complete}
                  title={isHistorical ? `КЛАСИРАНЕ СЛЕД РУНД ${round.number}` : 'ОБЩО КЛАСИРАНЕ'}
                />
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-fg-subtle">
                Класирането идва след резултатите...
              </p>
            )}
          </div>
        ) : null}
      </div>

      {isHistorical || reveal.complete ? (
        <RoundActivitySummary
          key={viewingId}
          roomId={roomId}
          roundId={viewingId}
          players={players}
          immutable={isHistorical || phase === 'FINISHED'}
        />
      ) : null}

      {variant === 'live' && !isHistorical && reveal.complete ? (
        <NextRoundControls roomId={roomId} isHost={isHost} phase={phase} progress={progress} />
      ) : null}

      <InvalidationDialog
        selected={selected}
        canEdit={canEdit}
        pending={invalidate.isPending}
        error={invalidate.error}
        onClose={() => {
          if (!invalidate.isPending) setSelected(null);
        }}
        onConfirm={(invalidated) => {
          if (!selected || !canEdit) return;
          invalidate.mutate(
            { playerId: selected.player.playerId, category: selected.cell.category, invalidated },
            {
              onSuccess: () => {
                setSelected(null);
              },
            },
          );
        }}
      />
    </div>
  );
}

/** Explains the four cell states in words, not only colours. */
function Legend() {
  return (
    <ul
      aria-label="Легенда"
      className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-fg-muted"
    >
      <li className="inline-flex items-center gap-1.5">
        <CheckIcon width={13} height={13} className="text-status-unique" /> уникален: +1
      </li>
      <li className="inline-flex items-center gap-1.5">
        <DuplicateIcon width={13} height={13} className="text-status-duplicate" /> повтарящ се: 0
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="font-bold">
          —
        </span>{' '}
        празен: 0
      </li>
      <li className="inline-flex items-center gap-1.5">
        <BanIcon width={13} height={13} className="text-status-invalidated" /> невалиден: 0
      </li>
    </ul>
  );
}
