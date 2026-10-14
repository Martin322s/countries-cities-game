import type { RoomId } from '@/domain';
import { RoomError } from '@/features/rooms/api/roomErrors';
import { callBackend } from '@/features/rooms/api/roomsApi';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { parseStanding, type Standing } from './roundResults';

/** Standings over every revealed round (the final standings once FINISHED). */
export interface GameSummary {
  code: string;
  /** Server time the game finished (null while it is still running). */
  finishedAt: number | null;
  totalRounds: number;
  roundsCompleted: number;
  standings: Standing[];
}

export function parseGameSummary(value: unknown): GameSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RoomError('unknown', 'Malformed summary');
  }
  const record = value as Record<string, unknown>;
  const { code, total_rounds: totalRounds, rounds_completed: roundsCompleted, standings } = record;
  if (
    typeof code !== 'string' ||
    typeof totalRounds !== 'number' ||
    typeof roundsCompleted !== 'number' ||
    !Array.isArray(standings)
  ) {
    throw new RoomError('unknown', 'Malformed summary');
  }
  const finishedAt =
    typeof record.finished_at === 'string' ? Date.parse(record.finished_at) : Number.NaN;
  return {
    code,
    finishedAt: Number.isFinite(finishedAt) ? finishedAt : null,
    totalRounds,
    roundsCompleted,
    standings: standings.map((standing, index) => parseStanding(standing, index)),
  };
}

export function fetchGameSummary(roomId: RoomId): Promise<GameSummary> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient().rpc('get_game_summary', {
      p_room_id: roomId,
    });
    if (error) throw error;
    return parseGameSummary(data);
  });
}
