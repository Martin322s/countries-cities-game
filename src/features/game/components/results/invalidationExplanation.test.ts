import { describe, expect, it } from 'vitest';
import { invalidationExplanation } from './invalidationExplanation';
import type { ResultCell } from '../../api/roundResults';

const cell: ResultCell = {
  category: 'country',
  answer: 'Ямаика',
  state: 'invalid',
  points: 0,
  duplicateCount: 0,
};
describe('invalidation explanation', () => {
  it('explains a geographic spelling verdict and shows the persisted suggestion', () => {
    expect(
      invalidationExplanation({
        ...cell,
        validationReason: 'MISSPELLING',
        validationSuggestion: 'Ямайка',
      }),
    ).toContain('Предложената поправка е „Ямайка“');
  });
  it('distinguishes manual invalidation from a geographic verdict', () => {
    expect(
      invalidationExplanation({
        ...cell,
        hostInvalidated: true,
        validationReason: 'WRONG_CATEGORY',
      }),
    ).toContain('Конкретно обяснение за ръчното анулиране не е записано');
  });
  it('does not describe uncertainty as proof of a nonexistent word', () => {
    expect(invalidationExplanation({ ...cell, validationReason: 'AMBIGUOUS' })).toContain(
      'Географската проверка',
    );
  });
  it.each(['DOES_NOT_EXIST', 'WRONG_CATEGORY', 'WRONG_LETTER'] as const)(
    'explains %s',
    (validationReason) => {
      expect(invalidationExplanation({ ...cell, validationReason })).toBeTruthy();
    },
  );
  it('has a truthful fallback for historical answers without metadata', () => {
    expect(invalidationExplanation(cell)).toContain('няма записана конкретна причина');
    expect(invalidationExplanation({ ...cell, state: 'unique' })).toBeNull();
  });
});
