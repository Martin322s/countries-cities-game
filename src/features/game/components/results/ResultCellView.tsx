import { useState, type CSSProperties } from 'react';

import { CATEGORY_LABELS } from '@/domain';
import { cn } from '@/shared/lib/cn';
import { BanIcon, CheckIcon, DuplicateIcon } from '@/shared/ui/icons';

import type { CellState, ResultCell } from '../../api/roundResults';
import { CELL_STATE_LABELS } from './cellStates';

const STATE_CLASSES: Record<CellState, string> = {
  unique: 'border-status-unique/50 bg-status-unique/12 [--cell-glow:rgb(52_211_153/0.45)]',
  duplicate:
    'border-status-duplicate/50 bg-status-duplicate/12 [--cell-glow:rgb(248_113_113/0.45)]',
  empty: 'border-white/8 bg-white/[0.03]',
  wrong_letter: 'border-dashed border-white/20 bg-white/[0.03]',
  invalid:
    'border-dashed border-status-invalidated/60 bg-status-invalidated/10 [--cell-glow:rgb(192_132_252/0.4)]',
};

const BADGE_CLASSES: Record<CellState, string> = {
  unique: 'bg-status-unique/20 text-status-unique',
  duplicate: 'bg-status-duplicate/20 text-status-duplicate',
  empty: 'text-fg-subtle',
  wrong_letter: 'bg-white/10 text-fg-muted',
  invalid: 'bg-status-invalidated/20 text-status-invalidated',
};

function StateIcon({ state }: { state: CellState }) {
  switch (state) {
    case 'unique':
      return <CheckIcon width={13} height={13} />;
    case 'duplicate':
      return <DuplicateIcon width={13} height={13} />;
    case 'invalid':
    case 'wrong_letter':
      return <BanIcon width={13} height={13} />;
    case 'empty':
      return null;
  }
}

interface ResultCellViewProps {
  cell: ResultCell;
  playerName: string;
  revealed: boolean;
  /** Row index, for a very slight stagger inside a revealed column. */
  staggerIndex: number;
  /** Animate the transition into the revealed state (only during the live reveal). */
  animate: boolean;
  /** Present only for the host on a revealed answer that the host can rule on. */
  onSelect?: () => void;
}

export function ResultCellView({
  cell,
  playerName,
  revealed,
  staggerIndex,
  animate,
  onSelect,
}: ResultCellViewProps) {
  const category = CATEGORY_LABELS[cell.category];
  // A host invalidation that changes this cell (unique ↔ duplicate, → invalid…) gets
  // a brief highlight — once, without replaying the category reveal.
  const [lastState, setLastState] = useState(cell.state);
  const [changes, setChanges] = useState(0);
  if (lastState !== cell.state) {
    setLastState(cell.state);
    if (revealed && !animate) setChanges((count) => count + 1);
  }

  if (!revealed) {
    return (
      <div className="flex h-full min-h-14 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03]">
        <span aria-hidden="true" className="flex gap-1">
          <span className="size-1.5 rounded-full bg-white/20" />
          <span className="size-1.5 rounded-full bg-white/20" />
          <span className="size-1.5 rounded-full bg-white/20" />
        </span>
        <span className="sr-only">скрит</span>
      </div>
    );
  }

  const style: CSSProperties | undefined = animate
    ? { animationDelay: `${staggerIndex * 70}ms` }
    : undefined;
  const pointsLabel = cell.points > 0 ? `+${cell.points}` : '0';
  const duplicateHint =
    cell.state === 'duplicate'
      ? `Същият отговор имат ${cell.duplicateCount} играчи`
      : cell.state === 'wrong_letter'
        ? 'Не започва с буквата на рунда'
        : undefined;

  const content = (
    <>
      <span
        className={cn(
          'min-w-0 flex-1 text-left text-sm leading-snug font-semibold break-words',
          cell.state === 'empty' && 'text-fg-subtle',
          cell.state === 'invalid' && 'text-fg-muted line-through decoration-status-invalidated/80',
          cell.state === 'wrong_letter' && 'text-fg-muted line-through decoration-white/50',
        )}
      >
        {cell.state === 'empty' ? '—' : cell.answer}
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-black tabular-nums',
          BADGE_CLASSES[cell.state],
        )}
      >
        <StateIcon state={cell.state} />
        {cell.state === 'duplicate' && cell.duplicateCount > 1 ? (
          <span aria-hidden="true">×{cell.duplicateCount}</span>
        ) : null}
        <span aria-hidden="true">{pointsLabel}</span>
      </span>
      <span className="sr-only">
        {`: ${CELL_STATE_LABELS[cell.state]}, ${cell.points === 1 ? '1 точка' : '0 точки'}`}
        {duplicateHint ? `. ${duplicateHint}` : ''}
      </span>
    </>
  );

  const classes = cn(
    'flex h-full min-h-14 w-full items-center gap-2 rounded-xl border px-2.5 py-2 [transform-style:preserve-3d]',
    STATE_CLASSES[cell.state],
    animate && 'animate-cell-reveal',
    // Two identical animations, alternated: restarts the highlight without remounting
    // the cell (a remount would drop the host's keyboard focus).
    changes > 0 && (changes % 2 === 1 ? 'animate-cell-update' : 'animate-cell-update-again'),
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        title={duplicateHint}
        aria-label={`${playerName}, ${category}: ${cell.state === 'empty' ? 'празен' : cell.answer} — ${CELL_STATE_LABELS[cell.state]}. Промени валидността`}
        className={cn(classes, 'cursor-pointer transition hover:brightness-125')}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={classes} style={style} title={duplicateHint}>
      {content}
    </div>
  );
}
