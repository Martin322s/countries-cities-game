import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clockSampleFrom,
  preferSample,
  recordClockSample,
  resetServerClock,
  serverNow,
} from './serverClock';

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe('server clock estimation', () => {
  it('assumes the server stamped the midpoint of the round trip', () => {
    const sample = clockSampleFrom({ serverMs: 10_150, requestStart: 1_000, requestEnd: 1_200 });
    expect(sample.offsetMs).toBe(9_050);
    expect(sample.rttMs).toBe(200);
  });

  it('prefers the sample with the shortest round trip', () => {
    const precise = clockSampleFrom({ serverMs: 5_050, requestStart: 0, requestEnd: 100 });
    const noisy = clockSampleFrom({ serverMs: 5_900, requestStart: 1_000, requestEnd: 2_000 });
    expect(preferSample(precise, noisy)).toBe(precise);
    expect(preferSample(noisy, precise)).toBe(precise);
  });

  it('replaces an old sample even if it was more precise', () => {
    const old = clockSampleFrom({ serverMs: 50, requestStart: 0, requestEnd: 10 });
    const fresh = clockSampleFrom({
      serverMs: 100_500,
      requestStart: 100_000,
      requestEnd: 101_000,
    });
    expect(preferSample(old, fresh)).toBe(fresh);
  });

  it('applies the offset to the local clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    recordClockSample({ serverMs: 15_000, requestStart: 10_000, requestEnd: 10_000 });
    expect(serverNow()).toBe(15_000);
    vi.setSystemTime(11_000);
    expect(serverNow()).toBe(16_000);
  });

  it('ignores unparseable server timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    recordClockSample({ serverMs: Number.NaN, requestStart: 0, requestEnd: 0 });
    expect(serverNow()).toBe(10_000);
  });
});
