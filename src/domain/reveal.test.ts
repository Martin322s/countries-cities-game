import { describe, expect, it } from 'vitest';

import { CATEGORY_IDS } from './categories';
import {
  REVEAL_CATEGORY_MS,
  REVEAL_DURATION_MS,
  REVEAL_SUSPENSE_MS,
  REVEAL_TABLE_INTRO_MS,
  revealCueTimes,
  revealMilestones,
  revealProgress,
} from './reveal';
import { deriveRoundStage } from './round';

const revealAt = Date.parse('2026-01-01T12:00:00Z');
const at = (ms: number) => revealProgress(revealAt, revealAt + ms);
const categoriesStart = REVEAL_SUSPENSE_MS + REVEAL_TABLE_INTRO_MS;

describe('reveal timeline', () => {
  it('lasts between 8 and 12 seconds in total', () => {
    expect(REVEAL_DURATION_MS).toBe(11_000);
    expect(REVEAL_DURATION_MS).toBeGreaterThanOrEqual(8_000);
    expect(REVEAL_DURATION_MS).toBeLessThanOrEqual(12_000);
  });

  it('treats time just before reveal_at (clock skew) as the start of the suspense', () => {
    expect(at(-1).stage).toBe('suspense');
    expect(at(-1).revealedCategories).toBe(0);
  });

  it('starts with suspense exactly at reveal_at', () => {
    expect(at(0)).toMatchObject({
      stage: 'suspense',
      revealedCategories: 0,
      scoresRevealed: false,
    });
  });

  it('shows the concealed table after the suspense', () => {
    expect(at(REVEAL_SUSPENSE_MS - 1).stage).toBe('suspense');
    expect(at(REVEAL_SUSPENSE_MS)).toMatchObject({ stage: 'table', revealedCategories: 0 });
  });

  it('reveals one category per second in official order, exactly on the boundaries', () => {
    expect(at(categoriesStart - 1).revealedCategories).toBe(0);
    for (let index = 0; index < CATEGORY_IDS.length; index++) {
      const boundary = categoriesStart + index * REVEAL_CATEGORY_MS;
      expect(at(boundary).revealedCategories).toBe(index + 1);
      expect(at(boundary + REVEAL_CATEGORY_MS - 1).revealedCategories).toBe(index + 1);
    }
  });

  it('keeps round totals hidden until every category is revealed', () => {
    const scoresStart = categoriesStart + CATEGORY_IDS.length * REVEAL_CATEGORY_MS;
    expect(at(scoresStart - 1)).toMatchObject({ revealedCategories: 7, scoresRevealed: false });
    expect(at(scoresStart)).toMatchObject({
      stage: 'scores',
      scoresRevealed: true,
      leaderboardRevealed: false,
    });
  });

  it('reveals the leaderboard last and completes at the reveal duration', () => {
    expect(at(REVEAL_DURATION_MS - 1)).toMatchObject({
      stage: 'leaderboard',
      leaderboardRevealed: true,
      complete: false,
    });
    expect(at(REVEAL_DURATION_MS)).toMatchObject({ stage: 'complete', complete: true });
    expect(at(REVEAL_DURATION_MS + 60_000).complete).toBe(true);
  });

  it('shows everything at once when there is no pending reveal', () => {
    expect(revealProgress(null, 0)).toMatchObject({ complete: true, revealedCategories: 7 });
  });

  it('lists every boundary for scheduling re-renders', () => {
    const milestones = revealMilestones(revealAt);
    expect(milestones[0]).toBe(revealAt + REVEAL_SUSPENSE_MS);
    expect(milestones.at(-1)).toBe(revealAt + REVEAL_DURATION_MS);
    expect([...milestones].sort((a, b) => a - b)).toEqual(milestones);
  });

  it('derives the effective RESULTS stage before the server persists it', () => {
    const timeline = { countdownAt: 0, startedAt: 0, endsAt: 0, lockedAt: 0, revealAt };
    expect(deriveRoundStage('REVEAL', timeline, revealAt + REVEAL_DURATION_MS - 1).kind).toBe(
      'reveal',
    );
    expect(deriveRoundStage('REVEAL', timeline, revealAt + REVEAL_DURATION_MS).kind).toBe(
      'results',
    );
    expect(deriveRoundStage('RESULTS', timeline, revealAt).kind).toBe('results');
  });
});

describe('revealCueTimes', () => {
  it('places every cue on the same boundaries as the visual timeline', () => {
    const revealAt = 1_000_000;
    const cues = revealCueTimes(revealAt);
    expect(cues.suspense).toBe(revealAt);
    expect(cues.categories).toHaveLength(7);
    for (const [index, at] of cues.categories.entries()) {
      expect(revealProgress(revealAt, at).revealedCategories).toBe(index + 1);
      expect(revealProgress(revealAt, at - 1).revealedCategories).toBe(index);
    }
    expect(revealProgress(revealAt, cues.scores).scoresRevealed).toBe(true);
    expect(revealProgress(revealAt, cues.scores - 1).scoresRevealed).toBe(false);
    expect(revealProgress(revealAt, cues.leaderboard).leaderboardRevealed).toBe(true);
  });
});
