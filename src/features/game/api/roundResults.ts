import {
  CATEGORY_IDS,
  isCategoryId,
  isEligibleLetter,
  isGamePhase,
  type CategoryId,
  type EligibleLetter,
  type GamePhase,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { RoomError } from '@/features/rooms/api/roomErrors';
import { callBackend } from '@/features/rooms/api/roomsApi';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { recordClockSample } from '../clock/serverClock';

/** Server-computed cell state. The client never re-derives scores. */
export type CellState = 'unique' | 'duplicate' | 'empty' | 'wrong_letter' | 'invalid';

export interface ResultCell {
  category: CategoryId;
  /** Original text as submitted (trimmed), for display. */
  answer: string;
  state: CellState;
  points: number;
  /** Size of the duplicate group among valid answers (0 for empty/wrong letter/invalid). */
  duplicateCount: number;
  hostInvalidated?: boolean;
}

export interface PlayerResult {
  playerId: PlayerId;
  displayName: string;
  left: boolean;
  /** Stable participant order (join order). */
  order: number;
  roundPoints: number;
  totalPoints: number;
  cells: ResultCell[];
}

/** Cumulative standing as of the shown round — includes players who missed it. */
export interface Standing {
  playerId: PlayerId;
  displayName: string;
  left: boolean;
  /** Stable join order. */
  order: number;
  totalPoints: number;
  roundsPlayed: number;
}

export interface RoundResults {
  serverNow: number;
  phase: GamePhase;
  round: {
    id: RoundId;
    number: number;
    letter: EligibleLetter | null;
    revealAt: number | null;
    /** False for a historical round (read-only forever). */
    isCurrent: boolean;
  };
  /** Rows of the results table: the participants of this round. */
  players: PlayerResult[];
  standings: Standing[];
}

const CELL_STATES: readonly CellState[] = [
  'unique',
  'duplicate',
  'empty',
  'wrong_letter',
  'invalid',
];

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = (field: string): never => {
  throw new RoomError('unknown', `Malformed results: ${field}`);
};
const num = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : malformed(field);
const str = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : malformed(field);
const time = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(str(value, field));
  return Number.isFinite(parsed) ? parsed : malformed(field);
};

function parseCell(value: unknown): ResultCell {
  if (!isObject(value)) return malformed('cell');
  const category = str(value.category, 'cell.category');
  const state = str(value.state, 'cell.state');
  if (!isCategoryId(category)) return malformed('cell.category');
  if (!(CELL_STATES as readonly string[]).includes(state)) return malformed('cell.state');
  for (const field of ['host_invalidated']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean')
      return malformed(`cell.${field}`);
  }
  return {
    category,
    answer: str(value.answer, 'cell.answer'),
    state: state as CellState,
    points: num(value.points, 'cell.points'),
    duplicateCount: num(value.duplicate_count, 'cell.duplicate_count'),
    hostInvalidated: value.host_invalidated === true,
  };
}

function parsePlayer(value: unknown, order: number): PlayerResult {
  if (!isObject(value)) return malformed('player');
  const cells = Array.isArray(value.cells) ? value.cells.map(parseCell) : malformed('player.cells');
  // Exactly one cell per category, in official order.
  const ordered = CATEGORY_IDS.map(
    (category) => cells.find((cell) => cell.category === category) ?? malformed(`cell ${category}`),
  );
  return {
    playerId: str(value.player_id, 'player.player_id') as PlayerId,
    displayName: str(value.display_name, 'player.display_name'),
    left: value.left === true,
    order,
    roundPoints: num(value.round_points, 'player.round_points'),
    totalPoints: num(value.total_points, 'player.total_points'),
    cells: ordered,
  };
}

export function parseStanding(value: unknown, order: number): Standing {
  if (!isObject(value)) return malformed('standing');
  return {
    playerId: str(value.player_id, 'standing.player_id') as PlayerId,
    displayName: str(value.display_name, 'standing.display_name'),
    left: value.left === true,
    order,
    totalPoints: num(value.total_points, 'standing.total_points'),
    roundsPlayed: num(value.rounds_played, 'standing.rounds_played'),
  };
}

export function parseRoundResults(value: unknown): RoundResults {
  if (!isObject(value) || !isObject(value.round)) return malformed('root');
  const phase = str(value.phase, 'phase');
  if (!isGamePhase(phase)) return malformed('phase');
  const letter = value.round.letter;
  const players = Array.isArray(value.players) ? value.players : malformed('players');
  const standings = Array.isArray(value.standings) ? value.standings : malformed('standings');
  return {
    serverNow: time(value.server_now, 'server_now') ?? malformed('server_now'),
    phase,
    round: {
      id: str(value.round.id, 'round.id') as RoundId,
      number: num(value.round.number, 'round.number'),
      letter: typeof letter === 'string' && isEligibleLetter(letter) ? letter : null,
      revealAt: time(value.round.reveal_at, 'round.reveal_at'),
      isCurrent: value.round.is_current === true,
    },
    players: players.map((player, index) => parsePlayer(player, index)),
    standings: standings.map((standing, index) => parseStanding(standing, index)),
  };
}

export function fetchRoundResults(roomId: RoomId, roundId: RoundId): Promise<RoundResults> {
  return callBackend(async () => {
    const requestStart = Date.now();
    const { data, error } = await getSupabaseClient().rpc('get_round_results', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    const requestEnd = Date.now();
    if (error) throw error;
    const results = parseRoundResults(data);
    recordClockSample({ serverMs: results.serverNow, requestStart, requestEnd });
    return results;
  });
}

/** Host only (enforced by the server). Idempotent. */
export function setAnswerInvalidated(input: {
  roomId: RoomId;
  roundId: RoundId;
  playerId: PlayerId;
  category: CategoryId;
  invalidated: boolean;
}): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('set_answer_invalidated', {
      p_room_id: input.roomId,
      p_round_id: input.roundId,
      p_player_id: input.playerId,
      p_category: input.category,
      p_invalidated: input.invalidated,
    });
    if (error) throw error;
  });
}
