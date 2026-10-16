import { useCallback, useMemo, type ReactNode } from 'react';

import type { PlayerId, RoomId, RoundId, RoundParticipant } from '@/domain';
import { cn } from '@/shared/lib/cn';
import { EyeOffIcon } from '@/shared/ui/icons';

import { useActivityNotifications } from '../useActivityNotifications';
import { useRoundActivity } from '../useRoundActivity';

/**
 * A slot in the sticky round header that briefly shows one activity notification
 * ("Деси се върна след 6 сек.") in place of its normal content. It lives inside the
 * header, so it never covers an answer field and never moves the form; notifications
 * queue one after another. Screen readers hear each one once (polite), never a timer.
 */
export function ActivityHeaderSlot({
  roomId,
  roundId,
  playerId,
  participants,
  children,
}: {
  roomId: RoomId;
  roundId: RoundId;
  playerId: PlayerId;
  participants: readonly RoundParticipant[];
  children: ReactNode;
}) {
  const { data } = useRoundActivity(roomId, roundId);
  const names = useMemo(
    () => new Map(participants.map((p) => [p.playerId, p.displayName])),
    [participants],
  );
  // Re-scanning is harmless: every notification is announced at most once.
  const nameOf = useCallback((id: PlayerId) => names.get(id) ?? null, [names]);
  const toast = useActivityNotifications({ intervals: data?.intervals, playerId, nameOf });

  return (
    <div className="relative min-w-0 flex-1">
      <div className={cn(toast && 'invisible')}>{children}</div>
      <p
        aria-live="polite"
        className={cn('absolute inset-0 flex items-center', !toast && 'pointer-events-none')}
      >
        {toast ? (
          <span
            key={toast.key}
            className={cn(
              'inline-flex max-w-full animate-fade-in items-center gap-1.5 rounded-xl px-2.5 py-1 text-sm leading-tight font-bold',
              toast.audience === 'others'
                ? 'bg-status-warning/15 text-status-warning ring-1 ring-status-warning/40'
                : 'text-fg-muted',
            )}
          >
            <EyeOffIcon width={15} height={15} className="shrink-0" />
            <span className="line-clamp-2">{toast.text}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
