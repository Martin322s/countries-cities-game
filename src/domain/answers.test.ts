import { describe, expect, it } from 'vitest';

import { cleanAnswer, emptyAnswers, isAnswerTooLong, toAnswerValues } from './answers';
import { CATEGORY_IDS } from './categories';
import { normalizeAnswer } from './normalization';

describe('cleanAnswer', () => {
  it('trims surrounding whitespace but keeps casing and inner spacing', () => {
    expect(cleanAnswer('  Велико  Търново \t')).toBe('Велико  Търново');
    expect(cleanAnswer('\u00A0Бургас\u200B')).toBe('Бургас');
  });

  it('composes decomposed letters (NFC)', () => {
    expect(cleanAnswer('И\u0306мир')).toBe('Ймир');
  });

  it('keeps the duplicate key of the cleaned value identical to the raw one', () => {
    const raw = '  СТАРА   загора ';
    expect(normalizeAnswer(cleanAnswer(raw))).toBe(normalizeAnswer(raw));
  });
});

describe('answer length', () => {
  it('allows 100 characters after trimming', () => {
    expect(isAnswerTooLong('я'.repeat(100))).toBe(false);
    expect(isAnswerTooLong(`  ${'я'.repeat(100)}  `)).toBe(false);
    expect(isAnswerTooLong('я'.repeat(101))).toBe(true);
  });
});

describe('answer sheets', () => {
  it('fills every category in the official order', () => {
    expect(Object.keys(emptyAnswers())).toEqual([...CATEGORY_IDS]);
    expect(toAnswerValues({ city: 'Бургас' })).toEqual({ ...emptyAnswers(), city: 'Бургас' });
  });
});
