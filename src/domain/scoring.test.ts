import { describe, expect, it } from 'vitest';

import type { PlayerId } from './ids';
import type { AnswerSet } from './models';
import {
  classifyCategoryAnswers,
  countNormalizedAnswers,
  cumulativeTotals,
  MAX_ROUND_SCORE,
  scoreRound,
} from './scoring';

const alice = 'player-alice' as PlayerId;
const bob = 'player-bob' as PlayerId;
const nicky = 'player-nicky' as PlayerId;

describe('countNormalizedAnswers', () => {
  it('groups answers by their normalized form and ignores empty ones', () => {
    const counts = countNormalizedAnswers(['Сливен', ' сливен ', 'СЛИВЕН', 'Смолян', '', '  ']);
    expect(Object.fromEntries(counts)).toEqual({ сливен: 3, смолян: 1 });
  });
});

describe('classifyCategoryAnswers', () => {
  it('marks a unique non-empty answer as unique worth 1 point', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Сърбия'],
        [bob, 'Словакия'],
      ]),
    );
    expect(result.get(alice)).toMatchObject({ status: 'unique', points: 1 });
    expect(result.get(bob)).toMatchObject({ status: 'unique', points: 1 });
  });

  it('gives 0 points to EVERY player sharing a normalized duplicate', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Швеция'],
        [bob, '  ШВЕЦИЯ '],
        [nicky, 'Швейцария'],
      ]),
    );
    expect(result.get(alice)).toMatchObject({ status: 'duplicate', points: 0 });
    expect(result.get(bob)).toMatchObject({ status: 'duplicate', points: 0 });
    expect(result.get(nicky)).toMatchObject({ status: 'unique', points: 1 });
  });

  it('scores empty answers as empty with 0 points and never as duplicates', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, ''],
        [bob, '   '],
      ]),
    );
    expect(result.get(alice)).toMatchObject({ status: 'empty', points: 0 });
    expect(result.get(bob)).toMatchObject({ status: 'empty', points: 0 });
  });

  it('keeps the raw answer for display', () => {
    const result = classifyCategoryAnswers(new Map([[alice, '  Шумен ']]));
    expect(result.get(alice)).toMatchObject({ raw: '  Шумен ', normalized: 'шумен' });
  });
});

describe('invalidation (host rejects an answer)', () => {
  it('removes an invalidated answer from duplicate consideration — the "Монтана" rule', () => {
    const answers = new Map([
      [alice, 'Монтана'],
      [bob, 'Монтана'],
    ]);

    const before = classifyCategoryAnswers(answers);
    expect(before.get(alice)).toMatchObject({ status: 'duplicate', points: 0 });
    expect(before.get(bob)).toMatchObject({ status: 'duplicate', points: 0 });

    const after = classifyCategoryAnswers(answers, new Set([alice]));
    expect(after.get(alice)).toMatchObject({ status: 'invalidated', points: 0 });
    expect(after.get(bob)).toMatchObject({ status: 'unique', points: 1 });
  });

  it('keeps the remaining answers duplicated when two valid copies are left', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Монтана'],
        [bob, ' монтана'],
        [nicky, 'МОНТАНА'],
      ]),
      new Set([alice]),
    );
    expect(result.get(alice)?.status).toBe('invalidated');
    expect(result.get(bob)?.status).toBe('duplicate');
    expect(result.get(nicky)?.status).toBe('duplicate');
  });

  it('makes every copy invalid or unique as invalidations accumulate', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Монтана'],
        [bob, 'Монтана'],
        [nicky, 'Монтана'],
      ]),
      new Set([alice, bob]),
    );
    expect(result.get(nicky)).toMatchObject({ status: 'unique', points: 1 });
  });

  it('reports an empty answer as empty even if it is marked invalidated', () => {
    const result = classifyCategoryAnswers(new Map([[alice, '  ']]), new Set([alice]));
    expect(result.get(alice)).toMatchObject({ status: 'empty', points: 0 });
  });

  it('applies invalidations per category in scoreRound', () => {
    const scores = scoreRound(
      new Map<PlayerId, AnswerSet>([
        [alice, { city: 'Монтана', village: 'Мездра' }],
        [bob, { city: 'Монтана', village: 'Мездра' }],
      ]),
      new Map([['city', new Set([alice])]]),
    );
    expect(scores.get(alice)?.answers.city?.status).toBe('invalidated');
    expect(scores.get(bob)?.answers.city?.status).toBe('unique');
    // The village duplicate is untouched by a city invalidation.
    expect(scores.get(bob)?.answers.village?.status).toBe('duplicate');
    expect(scores.get(alice)?.total).toBe(0);
    expect(scores.get(bob)?.total).toBe(1);
  });
});

describe('round scoring rules', () => {
  const kaloyan = 'player-kaloyan' as PlayerId;

  it('scores a three-way duplicate (case and spacing insensitive) as 0 for everyone', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Монтана'],
        [bob, 'монтана'],
        [nicky, ' МОНТАНА '],
      ]),
    );
    expect([...result.values()].map((cell) => cell.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
  });

  it('does not merge hyphenated and spaced variants (no semantic equivalence)', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Стара Загора'],
        [bob, 'Стара-Загора'],
      ]),
    );
    expect(result.get(alice)?.status).toBe('unique');
    expect(result.get(bob)?.status).toBe('unique');
  });

  it('follows the Мечка example: invalidate one duplicate, then restore it', () => {
    const answers = new Map([
      [alice, 'Мечка'],
      [bob, 'Мечка'],
      [kaloyan, 'Мравка'],
    ]);
    const initial = classifyCategoryAnswers(answers);
    expect([alice, bob, kaloyan].map((p) => initial.get(p)?.points)).toEqual([0, 0, 1]);

    const invalidated = classifyCategoryAnswers(answers, new Set([alice]));
    expect([alice, bob, kaloyan].map((p) => invalidated.get(p)?.status)).toEqual([
      'invalidated',
      'unique',
      'unique',
    ]);

    const restored = classifyCategoryAnswers(answers, new Set());
    expect([alice, bob, kaloyan].map((p) => restored.get(p)?.status)).toEqual([
      'duplicate',
      'duplicate',
      'unique',
    ]);
  });

  it('caps a round at 7 points (one per category)', () => {
    const scores = scoreRound(
      new Map<PlayerId, AnswerSet>([
        [
          alice,
          {
            country: 'Малта',
            city: 'Монтана',
            village: 'Мърчево',
            animal: 'Мечка',
            plant: 'Мента',
            object: 'Маса',
            name: 'Мария',
          },
        ],
        [bob, {}],
      ]),
    );
    expect(scores.get(alice)?.total).toBe(MAX_ROUND_SCORE);
    expect(MAX_ROUND_SCORE).toBe(7);
  });

  it('sums historical rounds into cumulative totals', () => {
    const totals = cumulativeTotals([
      new Map([
        [alice, 5],
        [bob, 3],
      ]),
      new Map([
        [alice, 2],
        [nicky, 4],
      ]),
    ]);
    expect(Object.fromEntries(totals)).toEqual({ [alice]: 7, [bob]: 3, [nicky]: 4 });
  });
});

describe('scoreRound', () => {
  it('scores each category independently and totals per player', () => {
    const answers = new Map<PlayerId, AnswerSet>([
      [alice, { country: 'Сърбия', city: 'София', animal: 'Сом' }],
      [bob, { country: 'сърбия', city: 'Сливен', name: 'Стефан' }],
      [nicky, { country: 'Сенегал', city: '', plant: 'Слива' }],
    ]);

    const scores = scoreRound(answers);

    // country: alice/bob duplicate, nicky unique
    expect(scores.get(alice)?.answers.country?.status).toBe('duplicate');
    expect(scores.get(bob)?.answers.country?.status).toBe('duplicate');
    expect(scores.get(nicky)?.answers.country?.status).toBe('unique');

    // Same text in different categories is not a duplicate.
    expect(scores.get(alice)?.total).toBe(2); // city + animal
    expect(scores.get(bob)?.total).toBe(2); // city + name
    expect(scores.get(nicky)?.total).toBe(2); // country + plant
  });

  it('treats missing categories as empty answers', () => {
    const scores = scoreRound(new Map<PlayerId, AnswerSet>([[alice, {}]]));
    const aliceScore = scores.get(alice);
    expect(aliceScore?.total).toBe(0);
    expect(aliceScore?.answers.village?.status).toBe('empty');
  });
});

describe('first-letter rule', () => {
  it('scores an answer with the wrong first letter 0 and keeps it out of duplicate groups', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Кристина'],
        [bob, 'Кристина'],
        [nicky, 'Юлия'],
      ]),
      undefined,
      'Ю',
    );
    expect(result.get(alice)).toMatchObject({ status: 'wrong_letter', points: 0 });
    expect(result.get(bob)).toMatchObject({ status: 'wrong_letter', points: 0 });
    expect(result.get(nicky)).toMatchObject({ status: 'unique', points: 1 });
  });

  it('does not let a wrong-letter answer turn a valid one into a duplicate', () => {
    const result = classifyCategoryAnswers(
      new Map([
        [alice, 'Юлия'],
        [bob, 'Юлия'],
        [nicky, 'Ана'],
      ]),
      undefined,
      'Ю',
    );
    expect(result.get(alice)?.status).toBe('duplicate');
    expect(result.get(nicky)?.status).toBe('wrong_letter');
  });

  it('applies to a whole round', () => {
    const scores = scoreRound(
      new Map<PlayerId, AnswerSet>([
        [alice, { country: 'Югославия', city: 'Кюстендил', name: 'Юлия' }],
        [bob, { country: 'Япония' }],
      ]),
      undefined,
      'Ю',
    );
    expect(scores.get(alice)?.answers.city?.status).toBe('wrong_letter');
    expect(scores.get(alice)?.total).toBe(2);
    expect(scores.get(bob)?.total).toBe(0);
  });
});
