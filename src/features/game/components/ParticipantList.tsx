import type { ReactNode } from 'react';

import { deriveConnectionStatus, type PlayerId, type RoundParticipant } from '@/domain';
import { cn } from '@/shared/lib/cn';
import { CheckIcon, CrownIcon } from '@/shared/ui/icons';

export interface ParticipantStatus {
  label: string;
  done: boolean;
}

interface ParticipantListProps {
  participants: readonly RoundParticipant[];
  currentPlayerId: PlayerId;
  hostPlayerId: PlayerId;
  onlinePlayerIds: ReadonlySet<PlayerId>;
  now: number;
  statusOf: (participant: RoundParticipant) => ParticipantStatus;
  /** Optional extra indicator rendered before the status (e.g. fair-play activity). */
  badgeOf?: (participant: RoundParticipant) => ReactNode;
  label: string;
}

/** Compact roster with a per-stage status. Never shows answer content. */
export function ParticipantList({
  participants,
  currentPlayerId,
  hostPlayerId,
  onlinePlayerIds,
  now,
  statusOf,
  badgeOf,
  label,
}: ParticipantListProps) {
  return (
    <ul aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {participants.map((participant) => {
        const isYou = participant.playerId === currentPlayerId;
        const status = participant.left ? { label: 'Напусна', done: false } : statusOf(participant);
        const connection = isYou
          ? 'connected'
          : deriveConnectionStatus({
              inPresence: onlinePlayerIds.has(participant.playerId),
              lastSeenAt: participant.lastSeenAt,
              now,
            });
        return (
          <li
            key={participant.playerId}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors duration-(--motion-normal) ease-standard',
              status.done
                ? 'border-status-unique/40 bg-status-unique/10'
                : 'border-white/10 bg-white/5',
              isYou && 'ring-2 ring-brand-400/50',
              (participant.left || connection === 'disconnected') && 'opacity-60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                connection === 'connected' && 'bg-status-unique',
                connection === 'reconnecting' && 'animate-pulse bg-status-warning',
                connection === 'disconnected' && 'bg-status-empty',
              )}
            />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {participant.displayName}
              {isYou ? (
                <span className="ml-1.5 text-xs font-medium text-fg-subtle">(ти)</span>
              ) : null}
              {participant.playerId === hostPlayerId ? (
                <>
                  <CrownIcon width={14} height={14} className="ml-1.5 inline text-brand-300" />
                  <span className="sr-only"> (хост)</span>
                </>
              ) : null}
            </span>
            {participant.left ? null : badgeOf?.(participant)}
            <span
              // Re-keyed on change: only the status swaps in — the row and name stay put.
              key={status.label}
              className={cn(
                'inline-flex shrink-0 animate-status-in items-center gap-1 text-xs font-bold',
                status.done ? 'text-status-unique' : 'text-fg-subtle',
              )}
            >
              {status.done ? <CheckIcon width={14} height={14} strokeWidth={3} /> : null}
              {status.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
