export const VALIDATION_REASONS = [
  'WRONG_LETTER',
  'MISSPELLING',
  'DOES_NOT_EXIST',
  'WRONG_CATEGORY',
  'AMBIGUOUS',
] as const;

export type ValidationReason = (typeof VALIDATION_REASONS)[number];
export type ValidationStatus = 'VALID' | 'INVALID';

export interface ValidationDecision {
  status: ValidationStatus;
  reason: ValidationReason | null;
  suggestion: string | null;
}

export function normalizeAnswerForValidation(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');
}

export function isAnswerNormalizationSafe(value: string): boolean {
  const normalized = normalizeAnswerForValidation(value);
  return normalized.length > 0 && !/\s{2,}/.test(value);
}

export function buildValidationDecision(
  answer: string,
  letter: string,
  _category: string,
  knownValue?: string,
): ValidationDecision {
  const normalized = normalizeAnswerForValidation(answer);
  const letterNormalized = normalizeAnswerForValidation(letter);

  if (normalized.length === 0) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
  }

  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null };
  }

  if (knownValue && normalizeAnswerForValidation(knownValue) === normalized) {
    return { status: 'VALID', reason: null, suggestion: null };
  }

  return {
    status: 'INVALID',
    reason: 'AMBIGUOUS',
    suggestion: null,
  };
}
