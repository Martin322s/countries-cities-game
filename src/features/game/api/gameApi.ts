import { isCategoryId, type CategoryId, type PlayerId, type RoomId, type RoundId } from '@/domain';
import { callBackend } from '@/features/rooms/api/roomsApi';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { recordClockSample } from '../clock/serverClock';
import { parseGameState, type GameState } from './gameState';

/*
 * Gameplay RPCs. The server identifies the caller via auth.uid() and decides every
 * outcome; the client only sends intents (and, for saves, the answer text).
 */

export function fetchGameState(roomId: RoomId): Promise<GameState> {
  return callBackend(async () => {
    const requestStart = Date.now();
    const { data, error } = await getSupabaseClient().rpc('get_game_state', {
      p_room_id: roomId,
    });
    const requestEnd = Date.now();
    if (error) throw error;
    const state = parseGameState(data);
    recordClockSample({ serverMs: state.serverNow, requestStart, requestEnd });
    return state;
  });
}

export function startGame(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('start_game', { p_room_id: roomId });
    if (error) throw error;
  });
}

export function setRoundReady(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('set_round_ready', { p_room_id: roomId });
    if (error) throw error;
  });
}

export function setResultsReady(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('set_results_ready', { p_room_id: roomId });
    if (error) throw error;
  });
}

export function saveAnswers(
  roomId: RoomId,
  roundId: RoundId,
  answers: Partial<Record<CategoryId, string>>,
): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('save_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_answers: answers,
    });
    if (error) throw error;
  });
}

/** Locks this player's answers for the current round. */
export function lockAnswers(roomId: RoomId, roundId: RoundId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('lock_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    if (error) throw error;
  });
}

/** The caller's own persisted answers for a round (RLS returns only their rows). */
export function fetchOwnAnswers(
  roundId: RoundId,
  playerId: PlayerId,
): Promise<Partial<Record<CategoryId, string>>> {
  return callBackend(async () => {
    const { data, error } = await getSupabaseClient()
      .from('answers')
      .select('category, raw_value')
      .eq('round_id', roundId)
      .eq('player_id', playerId);
    if (error) throw error;
    const answers: Partial<Record<CategoryId, string>> = {};
    for (const row of data) {
      if (isCategoryId(row.category)) answers[row.category] = row.raw_value;
    }
    return answers;
  });
}

/** Host only: RESULTS → next round's ROUND_WAITING (no letter, no timer yet). */
export function startNextRound(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('start_next_round', { p_room_id: roomId });
    if (error) throw error;
  });
}

/** Host only: after round 28's RESULTS → FINISHED. Idempotent. */
export function finishGame(roomId: RoomId): Promise<void> {
  return callBackend(async () => {
    const { error } = await getSupabaseClient().rpc('finish_game', { p_room_id: roomId });
    if (error) throw error;
  });
}
