import { useMemo } from 'react';
import { Link } from 'react-router';

import {
  formatWinners,
  rankLeaderboard,
  winnersOf,
  type GameProgress,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { useCue } from '@/features/audio/gameAudio';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { buttonClasses } from '@/shared/ui/buttonClasses';
import { CrownIcon } from '@/shared/ui/icons';
import { Notice } from '@/shared/ui/Notice';

import type { RevealedRound } from '../api/gameState';
import { finishedCue } from '../gameCues';
import { useGameSummary } from '../hooks/useResults';
import { Confetti } from './Confetti';
import { ResultsScreen } from './results/ResultsScreen';

interface FinishedScreenProps {
  roomId: RoomId;
  roomCode: string;
  lastRoundId: RoundId;
  playerId: PlayerId;
  hostPlayerId: PlayerId;
  progress: GameProgress;
  revealedRounds: readonly RevealedRound[];
}

function roundsLabel(count: number): string {
  return count === 1 ? '1 рунд' : `${String(count)} рунда`;
}

function pointsLabel(points: number): string {
  return points === 1 ? '1 точка' : `${String(points)} точки`;
}

/**
 * Final screen. Standings come from the server (sum of every revealed round's
 * authoritative cells). Equal totals share a rank; several players on rank 1 are
 * joint winners — join order only decides the display order among them.
 */
export function FinishedScreen({
  roomId,
  roomCode,
  lastRoundId,
  playerId,
  hostPlayerId,
  progress,
  revealedRounds,
}: FinishedScreenProps) {
  const summary = useGameSummary(roomId);

  const ranked = useMemo(
    () =>
      rankLeaderboard(
        (summary.data?.standings ?? []).map((standing) => ({
          playerId: standing.playerId,
          displayName: standing.displayName,
          totalPoints: standing.totalPoints,
          roundPoints: null,
          order: standing.order,
          left: standing.left,
        })),
      ),
    [summary.data],
  );
  const winners = winnersOf(ranked);
  const roundsPlayed = new Map(
    (summary.data?.standings ?? []).map((standing) => [standing.playerId, standing.roundsPlayed]),
  );
  // One celebration sound when the game is first reached (never on refresh/refetch).
  useCue(summary.data !== undefined, finishedCue(roomId, summary.data?.finishedAt ?? null));
  const winningPoints = winners[0]?.totalPoints ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="finished-title"
        className="relative overflow-hidden rounded-panel border border-brand-400/30 bg-ink-900 p-6 text-center shadow-panel sm:p-10"
      >
        <Confetti gameKey={roomId} />
        <p className="relative text-xs font-bold tracking-[0.3em] text-fg-subtle uppercase">
          Стая {roomCode} · {summary.data?.roundsCompleted ?? progress.roundsCompleted} /{' '}
          {progress.totalRounds} букви
        </p>
        <h1
          id="finished-title"
          className="relative mt-3 font-display text-4xl font-black sm:text-6xl"
        >
          КРАЙ НА ИГРАТА
        </h1>
        {winners.length > 0 ? (
          // Every joint winner gets exactly the same emphasis — no tie-breaker implied.
          <div className="relative mt-6 flex animate-pop-in flex-col items-center gap-2 [animation-delay:250ms]">
            <CrownIcon width={36} height={36} className="text-brand-300" />
            <p className="text-gradient-brand font-display text-2xl leading-tight font-black text-balance sm:text-4xl">
              {formatWinners(winners.map((winner) => winner.displayName))}
            </p>
            {winningPoints !== null ? (
              <p className="text-sm font-semibold text-fg-muted tabular-nums">
                {pointsLabel(winningPoints)}
                {winners.length > 1 ? ' всеки' : ''}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="final-standings"
        className="rounded-panel border border-white/10 bg-ink-900 p-4 shadow-panel sm:p-6"
      >
        <h2 id="final-standings" className="mb-4 font-display text-lg font-black tracking-wide">
          КРАЙНО КЛАСИРАНЕ
        </h2>
        {summary.error ? (
          <Notice tone="error">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {roomErrorMessage(summary.error.code, 'results')}
              <Button variant="ghost" onClick={() => void summary.refetch()}>
                Опитай отново
              </Button>
            </div>
          </Notice>
        ) : !summary.data ? (
          <p role="status" className="py-6 text-center text-fg-muted">
            Зареждане на класирането...
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {ranked.map((entry) => {
              const winner = entry.rank === 1;
              return (
                <li
                  key={entry.playerId}
                  className={cn(
                    'flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3',
                    winner
                      ? 'border-brand-400/70 bg-brand-500/18 shadow-glow'
                      : 'border-white/10 bg-white/5',
                    entry.playerId === playerId && 'ring-2 ring-brand-400/40',
                  )}
                >
                  <span className="w-10 shrink-0 text-center font-display text-2xl font-black text-fg-muted tabular-nums">
                    {entry.rank}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5 text-lg font-bold">
                      <span className="truncate">{entry.displayName}</span>
                      {winner ? (
                        <>
                          <CrownIcon width={18} height={18} className="shrink-0 text-brand-300" />
                          <span className="sr-only">
                            {entry.tied ? ' — победител (поделено първо място)' : ' — победител'}
                          </span>
                        </>
                      ) : entry.tied ? (
                        <span className="sr-only"> (поделено място)</span>
                      ) : null}
                      {entry.playerId === playerId ? (
                        <span className="text-xs font-medium text-fg-subtle">(ти)</span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {roundsLabel(roundsPlayed.get(entry.playerId) ?? 0)}
                      {entry.left ? ' · напусна' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 font-display text-2xl font-black text-brand-300 tabular-nums">
                    {entry.totalPoints}
                    <span className="ml-1 text-sm font-bold text-fg-subtle">т.</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-6 flex justify-center">
          <Link to="/" className={buttonClasses('secondary')}>
            КЪМ НАЧАЛОТО
          </Link>
        </div>
      </section>

      <details className="group rounded-panel border border-white/10 bg-ink-900/60 p-4">
        <summary className="cursor-pointer font-display text-sm font-bold tracking-wide text-fg-muted">
          Резултати по рундове
        </summary>
        <div className="mt-4">
          <ResultsScreen
            roomId={roomId}
            roundId={lastRoundId}
            playerId={playerId}
            hostPlayerId={hostPlayerId}
            phase="FINISHED"
            progress={progress}
            revealedRounds={revealedRounds}
            variant="finished"
          />
        </div>
      </details>
    </div>
  );
}
