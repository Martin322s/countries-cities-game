import { useEffect, useState, type CSSProperties } from 'react';

import { CATEGORY_LABELS } from '@/domain';
import { cn } from '@/shared/lib/cn';
import { BanIcon, CheckIcon, DuplicateIcon, MapPinIcon } from '@/shared/ui/icons';
import { Dialog } from '@/shared/ui/Dialog';

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
const GEOGRAPHIC_CATEGORIES = new Set(['country', 'city', 'village']);
let googleMapsKeyWarningShown = false;

function getGoogleMapsEmbedKey() {
  const key =
    typeof import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY === 'string'
      ? import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY.trim()
      : '';
  if (!key && import.meta.env.DEV && !googleMapsKeyWarningShown) {
    console.warn('Google Maps Embed key is not configured');
    googleMapsKeyWarningShown = true;
  }
  return key;
}

function buildGoogleMapsQuery(category: ResultCell['category'], answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) return '';
  return `${trimmed} ${CATEGORY_LABELS[category]}`;
}

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
  canEdit?: boolean;
  /** Opens the explanation, with editing controls only for the host. */
  onSelect?: () => void;
}

export function ResultCellView({
  cell,
  playerName,
  revealed,
  staggerIndex,
  animate,
  canEdit = false,
  onSelect,
}: ResultCellViewProps) {
  const category = CATEGORY_LABELS[cell.category];
  // A host invalidation that changes this cell (unique ↔ duplicate, → invalid…) gets
  // a brief highlight — once, without replaying the category reveal.
  const [lastState, setLastState] = useState(cell.state);
  const [changes, setChanges] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    setMapLoaded(false);
    setMapError(false);
  }, [mapOpen]);

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
  const googleMapsKey = getGoogleMapsEmbedKey();
  const mapQuery = buildGoogleMapsQuery(cell.category, cell.answer);
  const showMapsButton =
    cell.state !== 'empty' &&
    cell.answer.trim() !== '' &&
    GEOGRAPHIC_CATEGORIES.has(cell.category) &&
    Boolean(googleMapsKey) &&
    Boolean(mapQuery);

  const mapButton = showMapsButton ? (
    <button
      type="button"
      onClick={() => setMapOpen(true)}
      title="Покажи на картата"
      aria-label={`Покажи ${cell.answer} на картата`}
      className="grid size-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-fg-subtle transition hover:border-brand-400/60 hover:bg-brand-500/10 hover:text-brand-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
    >
      <MapPinIcon width={14} height={14} />
    </button>
  ) : null;

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

  const mapContent = onSelect ? (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={onSelect}
        title={duplicateHint}
        aria-label={`${playerName}, ${category}: ${cell.state === 'empty' ? 'празен' : cell.answer} — ${CELL_STATE_LABELS[cell.state]}. ${canEdit ? 'Промени валидността' : 'Виж причината за анулиране'}`}
        className={cn('flex min-w-0 flex-1 items-center gap-2 text-left', 'cursor-pointer transition hover:brightness-125')}
        style={style}
      >
        {content}
      </button>
      {mapButton}
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-2" style={style} title={duplicateHint}>
      {content}
      {mapButton}
    </div>
  );

  return (
    <>
      <div className={classes}>{mapContent}</div>
      {showMapsButton && mapOpen ? (
        <Dialog
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          title={cell.answer}
          description={CATEGORY_LABELS[cell.category]}
        >
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
              {!mapLoaded && !mapError ? (
                <div className="flex h-[320px] items-center justify-center text-sm text-fg-muted">
                  Зареждане на картата...
                </div>
              ) : null}
              {mapError ? (
                <div className="flex h-[320px] items-center justify-center px-4 text-center text-sm text-fg-muted">
                  Картата не може да бъде заредена.
                </div>
              ) : (
                <iframe
                  title={`Google Maps for ${cell.answer}`}
                  src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(googleMapsKey)}&q=${encodeURIComponent(mapQuery)}`}
                  className={cn('block h-[320px] w-full border-0', !mapLoaded && 'hidden')}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={() => setMapLoaded(true)}
                  onError={() => setMapError(true)}
                />
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-brand-400/50 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-200 transition hover:bg-brand-500/20"
              >
                Отвори в Google Maps
              </a>
              <button
                type="button"
                onClick={() => setMapOpen(false)}
                className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-white/10"
              >
                Затвори
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
