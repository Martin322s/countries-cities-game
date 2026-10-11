import { CheckIcon } from '@/shared/ui/icons';

/**
 * Replaces a ГОТОВ button once it was pressed — in the same place and at the same
 * height, so the acknowledgement appears where the player acted and nothing jumps.
 */
export function ReadyConfirmed({ detail }: { detail: string }) {
  return (
    <div
      role="status"
      className="flex min-h-14 w-full animate-status-in items-center justify-center gap-3 rounded-2xl border border-status-unique/40 bg-status-unique/10 px-5 py-2 text-left sm:min-h-16 sm:w-auto sm:min-w-80"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-status-unique text-ink-950"
      >
        <CheckIcon width={20} height={20} strokeWidth={3} />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-base font-black tracking-wide text-status-unique">
          ГОТОВ СИ
        </span>
        <span className="block text-sm text-fg-muted">{detail}</span>
      </span>
    </div>
  );
}
