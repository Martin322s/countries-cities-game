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
  it('explains manual invalidation without inventing a justification', () => {
    expect(
      invalidationExplanation({
        ...cell,
        hostInvalidated: true,
      }),
    ).toContain('Конкретно обяснение за ръчното анулиране не е записано');
  });
  it('has a truthful fallback for invalid answers without metadata', () => {
    expect(invalidationExplanation(cell)).toContain('Конкретно обяснение не е записано');
    expect(invalidationExplanation({ ...cell, state: 'unique' })).toBeNull();
  });
});
