import { describe, expect, it } from 'vitest';

import { getRemainingLetters, pickRandomLetter, type EligibleLetter } from './alphabet';
import { MEMBER_STALE_AFTER_MS, PRE_ROUND_COUNTDOWN_MS, ROUND_DURATION_MS } from './config';
import type { PlayerId } from './ids';
import {
  allAnswersLocked,
  deriveRoundStage,
  formatTimer,
  isRequiredForReadyCheck,
  readyProgress,
  timerUrgency,
  type RoundParticipant,
  type RoundTimeline,
} from './round';

const countdownAt = Date.parse('2026-01-01T12:00:00Z');
const timeline: RoundTimeline = {
  countdownAt,
  startedAt: countdownAt + PRE_ROUND_COUNTDOWN_MS,
  endsAt: countdownAt + PRE_ROUND_COUNTDOWN_MS + ROUND_DURATION_MS,
  lockedAt: null,
  revealAt: null,
};

describe('deriveRoundStage', () => {
  it('counts down 3, 2, 1 from the authoritative start time', () => {
    expect(deriveRoundStage('COUNTDOWN', timeline, countdownAt)).toEqual({
      kind: 'countdown',
      secondsLeft: 3,
    });
    expect(deriveRoundStage('COUNTDOWN', timeline, countdownAt + 1_200)).toEqual({
      kind: 'countdown',
      secondsLeft: 2,
    });
    expect(deriveRoundStage('COUNTDOWN', timeline, countdownAt + 2_999)).toEqual({
      kind: 'countdown',
      secondsLeft: 1,
    });
  });

  it('starts playing at started_at even if the persisted phase still says COUNTDOWN', () => {
    expect(deriveRoundStage('COUNTDOWN', timeline, timeline.startedAt!)).toEqual({
      kind: 'playing',
      remainingMs: ROUND_DURATION_MS,
    });
  });

  it('reconstructs the remaining time after a refresh mid-round', () => {
    const now = timeline.startedAt! + 45_500;
    expect(deriveRoundStage('PLAYING', timeline, now)).toEqual({
      kind: 'playing',
      remainingMs: ROUND_DURATION_MS - 45_500,
    });
  });

  it('locks at ends_at before the server has persisted the lock', () => {
    expect(deriveRoundStage('PLAYING', timeline, timeline.endsAt!)).toEqual({ kind: 'time_up' });
    expect(deriveRoundStage('PLAYING', timeline, timeline.endsAt! + 5_000)).toEqual({
      kind: 'time_up',
    });
  });

  it('treats a locked round as over regardless of the clock', () => {
    const locked = { ...timeline, lockedAt: timeline.startedAt! + 10_000 };
    expect(deriveRoundStage('PLAYING', locked, timeline.startedAt! + 20_000)).toEqual({
      kind: 'time_up',
    });
  });

  it('maps the remaining phases', () => {
    expect(deriveRoundStage('ROUND_WAITING', null, 0).kind).toBe('waiting');
    expect(deriveRoundStage('ROUND_LOCKED', timeline, 0).kind).toBe('results_ready');
    expect(deriveRoundStage('RESULTS_READY', timeline, 0).kind).toBe('results_ready');
    expect(deriveRoundStage('REVEAL', timeline, 0).kind).toBe('reveal');
    expect(deriveRoundStage('LOBBY', null, 0).kind).toBe('lobby');
  });
});

describe('timer formatting', () => {
  it('rounds up to whole seconds and reaches 0:00 at the deadline', () => {
    expect(formatTimer(120_000)).toBe('2:00');
    expect(formatTimer(119_001)).toBe('2:00');
    expect(formatTimer(119_000)).toBe('1:59');
    expect(formatTimer(9_500)).toBe('0:10');
    expect(formatTimer(1)).toBe('0:01');
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(-500)).toBe('0:00');
  });

  it('raises urgency under 30 s and again under 10 s', () => {
    expect(timerUrgency(31_000)).toBe('calm');
    expect(timerUrgency(30_000)).toBe('low');
    expect(timerUrgency(10_001)).toBe('low');
    expect(timerUrgency(10_000)).toBe('critical');
  });
});

const now = Date.parse('2026-01-01T12:00:00Z');
function participant(id: string, overrides: Partial<RoundParticipant> = {}): RoundParticipant {
  return {
    playerId: id as PlayerId,
    displayName: id,
    joinedAt: '2026-01-01T11:00:00Z',
    lastSeenAt: new Date(now - 5_000).toISOString(),
    left: false,
    roundReady: false,
    answersLockedAt: null,
    answersLockReason: null,
    resultsReady: false,
    ...overrides,
  };
}

describe('round readiness', () => {
  it('keeps briefly disconnected players required, but not long-gone or departed ones', () => {
    expect(isRequiredForReadyCheck(participant('a'), now)).toBe(true);
    const stale = new Date(now - MEMBER_STALE_AFTER_MS - 1).toISOString();
    expect(isRequiredForReadyCheck(participant('b', { lastSeenAt: stale }), now)).toBe(false);
    expect(isRequiredForReadyCheck(participant('c', { left: true }), now)).toBe(false);
  });

  it('counts each ready stage independently', () => {
    const players = [
      participant('a', { roundReady: true, resultsReady: false }),
      participant('b', { roundReady: true, resultsReady: true }),
      participant('c', { left: true, roundReady: true }),
    ];
    expect(readyProgress(players, 'round', now)).toEqual({ ready: 2, required: 2 });
    expect(readyProgress(players, 'results', now)).toEqual({ ready: 1, required: 2 });
  });

  it('considers the round complete when everyone still in the game has locked', () => {
    expect(
      allAnswersLocked([
        participant('a', { answersLockedAt: '2026-01-01T12:01:00Z', answersLockReason: 'ready' }),
        participant('b', { left: true }),
      ]),
    ).toBe(true);
    expect(allAnswersLocked([participant('a'), participant('b', { left: true })])).toBe(false);
  });
});

describe('letters across rounds', () => {
  it('never repeats a letter over a full 28-round game', () => {
    const used: EligibleLetter[] = [];
    for (let round = 1; round <= 28; round++) {
      const letter = pickRandomLetter(used);
      expect(letter).not.toBeNull();
      expect(getRemainingLetters(used)).toContain(letter);
      used.push(letter!);
    }
    expect(new Set(used).size).toBe(28);
    expect(pickRandomLetter(used)).toBeNull();
  });
});
