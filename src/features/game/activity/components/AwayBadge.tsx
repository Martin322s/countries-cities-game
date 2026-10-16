import { useMemo } from 'react';

import {
  formatAwayDuration,
  intervalDurationMs,
  isMeaningful,
  isOpen,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { EyeOffIcon } from '@/shared/ui/icons';

import { selectLatestInterval, useAwayClock, useRoundActivity } from '../useRoundActivity';

/**
 * "извън играта · 8 сек." on a player's row while their game page is hidden (once the
 * absence passed the display threshold). The seconds come from the server's away_at
 * and the estimated server clock; this leaf is the only thing that ticks.
 */
export function AwayBadge({
  roomId,
  roundId,
  playerId,
}: {
  roomId: RoomId;
  roundId: RoundId;
  playerId: PlayerId;
}) {
  const select = useMemo(() => selectLatestInterval(playerId), [playerId]);
  const { data: interval } = useRoundActivity(roomId, roundId, { select });
  const open = interval?.returnedAt === null ? interval : null;
  const now = useAwayClock(open?.awayAt ?? null);

  if (!open || !isOpen(open, now) || !isMeaningful(open, now)) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-warning/50 px-2 py-0.5 text-xs font-bold text-status-warning tabular-nums">
      <EyeOffIcon width={13} height={13} />
      извън играта · {formatAwayDuration(intervalDurationMs(open, now))}
    </span>
  );
}
