/** The full modern Bulgarian alphabet (30 letters), in order. */
// prettier-ignore
export const BULGARIAN_ALPHABET = [
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'Й',
  'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У',
  'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ь', 'Ю', 'Я',
] as const;

export type BulgarianLetter = (typeof BULGARIAN_ALPHABET)[number];

/** Letters that are never drawn for a round. */
export const EXCLUDED_LETTERS = ['Ъ', 'Ь'] as const satisfies readonly BulgarianLetter[];

export type ExcludedLetter = (typeof EXCLUDED_LETTERS)[number];
export type EligibleLetter = Exclude<BulgarianLetter, ExcludedLetter>;

function isExcludedLetter(letter: BulgarianLetter): letter is ExcludedLetter {
  return (EXCLUDED_LETTERS as readonly BulgarianLetter[]).includes(letter);
}

/** Letters that may be drawn, each at most once per game (28 letters). */
export const ELIGIBLE_LETTERS: readonly EligibleLetter[] = BULGARIAN_ALPHABET.filter(
  (letter): letter is EligibleLetter => !isExcludedLetter(letter),
);

/** A game ends after this many rounds — one per eligible letter. */
export const MAX_ROUNDS_PER_GAME = ELIGIBLE_LETTERS.length;

export function isEligibleLetter(value: string): value is EligibleLetter {
  return (ELIGIBLE_LETTERS as readonly string[]).includes(value);
}

export function getRemainingLetters(usedLetters: Iterable<EligibleLetter>): EligibleLetter[] {
  const used = new Set(usedLetters);
  return ELIGIBLE_LETTERS.filter((letter) => !used.has(letter));
}

/**
 * Picks a random unused letter, or `null` when every eligible letter has been used.
 *
 * The authoritative draw happens server-side; this pure helper defines the rule
 * and is reused by tests and (later) server code. `random` must return [0, 1).
 */
export function pickRandomLetter(
  usedLetters: Iterable<EligibleLetter>,
  random: () => number = Math.random,
): EligibleLetter | null {
  const remaining = getRemainingLetters(usedLetters);
  if (remaining.length === 0) return null;
  const index = Math.min(Math.floor(random() * remaining.length), remaining.length - 1);
  return remaining[index] ?? null;
}
