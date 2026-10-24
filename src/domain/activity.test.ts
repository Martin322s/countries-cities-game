import { describe, expect, it } from 'vitest';

import {
  awaySeconds,
  formatAwayCount,
  formatAwayDuration,
  intervalDurationMs,
  isMeaningful,
  isOpen,
  isPlayerVisible,
  MEANINGFUL_AWAY_MS,
  nextVisibilityReport,
  shouldMonitorVisibility,
  summarizeActivity,
  TAB_STALE_MS,
  UNLOAD_GRACE_MS,
  type AwayInterval,
  type TabObservation,
} from './activity';
import type { PlayerId } from './ids';

const DESI = 'desi' as PlayerId;
const KALOYAN = 'kaloyan' as PlayerId;
const STOYAN = 'stoyan' as PlayerId;
const T0 = 1_000_000;
const CAP = T0 + 60_000;

let nextId = 1;
const interval = (overrides: Partial<AwayInterval> = {}): AwayInterval => ({
  id: nextId++,
  playerId: DESI,
  source: 'visibility',
  awayAt: T0,
  returnedAt: null,
  endedBy: null,
  capAt: CAP,
  ...overrides,
});
const returnedAfter = (ms: number, overrides: Partial<AwayInterval> = {}) =>
  interval({ returnedAt: T0 + ms, endedBy: 'returned', ...overrides });

describe('meaningful threshold', () => {
  it('is a named 2-second constant', () => {
    expect(MEANINGFUL_AWAY_MS).toBe(2_000);
  });

  it('ignores 1.9 s', () => {
    expect(isMeaningful(returnedAfter(1_900), CAP)).toBe(false);
  });

  it('counts exactly 2.0 s', () => {
    expect(isMeaningful(returnedAfter(2_000), CAP)).toBe(true);
  });

  it('counts more than 2 s', () => {
    expect(isMeaningful(returnedAfter(6_400), CAP)).toBe(true);
  });

  it('gives an unload (refresh) a longer grace', () => {
    expect(isMeaningful(returnedAfter(3_000, { source: 'unload' }), CAP)).toBe(false);
    expect(isMeaningful(returnedAfter(UNLOAD_GRACE_MS, { source: 'unload' }), CAP)).toBe(true);
  });

  it('becomes meaningful while still away once the threshold passes', () => {
    const open = interval();
    expect(isMeaningful(open, T0 + 1_999)).toBe(false);
    expect(isMeaningful(open, T0 + 2_000)).toBe(true);
  });
});

describe('durations', () => {
  it('measures a completed interval from server timestamps', () => {
    expect(intervalDurationMs(returnedAfter(6_000), CAP + 99_000)).toBe(6_000);
  });

  it('measures a current absence as serverNow − awayAt', () => {
    const open = interval();
    expect(intervalDurationMs(open, T0 + 8_300)).toBe(8_300);
    expect(isOpen(open, T0 + 8_300)).toBe(true);
  });

  it('clamps an open interval to the end of the answering window', () => {
    const open = interval({ awayAt: CAP - 10_000 });
    expect(intervalDurationMs(open, CAP + 20 * 60_000)).toBe(10_000);
    expect(isOpen(open, CAP)).toBe(false);
  });

  it('formats whole seconds, rounded down', () => {
    expect(awaySeconds(1_999)).toBe(1);
    expect(formatAwayDuration(6_900)).toBe('6 сек.');
    expect(formatAwayCount(1)).toBe('1 излизане');
    expect(formatAwayCount(2)).toBe('2 излизания');
  });
});

describe('summarizeActivity', () => {
  it('aggregates meaningful intervals per player and totals their durations', () => {
    const intervals = [
      returnedAfter(6_000),
      interval({ awayAt: T0 + 20_000, returnedAt: T0 + 25_000, endedBy: 'returned' }),
      interval({ awayAt: T0 + 30_000, returnedAt: T0 + 30_800, endedBy: 'returned' }), // < 2 s
      returnedAfter(3_000, { playerId: KALOYAN }),
    ];
    const [desi, kaloyan, stoyan] = summarizeActivity(intervals, [DESI, KALOYAN, STOYAN], CAP);
    expect(desi).toEqual({ playerId: DESI, count: 2, totalMs: 11_000, current: null });
    expect(kaloyan).toMatchObject({ count: 1, totalMs: 3_000 });
    expect(stoyan).toEqual({ playerId: STOYAN, count: 0, totalMs: 0, current: null });
  });

  it('includes the current absence once it is meaningful', () => {
    const intervals = [returnedAfter(4_000), interval({ awayAt: T0 + 10_000 })];
    const early = summarizeActivity(intervals, [DESI], T0 + 11_000)[0];
    expect(early).toMatchObject({ count: 1, totalMs: 4_000 });
    expect(early?.current).toEqual({ awayAt: T0 + 10_000, elapsedMs: 1_000, meaningful: false });

    const later = summarizeActivity(intervals, [DESI], T0 + 18_000)[0];
    expect(later).toMatchObject({ count: 2, totalMs: 12_000 });
    expect(later?.current?.meaningful).toBe(true);
  });
});

describe('monitoring', () => {
  const base = {
    stage: 'playing',
    isParticipant: true,
    left: false,
    answersLocked: false,
  } as const;

  it('runs only while the player can still edit answers', () => {
    expect(shouldMonitorVisibility(base)).toBe(true);
    expect(shouldMonitorVisibility({ ...base, stage: 'countdown' })).toBe(false);
    expect(shouldMonitorVisibility({ ...base, stage: 'time_up' })).toBe(false);
    expect(shouldMonitorVisibility({ ...base, stage: 'results' })).toBe(false);
    expect(shouldMonitorVisibility({ ...base, isParticipant: false })).toBe(false);
    expect(shouldMonitorVisibility({ ...base, left: true })).toBe(false);
  });

  it('stops after the player locked their answers (READY)', () => {
    expect(shouldMonitorVisibility({ ...base, answersLocked: true })).toBe(false);
  });
});

describe('multiple tabs', () => {
  const now = 50_000;

  it('keeps the player visible while another tab is visible', () => {
    expect(isPlayerVisible(false, [{ visible: true, seenAt: now - 1_000 }], now)).toBe(true);
  });

  it('treats the player as away when every tab is hidden', () => {
    expect(isPlayerVisible(false, [{ visible: false, seenAt: now }], now)).toBe(false);
  });

  it('ignores a visible tab that went silent (closed or crashed)', () => {
    expect(isPlayerVisible(false, [{ visible: true, seenAt: now - TAB_STALE_MS - 1 }], now)).toBe(
      false,
    );
  });

  it('walks the A/B scenario without duplicate reports', () => {
    const obs = (selfVisible: boolean, playerVisible: boolean): TabObservation => ({
      selfVisible,
      playerVisible,
    });
    // Tab A visible, tab B hidden → player visible; A reports its initial return (no-op).
    expect(nextVisibilityReport(null, obs(true, true))).toBe('return');
    // B (hidden) starts: no away from a background tab that just appeared.
    expect(nextVisibilityReport(null, obs(false, true))).toBeNull();
    // A hidden while B hidden → A sees the player go away.
    expect(nextVisibilityReport(obs(true, true), obs(false, false))).toBe('away');
    // B also hears about it but saw no own transition worth reporting twice.
    expect(nextVisibilityReport(obs(false, false), obs(false, false))).toBeNull();
    // B becomes visible → B reports the return.
    expect(nextVisibilityReport(obs(false, false), obs(true, true))).toBe('return');
    // A, still hidden, learns the player is visible again: nothing to report.
    expect(nextVisibilityReport(obs(false, false), obs(false, true))).toBeNull();
  });

  it('does not report away when only this tab is hidden', () => {
    expect(
      nextVisibilityReport(
        { selfVisible: true, playerVisible: true },
        { selfVisible: false, playerVisible: true },
      ),
    ).toBeNull();
  });

  it('swallows duplicate browser events', () => {
    const hidden = { selfVisible: false, playerVisible: false };
    const visible = { selfVisible: true, playerVisible: true };
    expect(nextVisibilityReport(hidden, hidden)).toBeNull(); // pagehide + visibilitychange
    expect(nextVisibilityReport(visible, visible)).toBeNull(); // focus after visibilitychange
  });
});
