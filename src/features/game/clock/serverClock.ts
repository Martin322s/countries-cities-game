/**
 * Estimated server clock. All game timing is derived from server timestamps
 * (countdown_at / started_at / ends_at) compared against `serverNow()`, never from
 * client-side counters.
 *
 * Each game-state request returns the server's clock_timestamp(). Assuming the
 * server stamped it halfway through the round trip, offset = server − midpoint.
 * The sample with the smallest round trip is the most precise, so it is kept until
 * it becomes old (clocks drift, networks change).
 */
export interface ClockSample {
  offsetMs: number;
  rttMs: number;
  takenAt: number;
}

const SAMPLE_MAX_AGE_MS = 60_000;

export function clockSampleFrom(input: {
  serverMs: number;
  requestStart: number;
  requestEnd: number;
}): ClockSample {
  const rttMs = Math.max(0, input.requestEnd - input.requestStart);
  return {
    offsetMs: input.serverMs - (input.requestStart + input.requestEnd) / 2,
    rttMs,
    takenAt: input.requestEnd,
  };
}

/** Keeps the more precise sample, unless the kept one has aged out. */
export function preferSample(current: ClockSample | null, next: ClockSample): ClockSample {
  if (!current) return next;
  if (next.takenAt - current.takenAt > SAMPLE_MAX_AGE_MS) return next;
  return next.rttMs <= current.rttMs ? next : current;
}

let sample: ClockSample | null = null;
const listeners = new Set<() => void>();

export function recordClockSample(input: {
  serverMs: number;
  requestStart: number;
  requestEnd: number;
}): void {
  if (!Number.isFinite(input.serverMs)) return;
  sample = preferSample(sample, clockSampleFrom(input));
  for (const listener of listeners) listener();
}

/** Estimated current server time (epoch ms). */
export function serverNow(): number {
  return Date.now() + (sample?.offsetMs ?? 0);
}

export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: forget the current estimate. */
export function resetServerClock(): void {
  sample = null;
}
