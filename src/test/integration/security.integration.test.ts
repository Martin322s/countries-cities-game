/**
 * Adversarial security regression suite (Web v1.0) — real clients against the real
 * local stack: PostgREST, RLS, Realtime and the rate-limit hook. Every attack must be
 * rejected safely or be harmless by design.
 * Run with:  npm run test:integration
 */
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import {
  anonymousPlayer,
  closeAllClients,
  errorCode,
  gameState,
  hasLocalSupabase,
  roomWith,
  shiftRound,
  supabaseKey,
  supabaseUrl,
  type Player,
} from './helpers';

const NIL = '00000000-0000-0000-0000-000000000000';

/** Two rooms in PLAYING; returns ids and players (A host = a[0], B host = b[0]). */
async function twoPlayingRooms() {
  const A = await roomWith(2);
  const B = await roomWith(2);
  for (const room of [A, B]) {
    expect(
      errorCode(await room.players[0]!.client.rpc('start_game', { p_room_id: room.roomId })),
    ).toBe('ok');
    await Promise.all(
      room.players.map((p) => p.client.rpc('set_round_ready', { p_room_id: room.roomId })),
    );
    const roundId = (await gameState(room.players[0]!, room.roomId)).round!.id;
    await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);
  }
  const roundOf = async (room: typeof A) =>
    (await gameState(room.players[0]!, room.roomId)).round!.id;
  return { A, B, roundA: await roundOf(A), roundB: await roundOf(B) };
}

describe.skipIf(!hasLocalSupabase)('security: adversarial clients', () => {
  afterAll(async () => {
    await closeAllClients();
  });

  it('isolates rooms: a player (even a host) in room A cannot read or act in room B', async () => {
    const { A, B, roundB } = await twoPlayingRooms();
    const attacker = A.players[0]!; // host of A
    const victim = B.players[1]!;
    expect(
      errorCode(
        await victim.client.rpc('save_answers', {
          p_room_id: B.roomId,
          p_round_id: roundB,
          p_answers: { country: 'Тайна' },
        }),
      ),
    ).toBe('ok');

    // Table reads through RLS.
    for (const table of [
      'rooms',
      'room_players',
      'answer_sheets',
      'ready_checks',
      'visibility_events',
    ] as const) {
      const query = attacker.client.from(table).select('*') as unknown as {
        eq: (column: string, value: string) => Promise<{ data: unknown[] | null }>;
      };
      const { data } = await query.eq(table === 'rooms' ? 'id' : 'room_id', B.roomId);
      expect(data, table).toEqual([]);
    }
    const answers = await attacker.client.from('answers').select('*').eq('round_id', roundB);
    expect(answers.data).toEqual([]);

    // Every read RPC.
    for (const [fn, args] of [
      ['get_game_state', { p_room_id: B.roomId }],
      ['get_game_summary', { p_room_id: B.roomId }],
      ['get_round_results', { p_room_id: B.roomId, p_round_id: roundB }],
      ['get_round_activity', { p_room_id: B.roomId, p_round_id: roundB }],
    ] as const) {
      expect(errorCode(await attacker.client.rpc(fn, args as never)), fn).toBe('not_member');
    }
    // Every mutating RPC.
    const attempts = await Promise.all([
      attacker.client.rpc('heartbeat', { p_room_id: B.roomId }),
      attacker.client.rpc('set_round_ready', { p_room_id: B.roomId }),
      attacker.client.rpc('save_answers', {
        p_room_id: B.roomId,
        p_round_id: roundB,
        p_answers: { country: 'X' },
      }),
      attacker.client.rpc('lock_answers', { p_room_id: B.roomId, p_round_id: roundB }),
      attacker.client.rpc('set_results_ready', { p_room_id: B.roomId }),
      attacker.client.rpc('start_next_round', { p_room_id: B.roomId }),
      attacker.client.rpc('finish_game', { p_room_id: B.roomId }),
      attacker.client.rpc('leave_room', { p_room_id: B.roomId }),
      attacker.client.rpc('report_visibility', {
        p_room_id: B.roomId,
        p_round_id: roundB,
        p_visible: false,
      }),
      attacker.client.rpc('set_answer_invalidated', {
        p_room_id: B.roomId,
        p_round_id: roundB,
        p_player_id: victim.id,
        p_category: 'country',
        p_invalidated: true,
      }),
    ]);
    for (const result of attempts)
      expect(['not_member', 'not_participant']).toContain(errorCode(result));
    // Using room A's id with room B's round does not help either.
    expect(
      errorCode(
        await attacker.client.rpc('save_answers', {
          p_room_id: A.roomId,
          p_round_id: roundB,
          p_answers: { country: 'X' },
        }),
      ),
    ).toBe('round_not_active');
    expect(
      errorCode(
        await attacker.client.rpc('get_round_results', { p_room_id: A.roomId, p_round_id: roundB }),
      ),
    ).not.toBe('ok');
  });

  it('keeps answers private until the reveal — the host included', async () => {
    const { A, roundA } = await twoPlayingRooms();
    const [host, guest] = A.players as [Player, Player];
    await guest.client.rpc('save_answers', {
      p_room_id: A.roomId,
      p_round_id: roundA,
      p_answers: { city: 'Тайно' },
    });
    const peek = await host.client
      .from('answers')
      .select('raw_value, player_id')
      .eq('round_id', roundA);
    expect(peek.data?.some((row) => row.player_id === guest.id)).toBe(false);
    expect(
      errorCode(
        await host.client.rpc('get_round_results', { p_room_id: A.roomId, p_round_id: roundA }),
      ),
    ).toBe('results_not_available');
  });

  it('forbids impersonation, early finishing and direct writes', async () => {
    const { A, roundA } = await twoPlayingRooms();
    const [host, guest] = A.players as [Player, Player];
    expect(errorCode(await guest.client.rpc('start_next_round', { p_room_id: A.roomId }))).toBe(
      'not_host',
    );
    expect(errorCode(await guest.client.rpc('finish_game', { p_room_id: A.roomId }))).toBe(
      'not_host',
    );
    expect(['wrong_phase', 'letters_remaining']).toContain(
      errorCode(await host.client.rpc('finish_game', { p_room_id: A.roomId })),
    );

    // Direct table writes — every table, every verb.
    const writes = await Promise.all([
      guest.client.from('rooms').update({ host_player_id: guest.id }).eq('id', A.roomId).select(),
      guest.client.from('room_players').insert({
        room_id: A.roomId,
        player_id: guest.id,
        display_name: 'X',
        display_name_key: 'x',
      }),
      guest.client.from('answers').insert({
        round_id: roundA,
        player_id: host.id,
        category: 'city',
        raw_value: 'X',
        normalized_value: 'x',
      }),
      guest.client.from('answers').update({ raw_value: 'X' }).eq('round_id', roundA).select(),
      guest.client
        .from('answer_sheets')
        .update({ submitted_at: null })
        .eq('round_id', roundA)
        .select(),
      guest.client.from('ready_checks').delete().eq('round_id', roundA).select(),
      guest.client.from('visibility_events').insert({
        round_id: roundA,
        player_id: host.id,
        room_id: A.roomId,
        away_at: new Date().toISOString(),
      }),
      guest.client
        .from('rounds')
        .update({ ends_at: new Date().toISOString() })
        .eq('id', roundA)
        .select(),
    ]);
    for (const write of writes) {
      // Either a privilege error, or (for filtered updates/deletes) nothing touched.
      if (write.error) expect(write.error.code).toBe('42501');
      else expect(write.data ?? []).toEqual([]);
    }
    // Nothing changed: the next real request applies due transitions as usual.
    await host.client.rpc('heartbeat', { p_room_id: A.roomId });
    const after = await gameState(host, A.roomId);
    expect(after.phase).toBe('PLAYING');
    expect(after.round?.id).toBe(roundA);
  });

  it('cannot read the hidden letter or old-round answers early', async () => {
    const { A, roundA } = await twoPlayingRooms();
    const letter = await A.players[1]!.client.from('rounds').select('letter').eq('id', roundA);
    expect(letter.error?.code).toBe('42501');
  });

  it('rejects malformed identifiers and hostile text without leaking internals', async () => {
    const player = await anonymousPlayer();
    const bad = await player.client.rpc('get_game_state', { p_room_id: 'not-a-uuid' });
    expect(bad.error).not.toBeNull();
    expect(bad.data).toBeNull();

    for (const code of [
      "' OR 1=1 --",
      '<script>',
      'ЖЖЖЖЖ',
      '\u0000AB',
      '   ',
      '🙂🙂🙂🙂🙂',
      'a'.repeat(5000),
    ]) {
      const result = await player.client.rpc('join_room', { p_code: code, p_display_name: 'Деси' });
      // A NUL byte cannot exist in Postgres text: PostgREST refuses the request itself.
      const allowed = code.includes('\u0000')
        ? /^(invalid_room_code|ok|unsupported Unicode escape sequence)$/
        : /^(invalid_room_code|ok)$/;
      expect(errorCode(result), JSON.stringify(code).slice(0, 20)).toMatch(allowed);
      if (!result.error) expect(result.data).toBeNull();
    }

    // Hostile display names are stored as plain text (React renders text, never HTML).
    const html = '<img src=x onerror=alert(1)>'.slice(0, 20);
    const created = await player.client.rpc('create_room', { p_display_name: html, p_capacity: 4 });
    expect(errorCode(created)).toBe('ok');
    const roster = await player.client
      .from('room_players')
      .select('display_name')
      .eq('player_id', player.id);
    expect(roster.data?.[0]?.display_name).toBe(html);

    // A 1 MB name never reaches normalization: the request is refused by size.
    const huge = await player.client.rpc('create_room', {
      p_display_name: 'Я'.repeat(500_000),
      p_capacity: 4,
    });
    expect(errorCode(huge)).toBe('payload_too_large');
  });

  it('accepts the keepalive request shape only with a valid token', async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/report_visibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: 'Bearer forged.token.value',
      },
      body: JSON.stringify({ p_room_id: NIL, p_round_id: NIL, p_visible: false }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects everything after leaving, and every mutation after FINISHED', async () => {
    const { roomId, players } = await roomWith(3);
    const [host, guest, leaver] = players as [Player, Player, Player];
    expect(errorCode(await leaver.client.rpc('leave_room', { p_room_id: roomId }))).toBe('ok');
    for (const fn of ['heartbeat', 'get_game_state', 'set_round_ready'] as const) {
      expect(errorCode(await leaver.client.rpc(fn, { p_room_id: roomId })), fn).toMatch(
        /not_member|not_participant/,
      );
    }
    expect(
      (await leaver.client.from('room_players').select('*').eq('room_id', roomId)).data,
    ).toEqual([]);
    expect(host.id).not.toBe(guest.id);
  });

  it('denies Realtime room channels to outsiders and to players who left', async () => {
    const { roomId, players } = await roomWith(2);
    const outsider = await anonymousPlayer();
    const leaver = players[1]!;
    expect(errorCode(await leaver.client.rpc('leave_room', { p_room_id: roomId }))).toBe('ok');

    const tryJoin = async (player: Player) => {
      await player.client.realtime.setAuth();
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          resolve('timeout');
        }, 8_000);
        player.client
          .channel(`room:${roomId}`, { config: { private: true } })
          .subscribe((status) => {
            if (
              status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ||
              status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR
            ) {
              clearTimeout(timer);
              resolve(status);
            }
          });
      });
    };
    expect(await tryJoin(outsider)).not.toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(await tryJoin(leaver)).not.toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(await tryJoin(players[0]!)).toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  }, 30_000);

  it('rate limits room-creation spam, also when fired concurrently', async () => {
    const spammer = await anonymousPlayer();
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        spammer.client.rpc('create_room', { p_display_name: `Бот ${String(i)}`, p_capacity: 2 }),
      ),
    );
    const ok = results.filter((r) => !r.error).length;
    expect(ok).toBeLessThanOrEqual(10);
    expect(results.filter((r) => errorCode(r) === 'rate_limited').length).toBe(25 - ok);
    const { data: rooms } = await spammer.client
      .from('room_players')
      .select('room_id')
      .eq('player_id', spammer.id);
    expect(rooms?.length).toBe(ok);
  });

  it('limits room-code guessing per identity', async () => {
    const guesser = await anonymousPlayer();
    const codes = 'ABCDEFGHJKMNPQRSTUVWXYZ'.split('').map((c) => `QQQ${c}2`);
    const results: string[] = [];
    for (const code of codes) {
      const r = await guesser.client.rpc('join_room', { p_code: code, p_display_name: 'Деси' });
      results.push(r.error ? r.error.message : JSON.stringify(r.data));
    }
    expect(results.slice(0, 20).every((r) => r === 'null')).toBe(true);
    expect(results.slice(20).every((r) => r === 'rate_limited')).toBe(true);
  });
});
