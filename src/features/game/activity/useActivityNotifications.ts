import { useEffect, useRef, useState } from 'react';

import {
  displayThresholdMs,
  formatAwayDuration,
  intervalDurationMs,
  isMeaningful,
  type AwayInterval,
  type PlayerId,
} from '@/domain';

import { serverNow } from '../clock/serverClock';

/** How long one notification stays up; later ones queue behind it. */
export const ACTIVITY_TOAST_MS = 4_000;
/** Older pending notifications are dropped beyond this (the panel keeps the history). */
const MAX_QUEUED = 4;

export interface ActivityToast {
  key: string;
  text: string;
  /** "self" toasts are a subtle note to the player who was away; "others" inform the group. */
  audience: 'others' | 'self';
}

/**
 * Turns activity changes into a calm queue of one-line notifications:
 *  - "Деси напусна играта"       — once someone's absence reaches the display threshold
 *  - "Деси се върна след 6 сек." — when a meaningful absence ends with a return
 *  - "Отсъства 6 сек."           — the same moment, for the player themselves
 * Sub-threshold blips produce nothing. History present when the screen mounts (e.g.
 * after a refresh) is not replayed.
 */
export function useActivityNotifications({
  intervals,
  playerId,
  nameOf,
}: {
  intervals: readonly AwayInterval[] | undefined;
  playerId: PlayerId;
  nameOf: (playerId: PlayerId) => string | null;
}): ActivityToast | null {
  const announced = useRef(new Set<string>());
  const seeded = useRef(false);
  const mounted = useRef(true);
  const [queue, setQueue] = useState<ActivityToast[]>([]);
  // Bumped when an open absence crosses the threshold, to re-run the scan below.
  const [wake, setWake] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!intervals) return;
    const now = serverNow();
    const fresh: ActivityToast[] = [];
    let nextDue: number | null = null;

    for (const interval of intervals) {
      const awayKey = `${String(interval.id)}:away`;
      const returnKey = `${String(interval.id)}:return`;
      const meaningful = isMeaningful(interval, now);
      const self = interval.playerId === playerId;
      const name = nameOf(interval.playerId);

      if (!seeded.current) {
        // Already on screen as state (badge / panel); don't announce the past.
        if (interval.returnedAt !== null || meaningful) announced.current.add(awayKey);
        if (interval.returnedAt !== null) announced.current.add(returnKey);
        continue;
      }

      if (interval.returnedAt === null) {
        if (announced.current.has(awayKey)) continue;
        if (meaningful) {
          announced.current.add(awayKey);
          if (!self && name) {
            fresh.push({ key: awayKey, text: `${name} напусна играта`, audience: 'others' });
          }
        } else {
          const due = interval.awayAt + displayThresholdMs(interval) - now;
          nextDue = nextDue === null ? due : Math.min(nextDue, due);
        }
        continue;
      }

      if (announced.current.has(returnKey)) continue;
      announced.current.add(returnKey);
      announced.current.add(awayKey);
      if (!meaningful || interval.endedBy !== 'returned') continue;
      const duration = formatAwayDuration(intervalDurationMs(interval, now));
      if (self) {
        fresh.push({ key: returnKey, text: `Отсъства ${duration}`, audience: 'self' });
      } else if (name) {
        fresh.push({
          key: returnKey,
          text: `${name} се върна след ${duration}`,
          audience: 'others',
        });
      }
    }
    seeded.current = true;

    if (fresh.length > 0) {
      // Not cancelled on cleanup: these keys are already marked as announced.
      window.setTimeout(() => {
        if (mounted.current) setQueue((current) => [...current, ...fresh].slice(-MAX_QUEUED));
      }, 0);
    }
    let timeoutId: number | undefined;
    if (nextDue !== null) {
      timeoutId = window.setTimeout(
        () => {
          setWake((n) => n + 1);
        },
        Math.max(0, nextDue) + 20,
      );
    }
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [intervals, playerId, nameOf, wake]);

  const head = queue[0] ?? null;
  useEffect(() => {
    if (!head) return;
    const id = window.setTimeout(() => {
      setQueue((current) => current.slice(1));
    }, ACTIVITY_TOAST_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [head]);

  return head;
}
