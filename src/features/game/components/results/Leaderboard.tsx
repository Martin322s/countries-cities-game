import { useLayoutEffect, useRef, useState } from 'react';

import type { LeaderboardEntry, PlayerId } from '@/domain';
import { useReducedMotion } from '@/shared/hooks/useReducedMotion';
import { cn } from '@/shared/lib/cn';
import { EASING, MOTION_MS } from '@/shared/motion/motion';

import { PointsCounter } from './PointsCounter';

/**
 * Cumulative standings with competition ranks (1, 2, 2, 4). When totals change (host
 * invalidation), rows glide to their new positions (FLIP); with reduced motion they
 * simply appear in place.
 */
export function Leaderboard({
  entries,
  currentPlayerId,
  title = 'ОБЩО КЛАСИРАНЕ',
  live = false,
}: {
  entries: readonly LeaderboardEntry[];
  currentPlayerId: PlayerId;
  title?: string;
  /** Part of the live reveal: rows rise in and totals count up from the previous total. */
  live?: boolean;
}) {
  const rows = useRef(new Map<PlayerId, HTMLLIElement>());
  const previousTops = useRef(new Map<PlayerId, number>());
  const reducedMotion = useReducedMotion();
  // Captured once: the entrance keeps running even when the reveal completes mid-way.
  const [entering] = useState(live);
  const orderKey = entries.map((entry) => entry.playerId).join(',');

  useLayoutEffect(() => {
    const nextTops = new Map<PlayerId, number>();
    for (const [playerId, row] of rows.current) {
      const top = row.getBoundingClientRect().top;
      nextTops.set(playerId, top);
      const previous = previousTops.current.get(playerId);
      if (reducedMotion || previous === undefined || previous === top) continue;
      row.style.transition = 'none';
      row.style.transform = `translateY(${previous - top}px)`;
      requestAnimationFrame(() => {
        row.style.transition = `transform ${String(MOTION_MS.normal)}ms ${EASING.standard}`;
        row.style.transform = '';
      });
    }
    previousTops.current = nextTops;
  }, [orderKey, reducedMotion]);

  return (
    <section aria-labelledby="leaderboard-title" className="flex flex-col gap-3">
      <h2 id="leaderboard-title" className="font-display text-lg font-black tracking-wide">
        {title}
      </h2>
      <ol className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <li
            key={entry.playerId}
            ref={(element) => {
              if (element) rows.current.set(entry.playerId, element);
              else rows.current.delete(entry.playerId);
            }}
            style={entering ? { animationDelay: `${String(index * 60)}ms` } : undefined}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2.5',
              entering && 'animate-rise',
              entry.rank === 1
                ? 'border-brand-400/50 bg-brand-500/12'
                : 'border-white/10 bg-white/5',
              entry.playerId === currentPlayerId && 'ring-2 ring-brand-400/40',
            )}
          >
            <span className="w-8 shrink-0 text-center font-display text-lg font-black text-fg-muted tabular-nums">
              {entry.rank}.{entry.tied ? <span className="sr-only"> (поделено място)</span> : null}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {entry.displayName}
              {entry.playerId === currentPlayerId ? (
                <span className="ml-1.5 text-xs font-medium text-fg-subtle">(ти)</span>
              ) : null}
              {entry.left ? (
                <span className="ml-1.5 text-xs font-medium text-fg-subtle">напусна</span>
              ) : null}
            </span>
            {entry.roundPoints === null ? (
              <span className="shrink-0 text-xs font-bold text-fg-subtle">
                —<span className="sr-only"> не участва в този рунд</span>
              </span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-status-unique tabular-nums">
                +{entry.roundPoints}
                <span className="sr-only"> в този рунд</span>
              </span>
            )}
            <PointsCounter
              value={entry.totalPoints}
              from={entry.totalPoints - (entry.roundPoints ?? 0)}
              animateInitial={entering}
              className="w-10 shrink-0 text-right font-display text-xl font-black text-brand-300 tabular-nums"
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
