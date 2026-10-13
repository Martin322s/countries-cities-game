/**
 * Shared helpers for integration tests against the local Supabase stack.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/shared/lib/database.types';

export type Client = SupabaseClient<Database>;
export interface Player {
  client: Client;
  id: string;
}

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
export const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
export const hasLocalSupabase = supabaseUrl !== '' && supabaseKey !== '';

const clients: Client[] = [];

export async function anonymousPlayer(): Promise<Player> {
  const client = createClient<Database>(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${String(error)}`);
  clients.push(client);
  return { client, id: data.user.id };
}

export async function closeAllClients(): Promise<void> {
  await Promise.all(clients.map((client) => client.removeAllChannels()));
}

/** "ok" or the server's error code — handy for asserting expected rejections. */
export function errorCode(result: { error: { message: string } | null }): string {
  return result.error ? result.error.message : 'ok';
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Host + guests in a fresh room (host first). */
export async function roomWith(
  playerCount: number,
): Promise<{ roomId: string; code: string; players: Player[] }> {
  const players = await Promise.all(Array.from({ length: playerCount }, () => anonymousPlayer()));
  const host = players[0]!;
  const created = await host.client.rpc('create_room', {
    p_display_name: 'Играч 0',
    p_capacity: 15,
  });
  if (created.error) throw new Error(created.error.message);
  const code = created.data;
  for (const [index, player] of players.slice(1).entries()) {
    const joined = await player.client.rpc('join_room', {
      p_code: code,
      p_display_name: `Играч ${index + 1}`,
    });
    if (joined.error) throw new Error(joined.error.message);
  }
  const room = await host.client.from('rooms').select('id').eq('code', code).single();
  if (room.error) throw new Error(room.error.message);
  return { roomId: room.data.id, code, players };
}

export interface GameStateShape {
  server_now: string;
  phase: string;
  round: {
    id: string;
    number: number;
    letter: string | null;
    started_at: string | null;
    reveal_at: string | null;
  } | null;
}

export async function gameState(player: Player, roomId: string): Promise<GameStateShape> {
  const { data, error } = await player.client.rpc('get_game_state', { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as unknown as GameStateShape;
}

/**
 * Polls `read` until `done` holds, with a hard timeout. On timeout it throws with the
 * last observed value, so a failure explains itself instead of hanging or flaking
 * silently. Never use fixed sleeps to wait for server-side transitions.
 */
export async function pollUntil<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 8_000, intervalMs = 200 } = {},
): Promise<T> {
  const started = Date.now();
  let attempts = 0;
  let last: T | undefined;
  while (Date.now() - started <= timeoutMs) {
    attempts += 1;
    last = await read();
    if (done(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out after ${timeoutMs} ms / ${attempts} attempts waiting for: ${label}. ` +
      `Last observed: ${JSON.stringify(last)}`,
  );
}

/**
 * Plays a round up to RESULTS_READY: start, everyone ready, wait for the server's
 * start time, save the given answers, everyone locks.
 */
export async function playRoundToResultsReady(
  roomId: string,
  players: Player[],
  answersFor: (letter: string, index: number) => Record<string, string>,
): Promise<{ roundId: string; letter: string }> {
  const host = players[0]!;
  const started = await host.client.rpc('start_game', { p_room_id: roomId });
  if (started.error) throw new Error(started.error.message);
  await Promise.all(players.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })));

  const playing = await pollUntil(
    'letter revealed (countdown over)',
    () => gameState(host, roomId),
    (state) => state.round?.letter != null,
    { timeoutMs: 10_000, intervalMs: 250 },
  );
  const roundId = playing.round!.id;
  const letter = playing.round!.letter!;

  for (const [index, player] of players.entries()) {
    const saved = await player.client.rpc('save_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_answers: answersFor(letter, index),
    });
    if (saved.error) throw new Error(`save failed: ${saved.error.message}`);
  }
  for (const player of players) {
    const locked = await player.client.rpc('lock_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    if (locked.error) throw new Error(`lock failed: ${locked.error.message}`);
  }
  return { roundId, letter };
}

let adminClient: Client | undefined;

/**
 * TEST-ONLY privileged client for the LOCAL stack, used solely to simulate the
 * passage of time (shifting round timestamps) and to probe database guards. The key
 * comes from `supabase status` at runtime and never touches application code; the
 * production RPCs and policies are exercised exactly as clients use them.
 */
export async function localAdmin(): Promise<Client> {
  if (adminClient) return adminClient;
  const { execSync } = await import('node:child_process');
  const status = JSON.parse(
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as { SERVICE_ROLE_KEY?: string; SECRET_KEY?: string };
  const key = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!key) throw new Error('Could not read the local service key from `supabase status`');
  adminClient = createClient<Database>(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

/** Moves a round's timeline into the past by `ms` (simulated time). */
export async function shiftRound(
  roundId: string,
  fields: readonly ('countdown_at' | 'started_at' | 'ends_at' | 'reveal_at')[],
  ms: number,
): Promise<void> {
  const admin = await localAdmin();
  const { data, error } = await admin
    .from('rounds')
    .select('countdown_at, started_at, ends_at, reveal_at')
    .eq('id', roundId)
    .single();
  if (error) throw new Error(`shiftRound read failed: ${error.message}`);
  const patch: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = data[field];
    if (value) patch[field] = new Date(Date.parse(value) - ms).toISOString();
  }
  const update = await admin.from('rounds').update(patch).eq('id', roundId);
  if (update.error) throw new Error(`shiftRound update failed: ${update.error.message}`);
}
