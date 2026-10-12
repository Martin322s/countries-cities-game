import { CATEGORY_IDS } from './categories';

/*
 * Results reveal timeline (relative to the server's reveal_at). Every client maps
 * the estimated server time onto this timeline, so all screens reveal the same
 * category at the same moment, and a refresh resumes at the right point.
 *
 *   0 ms      suspense: "ПРОВЕРЯВАМЕ ОТГОВОРИТЕ..."
 *   2000 ms   table appears, all cells concealed
 *   2600 ms   category 1 (Държава) revealed, then one category per second
 *   9600 ms   round totals revealed (count-up)
 *   10600 ms  leaderboard revealed
 *   11000 ms  complete → RESULTS (server: reveal_duration())
 */
export const REVEAL_SUSPENSE_MS = 2_000;
export const REVEAL_TABLE_INTRO_MS = 600;
export const REVEAL_CATEGORY_MS = 1_000;
export const REVEAL_SCORES_MS = 1_000;
export const REVEAL_LEADERBOARD_MS = 400;

const CATEGORIES_START = REVEAL_SUSPENSE_MS + REVEAL_TABLE_INTRO_MS;
const SCORES_START = CATEGORIES_START + CATEGORY_IDS.length * REVEAL_CATEGORY_MS;
const LEADERBOARD_START = SCORES_START + REVEAL_SCORES_MS;

/** Total reveal length. Mirrored by `reveal_duration()` in the database (11 s). */
export const REVEAL_DURATION_MS = LEADERBOARD_START + REVEAL_LEADERBOARD_MS;

export type RevealStage =
  'suspense' | 'table' | 'categories' | 'scores' | 'leaderboard' | 'complete';

export interface RevealProgress {
  stage: RevealStage;
  /** How many categories (in official order) are revealed: 0–7. */
  revealedCategories: number;
  scoresRevealed: boolean;
  leaderboardRevealed: boolean;
  complete: boolean;
}

const COMPLETE: RevealProgress = {
  stage: 'complete',
  revealedCategories: CATEGORY_IDS.length,
  scoresRevealed: true,
  leaderboardRevealed: true,
  complete: true,
};

/**
 * Maps server time onto the reveal timeline. `revealAt === null` means there is no
 * pending reveal (e.g. viewing an older round) → everything is shown.
 * Time before reveal_at (clock skew) is treated as the start of the suspense.
 */
export function revealProgress(revealAt: number | null, serverNow: number): RevealProgress {
  if (revealAt === null) return COMPLETE;
  const elapsed = serverNow - revealAt;

  if (elapsed < REVEAL_SUSPENSE_MS) {
    return {
      stage: 'suspense',
      revealedCategories: 0,
      scoresRevealed: false,
      leaderboardRevealed: false,
      complete: false,
    };
  }
  if (elapsed < CATEGORIES_START) {
    return {
      stage: 'table',
      revealedCategories: 0,
      scoresRevealed: false,
      leaderboardRevealed: false,
      complete: false,
    };
  }
  if (elapsed < SCORES_START) {
    return {
      stage: 'categories',
      revealedCategories: Math.floor((elapsed - CATEGORIES_START) / REVEAL_CATEGORY_MS) + 1,
      scoresRevealed: false,
      leaderboardRevealed: false,
      complete: false,
    };
  }
  if (elapsed < LEADERBOARD_START) {
    return {
      stage: 'scores',
      revealedCategories: CATEGORY_IDS.length,
      scoresRevealed: true,
      leaderboardRevealed: false,
      complete: false,
    };
  }
  if (elapsed < REVEAL_DURATION_MS) {
    return {
      stage: 'leaderboard',
      revealedCategories: CATEGORY_IDS.length,
      scoresRevealed: true,
      leaderboardRevealed: true,
      complete: false,
    };
  }
  return COMPLETE;
}

/** Every future boundary of the timeline (server ms), for scheduling re-renders. */
export function revealMilestones(revealAt: number): number[] {
  const offsets = [
    REVEAL_SUSPENSE_MS,
    ...CATEGORY_IDS.map((_, index) => CATEGORIES_START + index * REVEAL_CATEGORY_MS),
    SCORES_START,
    LEADERBOARD_START,
    REVEAL_DURATION_MS,
  ];
  return offsets.map((offset) => revealAt + offset);
}

/**
 * Server times (epoch ms) of the reveal's sound-worthy boundaries — used to key and
 * time-check audio cues, so sounds follow the same authoritative timeline as the UI.
 */
export interface RevealCueTimes {
  suspense: number;
  /** One per category, in official order. */
  categories: number[];
  scores: number;
  leaderboard: number;
}

export function revealCueTimes(revealAt: number): RevealCueTimes {
  return {
    suspense: revealAt,
    categories: CATEGORY_IDS.map(
      (_, index) => revealAt + CATEGORIES_START + index * REVEAL_CATEGORY_MS,
    ),
    scores: revealAt + SCORES_START,
    leaderboard: revealAt + LEADERBOARD_START,
  };
}
