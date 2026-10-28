import { describe, expect, it } from 'vitest';

import {
  extractResponseText,
  parseDecisions,
  resultSchema,
} from '../../supabase/functions/validate-round-answers/protocol';

const answers = [
  { player_id: 'p1', category: 'country', value: 'Малта' },
  { player_id: 'p2', category: 'city', value: '' },
  { player_id: 'p3', category: 'city', value: 'Мадрид' },
];
const valid = { index: 0, status: 'VALID', reason: null, suggestion: null };
const invalid = { index: 2, status: 'INVALID', reason: 'AMBIGUOUS', suggestion: null };

describe('AI validation protocol', () => {
  it('maps out-of-order decisions by trusted index and handles empty answers locally', () => {
    expect(parseDecisions({ results: [invalid, valid] }, answers)).toEqual([
      valid,
      { index: 1, status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null },
      invalid,
    ]);
  });
  it.each([
    { results: [valid] },
    { results: [valid, valid] },
    { results: [valid, { ...invalid, index: 9 }] },
    { results: [valid, { ...invalid, status: 'PENDING' }] },
    { results: [valid, { ...invalid, reason: null }] },
    { results: [{ ...valid, reason: 'MISSPELLING' }, invalid] },
    { results: [valid, { ...invalid, suggestion: 'x'.repeat(101) }] },
  ])('rejects incomplete or forged decisions %j', (payload) => {
    expect(() => parseDecisions(payload, answers)).toThrow();
  });
  it('accepts an empty sheet without calling the model', () => {
    expect(parseDecisions({ results: [] }, [])).toEqual([]);
  });
  it('rejects refusal and incomplete responses', () => {
    expect(() => extractResponseText({ status: 'incomplete', output: [] })).toThrow();
    expect(() =>
      extractResponseText({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }),
    ).toThrow();
    expect(
      extractResponseText({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: '{"results":[]}' }] }],
      }),
    ).toBe('{"results":[]}');
  });
  it('makes nullable fields required in the strict schema', () => {
    expect(resultSchema.properties.results.items.required).toEqual([
      'index',
      'status',
      'reason',
      'suggestion',
    ]);
  });
});
