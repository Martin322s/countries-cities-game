import { useEffect, useId, useRef, type ReactNode } from 'react';

import { CloseIcon } from './icons';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Modal built on the native <dialog> element: focus trapping, Escape handling,
 * inert background and top-layer stacking come from the browser.
 */
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The browser focuses the first focusable element — the close button. Start in
      // the first field instead, so keyboard users can type and submit right away.
      dialog.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onCancel={(event) => {
        // Let React state drive closing so `open` stays the single source of truth.
        event.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(100%-2rem,28rem)] animate-dialog-in rounded-panel bg-ink-900/80 glass p-0 text-left text-fg"
    >
      {open ? (
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-display text-2xl font-bold">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-2 text-sm text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Затвори"
              className="-mt-1 -mr-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-fg-muted transition hover:bg-white/10 hover:text-fg"
            >
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
