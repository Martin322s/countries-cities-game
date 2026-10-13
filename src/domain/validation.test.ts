import { describe, expect, it } from 'vitest';

import { buildValidationDecision, normalizeAnswerForValidation } from './validation';

describe('geographic answer validation helpers', () => {
  it('normalizes only the allowed whitespace and casing differences', () => {
    expect(normalizeAnswerForValidation(' Ямайка ')).toBe('ямайка');
    expect(normalizeAnswerForValidation('ЯМАЙКА')).toBe('ямайка');
    expect(normalizeAnswerForValidation('Ямайка  тест')).toBe('ямайка тест');
  });

  it('rejects wrong starting letters strictly', () => {
    expect(buildValidationDecision('Мадрид', 'Я', 'city')).toMatchObject({
      status: 'INVALID',
      reason: 'WRONG_LETTER',
    });
  });

  it('treats the allowed safe normalization as valid', () => {
    expect(buildValidationDecision(' Ямайка ', 'Я', 'country', 'Ямайка')).toMatchObject({
      status: 'VALID',
    });
  });

  it('accepts Hungary as a country starting with У', () => {
    expect(buildValidationDecision('Унгария', 'У', 'country')).toMatchObject({
      status: 'VALID',
      reason: null,
    });
  });
});
