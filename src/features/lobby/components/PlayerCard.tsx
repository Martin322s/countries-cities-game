import type { ConnectionStatus } from '@/domain';
import { cn } from '@/shared/lib/cn';
import { CrownIcon } from '@/shared/ui/icons';

import type { LobbyPlayer } from '../lobbyModel';

const AVATAR_CLASSES = [
  'from-brand-400 to-accent-500',
  'from-cyan-400 to-violet-400',
  'from-violet-400 to-accent-400',
  'from-status-unique to-cyan-400',
  'from-brand-300 to-brand-500',
  'from-accent-400 to-brand-400',
] as const;

/** Stable colour per player, derived from their id. */
function avatarClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length] ?? AVATAR_CLASSES[0];
}

const STATUS: Record<ConnectionStatus, { label: string; dot: string }> = {
  connected: { label: 'На линия', dot: 'bg-status-unique' },
  reconnecting: { label: 'Свързва се отново', dot: 'bg-status-warning animate-pulse' },
  disconnected: { label: 'Офлайн', dot: 'bg-status-empty' },
};

export function PlayerCard({ player }: { player: LobbyPlayer }) {
  const status = STATUS[player.status];
  const initial = Array.from(player.displayName)[0]?.toLocaleUpperCase('bg-BG') ?? '?';

  return (
    <li
      className={cn(
        'flex animate-rise items-center gap-3 rounded-2xl border px-3 py-3 transition-colors',
        player.isHost ? 'border-brand-400/40 bg-brand-500/10' : 'border-white/10 bg-white/5',
        player.status === 'disconnected' && 'opacity-60',
      )}
    >
      <span className="relative shrink-0">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-11 place-items-center rounded-full bg-linear-to-br font-display text-lg font-black text-ink-950',
            avatarClass(player.id),
          )}
        >
          {initial}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink-900',
            status.dot,
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-fg">
          {player.displayName}
          {player.isYou ? (
            <span className="ml-1.5 text-xs font-medium text-fg-subtle">(ти)</span>
          ) : null}
        </span>
        <span className="text-xs text-fg-subtle">{status.label}</span>
      </span>
      {player.isHost ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-400/15 px-2.5 py-1 text-xs font-bold text-brand-300">
          <CrownIcon width={14} height={14} />
          Хост
        </span>
      ) : null}
    </li>
  );
}
