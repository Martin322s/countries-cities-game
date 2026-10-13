import { useId } from 'react';

import type { RoundId } from '@/domain';
import { cn } from '@/shared/lib/cn';

import type { RevealedRound } from '../../api/gameState';

interface RoundNavigatorProps {
  rounds: readonly RevealedRound[];
  viewingId: RoundId;
  currentId: RoundId;
  totalRounds: number;
  onSelect: (roundId: RoundId) => void;
}

/**
 * Browse completed rounds: previous / next plus a native select (keyboard- and
 * mobile-friendly). Browsing never changes the game itself.
 */
export function RoundNavigator({
  rounds,
  viewingId,
  currentId,
  totalRounds,
  onSelect,
}: RoundNavigatorProps) {
  const selectId = useId();
  const index = rounds.findIndex((round) => round.id === viewingId);
  const viewing = rounds[index];
  const previous = index > 0 ? rounds[index - 1] : undefined;
  const next = index >= 0 && index < rounds.length - 1 ? rounds[index + 1] : undefined;
  const isCurrent = viewingId === currentId;

  const navButton =
    'grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-white/12 bg-white/5 text-lg font-bold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <nav aria-label="Рундове" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={navButton}
        disabled={!previous}
        aria-label="Предишен рунд"
        onClick={() => {
          if (previous) onSelect(previous.id);
        }}
      >
        ‹
      </button>
      <label htmlFor={selectId} className="sr-only">
        Избери рунд
      </label>
      <select
        id={selectId}
        value={viewingId}
        onChange={(event) => {
          onSelect(event.target.value as RoundId);
        }}
        className="h-10 rounded-xl border border-white/12 bg-ink-950/60 px-3 font-display text-sm font-bold"
      >
        {rounds.map((round) => (
          <option key={round.id} value={round.id}>
            Рунд {round.number} / {totalRounds}
            {round.letter ? ` · ${round.letter}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={navButton}
        disabled={!next}
        aria-label="Следващ рунд"
        onClick={() => {
          if (next) onSelect(next.id);
        }}
      >
        ›
      </button>
      <span
        aria-live="polite"
        className={cn(
          'rounded-full px-2.5 py-1 text-xs font-bold',
          isCurrent ? 'bg-brand-400/15 text-brand-300' : 'bg-violet-400/15 text-violet-400',
        )}
      >
        {isCurrent ? 'Текущ рунд' : `Предишен рунд${viewing ? ` (${viewing.number})` : ''}`}
      </span>
    </nav>
  );
}
