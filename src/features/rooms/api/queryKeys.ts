import type { RoomId, RoundId } from '@/domain';

/** Single source of TanStack Query keys for room server state. */
export const roomKeys = {
  all: ['rooms'] as const,
  byCode: (code: string) => [...roomKeys.all, 'code', code] as const,
  members: (roomId: RoomId) => [...roomKeys.all, 'members', roomId] as const,
  /** Round state of the room's game (phase, timing, participants — never answers). */
  game: (roomId: RoomId) => [...roomKeys.all, 'game', roomId] as const,
  /** The current player's own persisted answers for a round. */
  ownAnswers: (roundId: RoundId) => [...roomKeys.all, 'own-answers', roundId] as const,
  /** Revealed results of a room (prefix) and of one round. */
  resultsOf: (roomId: RoomId) => [...roomKeys.all, 'results', roomId] as const,
  results: (roomId: RoomId, roundId: RoundId) => [...roomKeys.resultsOf(roomId), roundId] as const,
  /** Cumulative standings over every revealed round (final standings once FINISHED). */
  summary: (roomId: RoomId) => [...roomKeys.resultsOf(roomId), 'summary'] as const,
  /** Fair-play visibility activity of a room (prefix) and of one round. */
  activityOf: (roomId: RoomId) => [...roomKeys.all, 'activity', roomId] as const,
  activity: (roomId: RoomId, roundId: RoundId) =>
    [...roomKeys.activityOf(roomId), roundId] as const,
};
