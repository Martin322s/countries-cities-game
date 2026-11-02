/**
 * Gameplay against a REAL local Supabase stack (npx supabase start).
 * Run with:  npm run test:integration
 *
 * Covers what pgTAP cannot: true concurrency across connections, real server time
 * (the 3 s countdown), the public API surface and Realtime delivery.
 */
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import type { Database } from '@/shared/lib/database.types';

import { finishValidation, pollUntil } from './helpers';

type Client = SupabaseClient<Database>;
interface Player {
  client: Client;
  id: string;
}

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const clients: Client[] = [];

async function anonymousPlayer(): Promise<Player> {
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${String(error)}`);
  clients.push(client);
  return { client, id: data.user.id };
}

function errorCode(result: { error: { message: string } | null }): string {
  return result.error ? result.error.message : 'ok';
}

/** Host + guests in a room. Returns room id and players (host first). */
async function roomWith(playerCount: number): Promise<{ roomId: string; players: Player[] }> {
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
  return { roomId: room.data.id, players };
}

interface StateShape {
  server_now: string;
  phase: string;
  round: { id: string; number: number; letter: string | null; started_at: string | null } | null;
}

async function gameState(player: Player, roomId: string): Promise<StateShape> {
  const { data, error } = await player.client.rpc('get_game_state', { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as unknown as StateShape;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  await Promise.all(clients.map((client) => client.removeAllChannels()));
});

describe.skipIf(!url || !key)('gameplay against local Supabase', () => {
  it('rejects a direct start_game from a non-host and double starts', async () => {
    const { roomId, players } = await roomWith(2);
    const [host, guest] = players as [Player, Player];
    expect(errorCode(await guest.client.rpc('start_game', { p_room_id: roomId }))).toBe('not_host');

    const results = await Promise.all([
      host.client.rpc('start_game', { p_room_id: roomId }),
      host.client.rpc('start_game', { p_room_id: roomId }),
      host.client.rpc('start_game', { p_room_id: roomId }),
    ]);
    expect(results.map(errorCode).sort()).toEqual([
      'game_already_started',
      'game_already_started',
      'ok',
    ]);
    const rounds = await host.client.from('rounds').select('id').eq('room_id', roomId);
    expect(rounds.data).toHaveLength(1);
  });

  it('creates exactly one round with one letter when everyone readies at once', async () => {
    const { roomId, players } = await roomWith(6);
    await players[0]!.client.rpc('start_game', { p_room_id: roomId });

    // Every player fires READY twice, all at the same time.
    const results = await Promise.all(
      players.flatMap((player) => [
        player.client.rpc('set_round_ready', { p_room_id: roomId }),
        player.client.rpc('set_round_ready', { p_room_id: roomId }),
      ]),
    );
    expect(results.map(errorCode).every((code) => code === 'ok')).toBe(true);

    const rounds = await players[0]!.client
      .from('rounds')
      .select('id, started_at')
      .eq('room_id', roomId);
    expect(rounds.data).toHaveLength(1);
    const state = await gameState(players[0]!, roomId);
    expect(state.phase).toBe('COUNTDOWN');
    expect(state.round?.number).toBe(1);
    // Hidden during the countdown, through both read paths.
    expect(state.round?.letter).toBeNull();
    const direct = await players[1]!.client.from('rounds').select('letter').eq('room_id', roomId);
    expect(direct.error?.code).toBe('42501');
  });

  it('plays a full round: real countdown, private answers, early finish, results-ready', async () => {
    const { roomId, players } = await roomWith(3);
    const [stoyan, desi, kaloyan] = players as [Player, Player, Player];
    await stoyan.client.rpc('start_game', { p_room_id: roomId });

    // Realtime watcher on the room channel: answers must never be broadcast.
    const leaked: unknown[] = [];
    await kaloyan.client.realtime.setAuth();
    await new Promise<void>((resolve) => {
      kaloyan.client
        .channel(`room:${roomId}`, {
          config: { private: true, postgres_changes_options: { wait: true } },
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, (payload) => {
          leaked.push(payload);
        })
        .subscribe((status) => {
          if (status !== REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return;
          resolve();
        });
      // A table outside the publication may never confirm; don't block the test on it.
      setTimeout(resolve, 5_000);
    });

    await Promise.all(players.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })));
    const countdown = await gameState(stoyan, roomId);
    const roundId = countdown.round!.id;
    // Wait using the SERVER clock (the Docker VM clock may differ from this machine's),
    // exactly like the app does with its clock-offset estimate.
    const serverWait = Date.parse(countdown.round!.started_at!) - Date.parse(countdown.server_now);

    // Saving during the countdown is refused by server time.
    const early = await desi.client.rpc('save_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_answers: { country: 'Сърбия' },
    });
    expect(errorCode(early)).toBe('wrong_phase');

    await sleep(Math.max(0, serverWait));
    // Like the app: poll (bounded, with diagnostics) until the server reveals the letter.
    const playing = await pollUntil(
      'letter revealed after started_at',
      () => gameState(desi, roomId),
      (state) => state.round?.letter != null,
      { timeoutMs: 5_000, intervalMs: 250 },
    );
    expect(playing.round?.letter).toMatch(/^[А-Я]$/);
    expect(['Ъ', 'Ь']).not.toContain(playing.round?.letter);

    for (const [player, country] of [
      [stoyan, 'Сърбия'],
      [desi, 'сърбия'],
      [kaloyan, 'Словакия'],
    ] as const) {
      const saved = await player.client.rpc('save_answers', {
        p_room_id: roomId,
        p_round_id: roundId,
        p_answers: { country },
      });
      expect(errorCode(saved)).toBe('ok');
    }

    // Privacy while playing: own answers only — host included.
    const desiView = await desi.client.from('answers').select('player_id').eq('round_id', roundId);
    expect(desiView.data?.map((row) => row.player_id)).toEqual([desi.id]);
    const hostView = await stoyan.client
      .from('answers')
      .select('player_id')
      .eq('round_id', roundId);
    expect(hostView.data?.map((row) => row.player_id)).toEqual([stoyan.id]);

    // Desi locks first and can no longer change anything.
    expect(
      errorCode(await desi.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId })),
    ).toBe('ok');
    const afterLock = await desi.client.rpc('save_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_answers: { country: 'Сенегал' },
    });
    expect(errorCode(afterLock)).toBe('answers_locked');
    expect((await gameState(stoyan, roomId)).phase).toBe('RESULTS_READY');

    // The last two lock at the same time → exactly one early finish.
    const locks = await Promise.all([
      stoyan.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
      kaloyan.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
      kaloyan.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
    ]);
    expect(locks.map(errorCode)).toEqual(['ok', 'ok', 'ok']);
    const locked = await stoyan.client
      .from('rounds')
      .select('locked_at, lock_reason')
      .eq('id', roundId)
      .single();
    expect(locked.data?.lock_reason).toBe('stop');
    expect((await gameState(stoyan, roomId)).phase).toBe('RESULTS_READY');

    // Still private before the reveal.
    const beforeReveal = await desi.client
      .from('answers')
      .select('player_id')
      .eq('round_id', roundId);
    expect(beforeReveal.data).toHaveLength(1);

    // Results-ready concurrently → REVEAL exactly once.
    const ready = await Promise.all(
      players.map((p) => p.client.rpc('set_results_ready', { p_room_id: roomId })),
    );
    expect(ready.map(errorCode)).toEqual(['ok', 'ok', 'ok']);
    expect((await gameState(kaloyan, roomId)).phase).toBe('AI_VALIDATING');
    await finishValidation(roomId, roundId);
    expect((await gameState(kaloyan, roomId)).phase).toBe('REVEAL');
    const revealed = await desi.client.from('answers').select('player_id').eq('round_id', roundId);
    expect(revealed.data).toHaveLength(3);

    await sleep(500);
    expect(leaked).toEqual([]);
  }, 30_000);

  it('blocks new players but lets a participant who left come back', async () => {
    const { roomId, players } = await roomWith(2);
    const [host, guest] = players as [Player, Player];
    await host.client.rpc('start_game', { p_room_id: roomId });
    const room = await host.client.from('rooms').select('code').eq('id', roomId).single();
    const code = room.data!.code;

    const newcomer = await anonymousPlayer();
    expect(
      errorCode(await newcomer.client.rpc('join_room', { p_code: code, p_display_name: 'Нов' })),
    ).toBe('game_in_progress');

    expect(errorCode(await guest.client.rpc('leave_room', { p_room_id: roomId }))).toBe('ok');
    expect(
      errorCode(await guest.client.rpc('join_room', { p_code: code, p_display_name: 'Друго' })),
    ).toBe('ok');
    const state = await gameState(guest, roomId);
    expect(state.phase).toBe('ROUND_WAITING');
  });
});
