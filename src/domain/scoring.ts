import { CATEGORY_IDS, type CategoryId } from './categories';
import type { PlayerId } from './ids';
import type { AnswerSet } from './models';
import { normalizeAnswer, startsWithLetter, type NormalizedAnswer } from './normalization';

/**
 * Outcome of a single answer cell in the results table.
 * - unique:      valid, and no other VALID answer in the category matches it → 1 point
 * - duplicate:   valid, but ≥1 other valid answer matches it → 0 for every holder
 * - empty:       blank after normalization → 0
 * - wrong_letter: does not start with the round's letter → 0
 * - invalidated: manually rejected by the host → 0
 *
 * Scoring pipeline (per category, per round). The order is a product rule:
 *   1. normalize answers
 *   2. remove empty answers
 *   3. remove answers that do not start with the round's letter
 *   4. remove manually invalidated answers
 *   5. build duplicate groups among the REMAINING valid answers
 *   6. unique → 1 point
 *   7. duplicate → 0 points
 *
 * Consequence: if A and B both write "Монтана" and the host invalidates A's answer,
 * A becomes `invalidated` (0) and B becomes `unique` (1).
 */
export type AnswerStatus = 'unique' | 'duplicate' | 'empty' | 'wrong_letter' | 'invalidated';

export const POINTS_BY_STATUS: Readonly<Record<AnswerStatus, number>> = {
  unique: 1,
  duplicate: 0,
  empty: 0,
  wrong_letter: 0,
  invalidated: 0,
};

export interface ScoredAnswer {
  raw: string;
  normalized: NormalizedAnswer;
  status: AnswerStatus;
  points: number;
}

export interface PlayerRoundScore {
  playerId: PlayerId;
  answers: Partial<Record<CategoryId, ScoredAnswer>>;
  total: number;
}

/** Per category, the players whose answer the host has invalidated. */
export type InvalidatedAnswers = ReadonlyMap<CategoryId, ReadonlySet<PlayerId>>;

const NO_INVALIDATIONS: ReadonlySet<PlayerId> = new Set();

/** Counts how many submissions share each non-empty normalized answer. */
export function countNormalizedAnswers(
  rawAnswers: Iterable<string>,
): Map<NormalizedAnswer, number> {
  const counts = new Map<NormalizedAnswer, number>();
  for (const raw of rawAnswers) {
    const normalized = normalizeAnswer(raw);
    if (normalized.length === 0) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

/**
 * Classifies every player's answer in ONE category of ONE round, following the
 * pipeline documented on `AnswerStatus`. The result does not depend on input order.
 * Without `letter` the first-letter rule is not applied.
 */
export function classifyCategoryAnswers(
  answersByPlayer: ReadonlyMap<PlayerId, string>,
  invalidatedPlayerIds: ReadonlySet<PlayerId> = NO_INVALIDATIONS,
  letter?: string,
): Map<PlayerId, ScoredAnswer> {
  const excludedStatus = (raw: string, normalized: NormalizedAnswer, playerId: PlayerId) => {
    if (normalized.length === 0) return 'empty';
    if (letter !== undefined && !startsWithLetter(raw, letter)) return 'wrong_letter';
    if (invalidatedPlayerIds.has(playerId)) return 'invalidated';
    return null;
  };

  // Steps 1–4: normalize, then set aside empty, wrong-letter and invalidated answers.
  const normalizedByPlayer = new Map<PlayerId, NormalizedAnswer>();
  const validAnswers: NormalizedAnswer[] = [];
  for (const [playerId, raw] of answersByPlayer) {
    const normalized = normalizeAnswer(raw);
    normalizedByPlayer.set(playerId, normalized);
    if (excludedStatus(raw, normalized, playerId) === null) validAnswers.push(normalized);
  }

  // Step 5: duplicate groups among the remaining valid answers only.
  const validCounts = countNormalizedAnswers(validAnswers);

  // Steps 6–7.
  const result = new Map<PlayerId, ScoredAnswer>();
  for (const [playerId, raw] of answersByPlayer) {
    const normalized = normalizedByPlayer.get(playerId) ?? normalizeAnswer(raw);
    const status: AnswerStatus =
      excludedStatus(raw, normalized, playerId) ??
      ((validCounts.get(normalized) ?? 0) > 1 ? 'duplicate' : 'unique');
    result.set(playerId, { raw, normalized, status, points: POINTS_BY_STATUS[status] });
  }

  return result;
}

/** Scores a full round for all players across every category. */
export function scoreRound(
  answerSets: ReadonlyMap<PlayerId, AnswerSet>,
  invalidated: InvalidatedAnswers = new Map(),
  letter?: string,
): Map<PlayerId, PlayerRoundScore> {
  const scores = new Map<PlayerId, PlayerRoundScore>();
  for (const playerId of answerSets.keys()) {
    scores.set(playerId, { playerId, answers: {}, total: 0 });
  }

  for (const category of CATEGORY_IDS) {
    const categoryAnswers = new Map<PlayerId, string>();
    for (const [playerId, answers] of answerSets) {
      categoryAnswers.set(playerId, answers[category] ?? '');
    }

    const classified = classifyCategoryAnswers(
      categoryAnswers,
      invalidated.get(category) ?? NO_INVALIDATIONS,
      letter,
    );
    for (const [playerId, scored] of classified) {
      const playerScore = scores.get(playerId);
      if (!playerScore) continue;
      playerScore.answers[category] = scored;
      playerScore.total += scored.points;
    }
  }

  return scores;
}

/** One point per category at most: 7 per player per round. */
export const MAX_ROUND_SCORE = CATEGORY_IDS.length;

/** Sums per-round points into cumulative game totals (historical rounds stay separate). */
export function cumulativeTotals(
  rounds: readonly ReadonlyMap<PlayerId, number>[],
): Map<PlayerId, number> {
  const totals = new Map<PlayerId, number>();
  for (const round of rounds) {
    for (const [playerId, points] of round) {
      totals.set(playerId, (totals.get(playerId) ?? 0) + points);
    }
  }
  return totals;
}
