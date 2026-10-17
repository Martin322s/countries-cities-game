import {
  CATEGORY_IDS,
  revealCueTimes,
  type RevealProgress,
  type RoomId,
  type RoundId,
} from '@/domain';
import type { Cue } from '@/features/audio/cueGate';
import type { SoundId } from '@/features/audio/sounds';

import type { CellState } from './api/roundResults';

/*
 * Which game event makes which sound — derived only from authoritative state (server
 * timestamps, phases, the reveal timeline). Each cue's key is the event identity, so
 * re-renders, refetches, realtime echoes and refreshes can never repeat it, and each
 * cue carries the server time of its boundary so late arrivals stay silent.
 */

/** The ticking only starts in the final seconds — never at 30 s. */
export const TIMER_TICK_FROM_SECONDS = 10;

export function countdownCue(roundId: RoundId, startedAt: number, secondsLeft: number): Cue {
  return {
    key: `round:${roundId}:countdown:${String(secondsLeft)}`,
    sound: secondsLeft === 1 ? 'countdown-final' : 'countdown-tick',
    at: startedAt - secondsLeft * 1000,
  };
}

/** started_at: the letter appears. A refresh well into the round stays silent. */
export function letterCue(roundId: RoundId, startedAt: number): Cue {
  return { key: `round:${roundId}:letter`, sound: 'letter', at: startedAt, maxAgeMs: 1_500 };
}

/**
 * The timer's sound for the current second, if any: one tick per second from 10 to
 * 1 (not for a player who already locked — they are waiting, not racing), and the
 * end sound at 0 for everyone.
 */
export function timerCue(
  roundId: RoundId,
  endsAt: number,
  remainingMs: number,
  { answersLocked }: { answersLocked: boolean },
): Cue | null {
  if (remainingMs <= 0) {
    return { key: `round:${roundId}:time-up`, sound: 'time-up', at: endsAt };
  }
  const seconds = Math.ceil(remainingMs / 1000);
  if (answersLocked || seconds > TIMER_TICK_FROM_SECONDS) return null;
  return {
    key: `round:${roundId}:tick:${String(seconds)}`,
    sound: 'timer-tick',
    at: endsAt - seconds * 1000,
  };
}

/** The current player's own READY (a direct response to their action). */
export function readyCue(roundId: RoundId): Cue {
  return { key: `round:${roundId}:ready`, sound: 'ready' };
}

/** Everyone locked before the deadline. */
export function allReadyCue(roundId: RoundId, lockedAt: number): Cue {
  return { key: `round:${roundId}:all-ready`, sound: 'all-ready', at: lockedAt, maxAgeMs: 4_000 };
}

/**
 * One sound per category column, never per cell. Mixed columns would otherwise stack
 * sounds, so the column speaks for the current player's own answer: crisp for unique,
 * flat for a duplicate, muted for invalid, a neutral tick for empty (or a spectator).
 */
export function categorySound(myState: CellState | null): SoundId {
  switch (myState) {
    case 'unique':
      return 'reveal-unique';
    case 'duplicate':
      return 'reveal-duplicate';
    case 'invalid':
      return 'reveal-invalid';
    case 'empty':
    case null:
      return 'reveal-neutral';
  }
}

/** The cue for the reveal's current position (live reveal only — never history). */
export function revealCue(
  roundId: RoundId,
  revealAt: number,
  progress: RevealProgress,
  myStateOf: (categoryIndex: number) => CellState | null,
): Cue | null {
  const times = revealCueTimes(revealAt);
  switch (progress.stage) {
    case 'suspense':
      return {
        key: `round:${roundId}:suspense`,
        sound: 'suspense',
        at: times.suspense,
        // The suspense lasts 2 s; realtime may deliver REVEAL a little late.
        maxAgeMs: 1_800,
      };
    case 'categories': {
      const index = progress.revealedCategories - 1;
      const category = CATEGORY_IDS[index];
      const at = times.categories[index];
      if (category === undefined || at === undefined) return null;
      return {
        key: `round:${roundId}:category:${category}`,
        sound: categorySound(myStateOf(index)),
        at,
      };
    }
    case 'scores':
      return { key: `round:${roundId}:scores`, sound: 'score', at: times.scores };
    case 'leaderboard':
      return { key: `round:${roundId}:leaderboard`, sound: 'leaderboard', at: times.leaderboard };
    case 'table':
    case 'complete':
      return null;
  }
}

/** The game just finished (first arrival only; a later refresh stays quiet). */
export function finishedCue(roomId: RoomId, finishedAt: number | null): Cue {
  return {
    key: `room:${roomId}:finished`,
    sound: 'winner',
    ...(finishedAt === null ? {} : { at: finishedAt, maxAgeMs: 8_000 }),
  };
}
