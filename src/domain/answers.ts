import { CATEGORY_IDS, type CategoryId } from './categories';
import { ANSWER_MAX_LENGTH } from './config';

/** Whitespace removed from the ends of a stored answer (incl. NBSP and zero-width space). */
const EDGE_WHITESPACE = /^[\s\u200B]+|[\s\u200B]+$/gu;

/**
 * The form an answer is persisted in: NFC, surrounding whitespace trimmed, casing and
 * inner spacing preserved. Mirrors `clean_answer` in the database.
 */
export function cleanAnswer(raw: string): string {
  return raw.normalize('NFC').replace(EDGE_WHITESPACE, '');
}

export function isAnswerTooLong(raw: string): boolean {
  return Array.from(cleanAnswer(raw)).length > ANSWER_MAX_LENGTH;
}

export type AnswerValues = Record<CategoryId, string>;

export function emptyAnswers(): AnswerValues {
  return Object.fromEntries(CATEGORY_IDS.map((category) => [category, ''])) as AnswerValues;
}

/** Builds a full answer sheet from (possibly partial) persisted values. */
export function toAnswerValues(saved: Partial<Record<CategoryId, string>>): AnswerValues {
  const values = emptyAnswers();
  for (const category of CATEGORY_IDS) values[category] = saved[category] ?? '';
  return values;
}
