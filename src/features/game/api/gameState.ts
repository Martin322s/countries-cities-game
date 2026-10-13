import {
  isEligibleLetter,
  isGamePhase,
  type EligibleLetter,
  type GameProgress,
  type GamePhase,
  type PlayerId,
  type RoundId,
  type RoundParticipant,
  type RoundTimeline,
} from '@/domain';
import { RoomError } from '@/features/rooms/api/roomErrors';

export type RoundLockReason = 'all_ready' | 'timeout' | 'stop';

export interface GameRound {
  id: RoundId;
  number: number;
  /** Only present once the server reveals it (at started_at). */
  letter: EligibleLetter | null;
  timeline: RoundTimeline;
  lockReason: RoundLockReason | null;
}

/** A round whose results can be browsed (revealed). Its letter is no secret anymore. */
export interface RevealedRound {
  id: RoundId;
  number: number;
  letter: EligibleLetter | null;
}

/** The game read model returned by `get_game_state`. Never contains answers. */
export interface GameState {
  serverNow: number;
  phase: GamePhase;
  progress: GameProgress;
  revealedRounds: RevealedRound[];
  round: GameRound | null;
  participants: RoundParticipant[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(field: string): never {
  throw new RoomError('unknown', `Malformed game state: ${field}`);
}

function str(object: JsonObject, key: string): string {
  const value = object[key];
  return typeof value === 'string' ? value : malformed(key);
}

function optionalStr(object: JsonObject, key: string): string | null {
  const value = object[key];
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : malformed(key);
}

function bool(object: JsonObject, key: string): boolean {
  const value = object[key];
  return typeof value === 'boolean' ? value : malformed(key);
}

function timestamp(object: JsonObject, key: string): number | null {
  const value = optionalStr(object, key);
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : malformed(key);
}

function parseRound(value: unknown): GameRound | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return malformed('round');
  const number = value.number;
  if (typeof number !== 'number') return malformed('round.number');
  const letter = optionalStr(value, 'letter');
  if (letter !== null && !isEligibleLetter(letter)) return malformed('round.letter');
  const lockReason = optionalStr(value, 'lock_reason');
  if (
    lockReason !== null &&
    lockReason !== 'all_ready' &&
    lockReason !== 'timeout' &&
    lockReason !== 'stop'
  ) {
    return malformed('round.lock_reason');
  }
  return {
    id: str(value, 'id') as RoundId,
    number,
    letter,
    timeline: {
      countdownAt: timestamp(value, 'countdown_at'),
      startedAt: timestamp(value, 'started_at'),
      endsAt: timestamp(value, 'ends_at'),
      lockedAt: timestamp(value, 'locked_at'),
      revealAt: timestamp(value, 'reveal_at'),
    },
    lockReason,
  };
}

function parseParticipant(value: unknown): RoundParticipant {
  if (!isObject(value)) return malformed('participant');
  const lockReason = optionalStr(value, 'answers_lock_reason');
  if (
    lockReason !== null &&
    lockReason !== 'ready' &&
    lockReason !== 'left' &&
    lockReason !== 'tab_exit'
  ) {
    return malformed('participant.answers_lock_reason');
  }
  return {
    playerId: str(value, 'player_id') as PlayerId,
    displayName: str(value, 'display_name'),
    joinedAt: str(value, 'joined_at'),
    lastSeenAt: str(value, 'last_seen_at'),
    left: bool(value, 'left'),
    roundReady: bool(value, 'round_ready'),
    answersLockedAt: optionalStr(value, 'answers_locked_at'),
    answersLockReason: lockReason,
    resultsReady: bool(value, 'results_ready'),
  };
}

function count(object: JsonObject, key: string): number {
  const value = object[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : malformed(key);
}

function parseProgress(value: unknown): GameProgress {
  if (!isObject(value)) return malformed('progress');
  return {
    totalRounds: count(value, 'total_rounds'),
    lettersUsed: count(value, 'letters_used'),
    roundsCompleted: count(value, 'rounds_completed'),
    isFinalRound: bool(value, 'is_final_round'),
    eligiblePlayers: count(value, 'eligible_players'),
  };
}

function parseRevealedRound(value: unknown): RevealedRound {
  if (!isObject(value)) return malformed('revealed_round');
  const letter = optionalStr(value, 'letter');
  return {
    id: str(value, 'id') as RoundId,
    number: count(value, 'number'),
    letter: letter !== null && isEligibleLetter(letter) ? letter : null,
  };
}

/** Validates the untyped JSON from `get_game_state`. */
export function parseGameState(value: unknown): GameState {
  if (!isObject(value)) return malformed('root');
  const phase = str(value, 'phase');
  if (!isGamePhase(phase)) return malformed('phase');
  const serverNow = timestamp(value, 'server_now') ?? malformed('server_now');
  const participants = value.participants;
  if (!Array.isArray(participants)) return malformed('participants');
  const revealedRounds = value.revealed_rounds;
  if (!Array.isArray(revealedRounds)) return malformed('revealed_rounds');
  return {
    serverNow,
    phase,
    progress: parseProgress(value.progress),
    revealedRounds: revealedRounds.map(parseRevealedRound),
    round: parseRound(value.round),
    participants: participants.map(parseParticipant),
  };
}
