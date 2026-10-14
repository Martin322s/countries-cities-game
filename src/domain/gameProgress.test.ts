import { describe, expect, it } from 'vitest';

import {
  formatWinners,
  isRoundEditable,
  joinBulgarian,
  lettersRemaining,
  nextRoundBlocker,
  nextRoundNumber,
  resultsAction,
  TOTAL_ROUNDS,
  winnersOf,
  type GameProgress,
} from './gameProgress';
import type { PlayerId } from './ids';
import { rankLeaderboard } from './leaderboard';
import { cumulativeTotals } from './scoring';

const progress = (overrides: Partial<GameProgress> = {}): GameProgress => ({
  totalRounds: 28,
  lettersUsed: 7,
  roundsCompleted: 7,
  isFinalRound: false,
  eligiblePlayers: 3,
  ...overrides,
});

describe('game length', () => {
  it('is one round per eligible letter: 28', () => {
    expect(TOTAL_ROUNDS).toBe(28);
  });

  it('numbers rounds 1…28 and nothing after', () => {
    expect(nextRoundNumber(null)).toBe(1);
    expect(nextRoundNumber(7)).toBe(8);
    expect(nextRoundNumber(27)).toBe(28);
    expect(nextRoundNumber(28)).toBeNull();
  });

  it('counts remaining letters and detects exhaustion', () => {
    expect(lettersRemaining(progress())).toBe(21);
    expect(lettersRemaining(progress({ lettersUsed: 27 }))).toBe(1);
    expect(lettersRemaining(progress({ lettersUsed: 28 }))).toBe(0);
  });
});

describe('results actions', () => {
  it('offers a new round in RESULTS of rounds 1–27', () => {
    expect(resultsAction('RESULTS', progress())).toBe('next_round');
    expect(resultsAction('RESULTS', progress({ lettersUsed: 27, roundsCompleted: 27 }))).toBe(
      'next_round',
    );
  });

  it('offers finalization after round 28 and nothing outside RESULTS', () => {
    const final = progress({ lettersUsed: 28, roundsCompleted: 28, isFinalRound: true });
    expect(resultsAction('RESULTS', final)).toBe('finish_game');
    expect(resultsAction('REVEAL', final)).toBe('none');
    expect(resultsAction('FINISHED', final)).toBe('none');
  });

  it('blocks a new round with fewer than 2 eligible players or no letters', () => {
    expect(nextRoundBlocker(progress())).toBeNull();
    expect(nextRoundBlocker(progress({ eligiblePlayers: 1 }))).toBe('not_enough_players');
    expect(nextRoundBlocker(progress({ lettersUsed: 28 }))).toBe('no_letters_left');
  });

  it('lets only the current round change, and only while its results are shown', () => {
    expect(isRoundEditable({ isCurrentRound: true, phase: 'RESULTS' })).toBe(true);
    expect(isRoundEditable({ isCurrentRound: true, phase: 'REVEAL' })).toBe(true);
    expect(isRoundEditable({ isCurrentRound: false, phase: 'RESULTS' })).toBe(false);
    expect(isRoundEditable({ isCurrentRound: true, phase: 'ROUND_WAITING' })).toBe(false);
    expect(isRoundEditable({ isCurrentRound: true, phase: 'FINISHED' })).toBe(false);
  });
});

describe('final standings', () => {
  const a = 'a' as PlayerId;
  const b = 'b' as PlayerId;
  const c = 'c' as PlayerId;

  it('sums only the rounds a player actually took part in', () => {
    // c missed round 2 and came back for round 3.
    const totals = cumulativeTotals([
      new Map([
        [a, 3],
        [b, 2],
        [c, 4],
      ]),
      new Map([
        [a, 5],
        [b, 1],
      ]),
      new Map([
        [a, 0],
        [b, 6],
        [c, 2],
      ]),
    ]);
    expect(Object.fromEntries(totals)).toEqual({ a: 8, b: 9, c: 6 });
  });

  it('ranks many rounds with competition ranking and keeps joint winners', () => {
    const ranked = rankLeaderboard([
      {
        playerId: a,
        displayName: 'Стоян',
        totalPoints: 142,
        roundPoints: 5,
        order: 0,
        left: false,
      },
      { playerId: b, displayName: 'Деси', totalPoints: 142, roundPoints: 6, order: 1, left: false },
      {
        playerId: c,
        displayName: 'Калоян',
        totalPoints: 131,
        roundPoints: 4,
        order: 2,
        left: false,
      },
    ]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(winnersOf(ranked).map((e) => e.displayName)).toEqual(['Стоян', 'Деси']);
  });

  it('formats winners in natural Bulgarian', () => {
    expect(formatWinners(['Стоян'])).toBe('Победител: Стоян');
    expect(formatWinners(['Стоян', 'Деси'])).toBe('Победители: Стоян и Деси');
    expect(formatWinners(['Стоян', 'Деси', 'Калоян'])).toBe('Победители: Стоян, Деси и Калоян');
    expect(joinBulgarian(['А', 'Б', 'В', 'Г'])).toBe('А, Б, В и Г');
    expect(formatWinners([])).toBe('');
  });
});
