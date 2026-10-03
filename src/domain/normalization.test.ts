import { describe, expect, it } from 'vitest';

import {
  areAnswersEquivalent,
  isEmptyAnswer,
  normalizeAnswer,
  startsWithLetter,
} from './normalization';

describe('normalizeAnswer', () => {
  it('lowercases Bulgarian Cyrillic text', () => {
    expect(normalizeAnswer('БЪЛГАРИЯ')).toBe('българия');
    expect(normalizeAnswer('ЩЪРКЕЛ')).toBe('щъркел');
    expect(normalizeAnswer('ЮЖНА АФРИКА')).toBe('южна африка');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeAnswer('   София  ')).toBe('софия');
  });

  it('collapses internal whitespace runs, including tabs, newlines and NBSP', () => {
    expect(normalizeAnswer('Велико    Търново')).toBe('велико търново');
    expect(normalizeAnswer('Велико\t\nТърново')).toBe('велико търново');
    expect(normalizeAnswer('Велико\u00A0Търново')).toBe('велико търново');
  });

  it('treats composed and decomposed Й as the same letter', () => {
    const composed = 'Й';
    const decomposed = 'И\u0306';
    expect(composed).not.toBe(decomposed);
    expect(normalizeAnswer(composed)).toBe(normalizeAnswer(decomposed));
  });

  it('does not strip internal punctuation or hyphens', () => {
    expect(normalizeAnswer('Гоце-Делчев')).toBe('гоце-делчев');
    expect(normalizeAnswer('Гоце-Делчев')).not.toBe(normalizeAnswer('Гоце Делчев'));
  });

  it('does not fold Latin look-alike letters into Cyrillic', () => {
    // Latin "A" + Cyrillic "ня" vs. all-Cyrillic "Аня": deliberately NOT equal.
    expect(normalizeAnswer('Aня')).not.toBe(normalizeAnswer('Аня'));
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeAnswer('')).toBe('');
    expect(normalizeAnswer('   \t ')).toBe('');
  });
});

describe('isEmptyAnswer', () => {
  it('is true for empty and whitespace-only answers', () => {
    expect(isEmptyAnswer('')).toBe(true);
    expect(isEmptyAnswer('  \u00A0 ')).toBe(true);
  });

  it('is false for any visible text', () => {
    expect(isEmptyAnswer('а')).toBe(false);
  });
});

describe('areAnswersEquivalent', () => {
  it('matches answers differing only by case and whitespace', () => {
    expect(areAnswersEquivalent('  стара   ЗАГОРА', 'Стара Загора')).toBe(true);
  });

  it('does not match different answers', () => {
    expect(areAnswersEquivalent('Варна', 'Видин')).toBe(false);
  });

  it('never treats two empty answers as equivalent', () => {
    expect(areAnswersEquivalent('', '   ')).toBe(false);
  });
});

describe('startsWithLetter', () => {
  it('accepts answers starting with the letter, in any case and with outer spaces', () => {
    expect(startsWithLetter('Юта', 'Ю')).toBe(true);
    expect(startsWithLetter('  юта ', 'Ю')).toBe(true);
    expect(startsWithLetter('ЮТА', 'Ю')).toBe(true);
  });

  it('rejects answers starting with another letter, and empty answers', () => {
    expect(startsWithLetter('Кристина', 'Ю')).toBe(false);
    expect(startsWithLetter('Иорк', 'Й')).toBe(false);
    expect(startsWithLetter('   ', 'Ю')).toBe(false);
  });

  it('compares the composed form (й typed as и + breve still counts as Й)', () => {
    expect(startsWithLetter(`и${String.fromCodePoint(0x306)}ордания`, 'Й')).toBe(true);
  });
});
