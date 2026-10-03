import { useEffect, useRef } from 'react';

import { CATEGORY_IDS, CATEGORY_LABELS, POINTS_COLUMN_LABEL, type PlayerId } from '@/domain';
import { useReducedMotion } from '@/shared/hooks/useReducedMotion';
import { cn } from '@/shared/lib/cn';

import type { PlayerResult, ResultCell } from '../../api/roundResults';
import { PointsCounter } from './PointsCounter';
import { ResultCellView } from './ResultCellView';

interface ResultsTableProps {
  players: readonly PlayerResult[];
  currentPlayerId: PlayerId;
  revealedCategories: number;
  scoresRevealed: boolean;
  /** True while the synchronized reveal is still running. */
  live: boolean;
  onSelectCell?: (player: PlayerResult, cell: ResultCell) => void;
}

/**
 * Results grid. Rows keep the stable participant order (never re-sorted by score),
 * columns follow the official category order. The player and points columns are
 * sticky so a horizontally scrolled table stays readable on phones.
 */
export function ResultsTable({
  players,
  currentPlayerId,
  revealedCategories,
  scoresRevealed,
  live,
  onSelectCell,
}: ResultsTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const headers = useRef<(HTMLTableCellElement | null)[]>([]);
  const userScrolled = useRef(false);
  const reducedMotion = useReducedMotion();

  // During the live reveal, bring the newly revealed category into view on narrow
  // screens — unless the user has taken over scrolling. Never after the reveal.
  useEffect(() => {
    const container = scroller.current;
    const header = headers.current[revealedCategories - 1];
    if (!live || userScrolled.current || !container || !header) return;
    if (container.scrollWidth <= container.clientWidth) return;
    const left = header.offsetLeft - (container.clientWidth - header.offsetWidth) / 2;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [revealedCategories, live, reducedMotion]);

  // When the live reveal ends, return a scrolled table to its start (player names and
  // the first categories) — unless the user took over scrolling.
  const wasLive = useRef(live);
  useEffect(() => {
    const container = scroller.current;
    if (
      wasLive.current &&
      !live &&
      !userScrolled.current &&
      container &&
      container.scrollLeft > 0
    ) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ left: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    }
    wasLive.current = live;
  }, [live, reducedMotion]);

  // Any manual interaction with the scroller hands scrolling back to the user.
  useEffect(() => {
    const container = scroller.current;
    if (!container) return;
    const markUserScroll = () => {
      userScrolled.current = true;
    };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const event of events)
      container.addEventListener(event, markUserScroll, { passive: true });
    return () => {
      for (const event of events) container.removeEventListener(event, markUserScroll);
    };
  }, []);

  return (
    <div ref={scroller} className="overflow-x-auto overscroll-x-contain pb-2">
      <table className="w-full min-w-[60rem] border-separate border-spacing-x-0 border-spacing-y-1.5 text-left">
        <caption className="sr-only">
          Резултати от рунда: отговорите на всеки играч по категории и точките му
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-28 bg-ink-900 px-2 text-xs font-bold tracking-wide text-fg-subtle uppercase shadow-[10px_0_12px_-10px_rgb(0_0_0/0.8)] sm:w-36"
            >
              Играч
            </th>
            {CATEGORY_IDS.map((category, index) => (
              <th
                key={category}
                scope="col"
                ref={(element) => {
                  headers.current[index] = element;
                }}
                className={cn(
                  'px-2 text-xs font-bold tracking-wide uppercase transition-colors duration-(--motion-normal)',
                  index < revealedCategories ? 'text-fg' : 'text-fg-subtle',
                  live && index === revealedCategories - 1 && 'animate-column-flash text-brand-300',
                )}
              >
                {CATEGORY_LABELS[category]}
              </th>
            ))}
            <th
              scope="col"
              className="sticky right-0 z-10 w-20 bg-ink-900 px-2 text-center text-xs font-bold tracking-wide text-fg-subtle uppercase shadow-[-10px_0_12px_-10px_rgb(0_0_0/0.8)]"
            >
              {POINTS_COLUMN_LABEL}
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, rowIndex) => {
            const isYou = player.playerId === currentPlayerId;
            return (
              <tr key={player.playerId}>
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 bg-ink-900 px-2 align-middle text-sm font-bold shadow-[10px_0_12px_-10px_rgb(0_0_0/0.8)]',
                    isYou && 'text-brand-300',
                  )}
                >
                  <span className="block max-w-28 truncate sm:max-w-36">{player.displayName}</span>
                  {isYou ? (
                    <span className="block text-[0.65rem] font-medium text-fg-subtle">ти</span>
                  ) : null}
                  {player.left ? (
                    <span className="block text-[0.65rem] font-medium text-fg-subtle">напусна</span>
                  ) : null}
                </th>
                {player.cells.map((cell, index) => {
                  const revealed = index < revealedCategories;
                  return (
                    <td key={cell.category} className="min-w-32 px-[3px] align-top">
                      <ResultCellView
                        cell={cell}
                        playerName={player.displayName}
                        revealed={revealed}
                        staggerIndex={rowIndex}
                        animate={live && revealed && index === revealedCategories - 1}
                        {...(onSelectCell && revealed && cell.state !== 'empty' && cell.state !== 'wrong_letter'
                          ? {
                              onSelect: () => {
                                onSelectCell(player, cell);
                              },
                            }
                          : {})}
                      />
                    </td>
                  );
                })}
                <td className="sticky right-0 z-10 bg-ink-900 px-[3px] align-middle shadow-[-10px_0_12px_-10px_rgb(0_0_0/0.8)]">
                  <div
                    className={cn(
                      'grid min-h-14 place-items-center rounded-xl border font-display text-2xl font-black tabular-nums',
                      scoresRevealed
                        ? 'border-brand-400/50 bg-brand-500/15 text-brand-300'
                        : 'border-white/8 bg-white/[0.03] text-fg-subtle',
                    )}
                  >
                    {scoresRevealed ? (
                      <PointsCounter value={player.roundPoints} animateInitial={live} />
                    ) : (
                      <>
                        <span aria-hidden="true">?</span>
                        <span className="sr-only">скрито</span>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
