import { useEffect, useState } from 'react';

import { serverNow, subscribeServerClock } from './serverClock';

/**
 * Estimated server time that re-renders only when one of the given server-time
 * milestones is reached (or the clock estimate changes). Screens use it to switch
 * stages exactly at started_at / ends_at without re-rendering every second.
 */
export function useServerNowAt(first: number | null, second: number | null = null): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const current = serverNow();
    const timeouts: number[] = [];
    for (const milestone of [first, second]) {
      if (milestone !== null && milestone > current) {
        timeouts.push(
          window.setTimeout(
            () => {
              setNow(serverNow());
            },
            milestone - current + 15,
          ),
        );
      }
    }
    const unsubscribe = subscribeServerClock(() => {
      setNow(serverNow());
    });
    return () => {
      for (const id of timeouts) window.clearTimeout(id);
      unsubscribe();
    };
  }, [first, second]);

  return now;
}

/**
 * Estimated server time that re-renders once per second, phase-aligned to `anchor`
 * (e.g. ends_at), so every client flips the displayed second at the same moment.
 * Only small leaf components (timer, countdown) should use this.
 */
export function useServerSecondTick(anchor: number | null): number {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    let timeoutId: number | undefined;
    const schedule = () => {
      const current = serverNow();
      const phase = ((((anchor ?? 0) - current) % 1000) + 1000) % 1000;
      timeoutId = window.setTimeout(
        () => {
          setNow(serverNow());
          schedule();
        },
        (phase === 0 ? 1000 : phase) + 5,
      );
    };
    schedule();
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

/** Estimated server time refreshed every `intervalMs` — for slow-changing statuses. */
export function useServerNowEvery(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(serverNow());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
