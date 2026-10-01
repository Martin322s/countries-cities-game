import { describe, expect, it } from 'vitest';

import type { PlayerId } from './ids';
import { rankLeaderboard, type LeaderboardInput } from './leaderboard';

function entry(name: string, totalPoints: number, order: number): LeaderboardInput {
  return {
    playerId: name as PlayerId,
    displayName: name,
    totalPoints,
    roundPoints: totalPoints,
    order,
    left: false,
  };
}

describe('rankLeaderboard', () => {
  it('orders by cumulative points, highest first', () => {
    const ranked = rankLeaderboard([
      entry('Деси', 4, 1),
      entry('Стоян', 6, 0),
      entry('Калоян', 5, 2),
    ]);
    expect(ranked.map((e) => [e.rank, e.displayName])).toEqual([
      [1, 'Стоян'],
      [2, 'Калоян'],
      [3, 'Деси'],
    ]);
  });

  it('uses competition ranking for ties (1, 2, 2, 4) and never invents a winner', () => {
    const ranked = rankLeaderboard([
      entry('А', 6, 0),
      entry('Б', 4, 1),
      entry('В', 4, 2),
      entry('Г', 3, 3),
    ]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked.map((e) => e.tied)).toEqual([false, true, true, false]);

    const allTied = rankLeaderboard([entry('А', 2, 0), entry('Б', 2, 1)]);
    expect(allTied.map((e) => e.rank)).toEqual([1, 1]);
  });

  it('keeps tied players in stable participant order', () => {
    const ranked = rankLeaderboard([entry('В', 3, 2), entry('А', 3, 0), entry('Б', 3, 1)]);
    expect(ranked.map((e) => e.displayName)).toEqual(['А', 'Б', 'В']);
  });

  it('does not mutate its input', () => {
    const input = [entry('Б', 1, 1), entry('А', 2, 0)];
    rankLeaderboard(input);
    expect(input.map((e) => e.displayName)).toEqual(['Б', 'А']);
  });
});
