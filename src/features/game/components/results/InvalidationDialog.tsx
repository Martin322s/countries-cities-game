import { CATEGORY_LABELS } from '@/domain';
import { roomErrorMessage, type RoomError } from '@/features/rooms/api/roomErrors';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { Notice } from '@/shared/ui/Notice';

import type { PlayerResult, ResultCell } from '../../api/roundResults';
import { CELL_STATE_LABELS } from './cellStates';
import { invalidationExplanation } from './invalidationExplanation';

export interface SelectedCell {
  player: PlayerResult;
  cell: ResultCell;
}

interface InvalidationDialogProps {
  selected: SelectedCell | null;
  canEdit: boolean;
  pending: boolean;
  error: RoomError | null;
  onConfirm: (invalidated: boolean) => void;
  onClose: () => void;
}

/**
 * Explanation for every player, with contextual actions for the host. Opening it is the first, deliberate
 * step; the action button is the second — so a stray click never changes a score.
 * Native <dialog> provides focus trapping and returns focus to the cell on close.
 */
export function InvalidationDialog({
  selected,
  canEdit,
  pending,
  error,
  onConfirm,
  onClose,
}: InvalidationDialogProps) {
  const invalid = selected?.cell.state === 'invalid';
  const explanation = selected ? invalidationExplanation(selected.cell) : null;
  return (
    <Dialog
      open={selected !== null}
      onClose={onClose}
      title={
        selected
          ? `${selected.player.displayName} · ${CATEGORY_LABELS[selected.cell.category]}`
          : ''
      }
      description={
        invalid
          ? 'Отговорът е отбелязан като невалиден и носи 0 точки.'
          : 'Невалиден отговор носи 0 точки и не участва в сравнението за повторения.'
      }
    >
      {selected ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-xl border border-white/10 bg-ink-950/60 px-4 py-3 text-lg font-semibold">
            {selected.cell.answer}
            <span className="ml-2 text-xs font-medium text-fg-subtle">
              ({CELL_STATE_LABELS[selected.cell.state]})
            </span>
          </p>
          {explanation ? (
            <section
              aria-label="Причина за анулиране"
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <h3 className="mb-2 font-semibold">Защо е анулиран отговорът?</h3>
              <p className="text-sm text-fg-muted">{explanation}</p>
            </section>
          ) : null}
          {error ? (
            <Notice tone="error">{roomErrorMessage(error.code, 'invalidate')}</Notice>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {canEdit ? 'Отказ' : 'Затвори'}
            </Button>
            {canEdit ? (
              <Button
                onClick={() => {
                  onConfirm(!invalid);
                }}
                disabled={pending}
                aria-busy={pending}
              >
                {invalid ? 'ВЪЗСТАНОВИ ОТГОВОРА' : 'ОТБЕЛЕЖИ КАТО НЕВАЛИДЕН'}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
