import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { AwayInterval, PlayerId, RoomId, RoundId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import type { RoomError } from '@/features/rooms/api/roomErrors';

import { fetchRoundActivity, type RoundActivity } from '../api/activity';
import { serverNow, subscribeServerClock } from '../clock/serverClock';

/**
 * Fair-play activity of one round. Live rounds are refreshed by realtime
 * (visibility_events changes on the room channel); a past round never changes, so it
 * is cached for good once loaded. No polling.
 */
export function useRoundActivity<T = RoundActivity>(
  roomId: RoomId,
  roundId: RoundId,
  {
    immutable = false,
    select,
  }: { immutable?: boolean; select?: (activity: RoundActivity) => T } = {},
) {
  return useQuery<RoundActivity, RoomError, T>({
    queryKey: roomKeys.activity(roomId, roundId),
    queryFn: () => fetchRoundActivity(roomId, roundId),
    ...(select ? { select } : {}),
    ...(immutable ? { staleTime: Infinity, gcTime: Infinity } : {}),
  });
}

/** The player's open (or last) interval only — badges re-render just for that player. */
export function selectLatestInterval(playerId: PlayerId) {
  return (activity: RoundActivity): AwayInterval | null =>
    activity.intervals.findLast((interval) => interval.playerId === playerId) ?? null;
}

/**
 * Estimated server time ticking once per second while `anchor` (an open interval's
 * away_at) is set, aligned to it so every screen flips the elapsed second together.
 * Without an anchor it does not tick at all. Only small leaf components use it.
 */
export function useAwayClock(anchor: number | null): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (anchor === null) return;
    let timeoutId: number | undefined;
    const schedule = (first: boolean) => {
      const current = serverNow();
      const phase = (((current - anchor) % 1000) + 1000) % 1000;
      timeoutId = window.setTimeout(
        () => {
          setNow(serverNow());
          schedule(false);
        },
        first ? 0 : 1000 - phase + 5,
      );
    };
    schedule(true);
    const unsubscribe = subscribeServerClock(() => {
      setNow(serverNow());
    });
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [anchor]);

  return now;
}
