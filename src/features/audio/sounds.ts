/**
 * The game's sound palette. Every sound is synthesized with the Web Audio API (see
 * synth.ts) — no audio files, no network, no licensing questions, ~0 bytes.
 */
export const SOUND_IDS = [
  /** 3 · 2 — one short tick per number. */
  'countdown-tick',
  /** 1 — the same tick, a step higher: the letter is next. */
  'countdown-final',
  /** started_at: the letter appears (the "go"). */
  'letter',
  /** Final ten seconds, once per second (not for players who already locked). */
  'timer-tick',
  /** ends_at: time is up. */
  'time-up',
  /** The current player locked their answers ("ГОТОВ"). */
  'ready',
  /** Everyone locked early — the round ended before the timer. */
  'all-ready',
  /** A brief pause before the results reveal. */
  'suspense',
  /** A category column reveals; the variant follows the current player's own cell. */
  'reveal-unique',
  'reveal-duplicate',
  'reveal-invalid',
  'reveal-neutral',
  /** Round totals appear. */
  'score',
  /** The overall leaderboard appears. */
  'leaderboard',
  /** FINISHED, first time only. */
  'winner',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];
