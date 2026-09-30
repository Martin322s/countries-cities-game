import { describe, expect, it } from 'vitest';

import {
  BULGARIAN_ALPHABET,
  ELIGIBLE_LETTERS,
  getRemainingLetters,
  isEligibleLetter,
  MAX_ROUNDS_PER_GAME,
  pickRandomLetter,
  type EligibleLetter,
} from './alphabet';

describe('Bulgarian alphabet configuration', () => {
  it('contains the 30 letters of the modern Bulgarian alphabet without duplicates', () => {
    expect(BULGARIAN_ALPHABET).toHaveLength(30);
    expect(new Set(BULGARIAN_ALPHABET).size).toBe(30);
  });

  it('excludes Ъ and Ь from the eligible letters', () => {
    expect(ELIGIBLE_LETTERS).not.toContain('Ъ');
    expect(ELIGIBLE_LETTERS).not.toContain('Ь');
    expect(isEligibleLetter('Ъ')).toBe(false);
    expect(isEligibleLetter('Ь')).toBe(false);
  });

  it('has 28 eligible letters in alphabetical order', () => {
    expect(ELIGIBLE_LETTERS).toHaveLength(28);
    expect(MAX_ROUNDS_PER_GAME).toBe(28);
    expect(ELIGIBLE_LETTERS.join('')).toBe('АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЮЯ');
  });

  it('only contains uppercase Cyrillic letters', () => {
    for (const letter of ELIGIBLE_LETTERS) {
      expect(letter).toMatch(/^\p{Script=Cyrillic}$/u);
      expect(letter).toBe(letter.toLocaleUpperCase('bg-BG'));
    }
  });

  it('rejects Latin look-alikes', () => {
    expect(isEligibleLetter('A')).toBe(false); // Latin A
    expect(isEligibleLetter('А')).toBe(true); // Cyrillic А
  });
});

describe('getRemainingLetters', () => {
  it('removes used letters', () => {
    const remaining = getRemainingLetters(['А', 'Я']);
    expect(remaining).toHaveLength(26);
    expect(remaining).not.toContain('А');
    expect(remaining).not.toContain('Я');
  });
});

describe('pickRandomLetter', () => {
  it('only returns unused eligible letters', () => {
    const used: EligibleLetter[] = ELIGIBLE_LETTERS.filter((letter) => letter !== 'М');
    expect(pickRandomLetter(used, () => 0.99)).toBe('М');
  });

  it('maps the random value across the remaining letters', () => {
    expect(pickRandomLetter([], () => 0)).toBe('А');
    expect(pickRandomLetter([], () => 0.999_999)).toBe('Я');
  });

  it('returns null once every eligible letter has been used', () => {
    expect(pickRandomLetter(ELIGIBLE_LETTERS)).toBeNull();
  });

  it('never repeats a letter across a full simulated game', () => {
    const used: EligibleLetter[] = [];
    for (let round = 0; round < MAX_ROUNDS_PER_GAME; round++) {
      const letter = pickRandomLetter(used);
      expect(letter).not.toBeNull();
      used.push(letter!);
    }
    expect(new Set(used).size).toBe(MAX_ROUNDS_PER_GAME);
    expect(pickRandomLetter(used)).toBeNull();
  });
});
