import { cn } from '@/shared/lib/cn';

import { CONNECTION_STATE_LABELS, type ConnectionState } from './connectionState';

const DOT_CLASSES: Record<ConnectionState, string> = {
  connecting: 'bg-status-warning animate-pulse',
  connected: 'bg-status-unique',
  reconnecting: 'bg-status-warning animate-pulse',
  offline: 'bg-status-duplicate',
};

/** Subtle pill for the player's own connection — never a blocking modal. */
export function ConnectionIndicator({ state }: { state: ConnectionState }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        state === 'connected'
          ? 'border-white/10 bg-white/5 text-fg-muted'
          : 'border-status-warning/30 bg-status-warning/10 text-fg',
        state === 'offline' && 'border-status-duplicate/40 bg-status-duplicate/10',
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_CLASSES[state])} />
      {CONNECTION_STATE_LABELS[state]}
    </p>
  );
}
