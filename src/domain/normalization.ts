/**
 * Answer normalization used for duplicate comparison.
 *
 * Rules (from the product spec):
 * - case insensitive (Bulgarian-aware lowercasing)
 * - leading/trailing whitespace ignored
 * - runs of internal whitespace collapsed to a single space
 *
 * Additionally, text is Unicode NFC-normalized so that visually identical input
 * produced by different keyboards/IMEs (e.g. "й" as one code point vs "и" + U+0306)
 * compares equal. No other folding (transliteration, Latin/Cyrillic look-alikes,
 * spelling variants) is performed — those would change the game rules.
 */

/**
 * Any run of whitespace. `\s` covers all Unicode space separators (NBSP, thin/em
 * spaces, U+3000, BOM, line/paragraph separators); zero-width space is added
 * explicitly because it is not classified as whitespace.
 */
const WHITESPACE_RUN = /[\s\u200B]+/gu;

export type NormalizedAnswer = string & { readonly __brand: 'NormalizedAnswer' };

export function normalizeAnswer(raw: string): NormalizedAnswer {
  return raw
    .normalize('NFC')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .toLocaleLowerCase('bg-BG') as NormalizedAnswer;
}

export function isEmptyAnswer(raw: string): boolean {
  return normalizeAnswer(raw).length === 0;
}

/** True when two raw answers count as the same answer for duplicate detection. */
export function areAnswersEquivalent(a: string, b: string): boolean {
  const normalizedA = normalizeAnswer(a);
  return normalizedA.length > 0 && normalizedA === normalizeAnswer(b);
}
