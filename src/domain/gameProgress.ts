import { MAX_ROUNDS_PER_GAME } from './alphabet';
import { MIN_PLAYERS } from './config';
import type { LeaderboardEntry } from './leaderboard';
import type { GamePhase } from './phases';

/**
 * Authoritative progress of a game (from the server). A full game is one round per
 * eligible letter: 28 rounds. There is no manual early end.
 */
export interface GameProgress {
  totalRounds: number;
  /** Letters already revealed in this game (never the identity of future letters). */
  lettersUsed: number;
  /** Rounds whose results have been revealed. */
  roundsCompleted: number;
  isFinalRound: boolean;
  /** Members who would be included in the next round's snapshot right now. */
  eligiblePlayers: number;
}

export const TOTAL_ROUNDS = MAX_ROUNDS_PER_GAME;

export function lettersRemaining(progress: GameProgress): number {
  return Math.max(0, progress.totalRounds - progress.lettersUsed);
}

export function nextRoundNumber(currentRoundNumber: number | null): number | null {
  const next = (currentRoundNumber ?? 0) + 1;
  return next <= TOTAL_ROUNDS ? next : null;
}

/** What the host can do on the RESULTS screen. */
export type ResultsAction = 'next_round' | 'finish_game' | 'none';

export function resultsAction(phase: GamePhase, progress: GameProgress): ResultsAction {
  if (phase !== 'RESULTS') return 'none';
  if (progress.isFinalRound || lettersRemaining(progress) === 0) return 'finish_game';
  return 'next_round';
}

export type NextRoundBlocker = 'not_enough_players' | 'no_letters_left';

/** Mirrors the server checks of `start_next_round` (the server stays authoritative). */
export function nextRoundBlocker(progress: GameProgress): NextRoundBlocker | null {
  if (lettersRemaining(progress) === 0) return 'no_letters_left';
  if (progress.eligiblePlayers < MIN_PLAYERS) return 'not_enough_players';
  return null;
}

/**
 * Only the current round can change (host invalidation), and only while its results
 * are shown. Earlier rounds freeze when the next round starts; everything freezes
 * when the game is finished.
 */
export function isRoundEditable(input: { isCurrentRound: boolean; phase: GamePhase }): boolean {
  return input.isCurrentRound && (input.phase === 'REVEAL' || input.phase === 'RESULTS');
}

/** Everyone sharing the best total — ties are joint winners, never broken. */
export function winnersOf<T extends Pick<LeaderboardEntry, 'rank'>>(ranked: readonly T[]): T[] {
  return ranked.filter((entry) => entry.rank === 1);
}

/** Bulgarian list: "А", "А и Б", "А, Б и В". */
export function joinBulgarian(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1] ?? ''}`;
}

/** "Победител: Стоян" / "Победители: Стоян и Деси" / "Победители: А, Б и В". */
export function formatWinners(names: readonly string[]): string {
  if (names.length === 0) return '';
  return `${names.length === 1 ? 'Победител' : 'Победители'}: ${joinBulgarian(names)}`;
}
