import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVEAL_DURATION_MS } from '@/domain';

import { recordClockSample, resetServerClock } from '../clock/serverClock';
import { useRevealProgress } from './useResults';

const NOW = Date.parse('2026-01-01T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetServerClock();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRevealProgress', () => {
  it('never steps back when the server-clock estimate is corrected backwards', () => {
    const revealAt = NOW - REVEAL_DURATION_MS - 300;
    recordClockSample({ serverMs: NOW, requestStart: NOW, requestEnd: NOW });
    const { result } = renderHook(() => useRevealProgress(revealAt));
    expect(result.current.complete).toBe(true);

    // A new, more precise sample says the server is 2 s behind what we thought
    // (a fresh rtt-0 sample replaces the old one).
    act(() => {
      recordClockSample({ serverMs: NOW - 2_000, requestStart: NOW, requestEnd: NOW });
    });
    expect(result.current.complete).toBe(true);
    expect(result.current.revealedCategories).toBe(7);
  });
});
