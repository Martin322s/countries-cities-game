/**
 * Concurrency + destructive host-migration suite (Web v1.0). Real clients, real RPCs;
 * only time and liveness are simulated (test-only local service client shifting
 * timestamps). Races are repeated in several independent rooms — "passed once" is not
 * accepted.
 * Run with:  npm run test:integration
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  closeAllClients,
  errorCode,
  gameState,
  hasLocalSupabase,
  localAdmin,
  pollUntil,
  roomWith,
  shiftRound,
  type Player,
} from './helpers';

const REPEAT = 4;
const SPAM = 50;

const spam = <T>(n: number, call: () => PromiseLike<T>) =>
  Promise.all(Array.from({ length: n }, () => call()));

async function hostOf(roomId: string) {
  const admin = await localAdmin();
  const { data } = await admin.from('rooms').select('host_player_id').eq('id', roomId).single();
  return data?.host_player_id ?? '';
}

async function roundRow(roundId: string) {
  const admin = await localAdmin();
  const { data } = await admin
    .from('rounds')
    .select('id, round_number, letter, started_at, ends_at, locked_at, reveal_at')
    .eq('id', roundId)
    .single();
  return data!;
}

/** Drives a fresh 3-player room to the given phase. Returns room, players, round. */
async function roomIn(
  phase:
    | 'LOBBY'
    | 'ROUND_WAITING'
    | 'COUNTDOWN'
    | 'PLAYING'
    | 'RESULTS_READY'
    | 'REVEAL'
    | 'RESULTS',
) {
  const { roomId, players } = await roomWith(3);
  const [host] = players as [Player, Player, Player];
  if (phase === 'LOBBY') return { roomId, players, roundId: null as string | null };
  await host.client.rpc('start_game', { p_room_id: roomId });
  let roundId = (await gameState(host, roomId)).round!.id;
  if (phase === 'ROUND_WAITING') return { roomId, players, roundId };
  await Promise.all(players.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })));
  if (phase === 'COUNTDOWN') return { roomId, players, roundId };
  await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);
  await Promise.all(
    players.map((p, i) =>
      p.client.rpc('save_answers', {
        p_room_id: roomId,
        p_round_id: roundId,
        p_answers: { country: i === 2 ? 'Уникат' : 'Същото' },
      }),
    ),
  );
  if (phase === 'PLAYING') return { roomId, players, roundId };
  await Promise.all(
    players.map((p) => p.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId })),
  );
  if (phase === 'RESULTS_READY') return { roomId, players, roundId };
  await Promise.all(players.map((p) => p.client.rpc('set_results_ready', { p_room_id: roomId })));
  if (phase === 'REVEAL') return { roomId, players, roundId };
  await shiftRound(roundId, ['reveal_at'], 30_000);
  await host.client.rpc('heartbeat', { p_room_id: roomId });
  roundId = (await gameState(host, roomId)).round!.id;
  return { roomId, players, roundId };
}

describe.skipIf(!hasLocalSupabase)('concurrency: duplicate and racing requests', () => {
  afterAll(async () => {
    await closeAllClients();
  });

  it(`final pre-round READY: one countdown, one letter (×${String(REPEAT)} rooms)`, async () => {
    await Promise.all(
      Array.from({ length: REPEAT }, async () => {
        const { roomId, players, roundId } = await roomIn('ROUND_WAITING');
        // Everyone at once, each player also double/triple-clicking.
        const results = await Promise.all(
          players.flatMap((p) =>
            Array.from({ length: 5 }, () => p.client.rpc('set_round_ready', { p_room_id: roomId })),
          ),
        );
        expect(results.map(errorCode).every((c) => c === 'ok')).toBe(true);
        const state = await gameState(players[0]!, roomId);
        expect(state.phase).toBe('COUNTDOWN');
        const row = await roundRow(roundId!);
        expect(row.letter).toMatch(/^[А-Я]$/);
        const admin = await localAdmin();
        const { count } = await admin
          .from('ready_checks')
          .select('*', { count: 'exact', head: true })
          .eq('round_id', roundId!);
        expect(count).toBe(3);
      }),
    );
  }, 120_000);

  it(`${String(SPAM)}× READY / lock / results-ready from one player are idempotent`, async () => {
    const { roomId, players, roundId } = await roomIn('PLAYING');
    const [p1, p2, p3] = players as [Player, Player, Player];
    const locks = await spam(SPAM, () =>
      p1.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId! }),
    );
    expect(locks.map(errorCode).every((c) => c === 'ok')).toBe(true);
    // The final two locks race: exactly one early-finish lock.
    const finals = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        p2.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId! }),
      ),
      ...Array.from({ length: 10 }, () =>
        p3.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId! }),
      ),
    ]);
    expect(finals.map(errorCode).every((c) => c === 'ok')).toBe(true);
    const locked = await roundRow(roundId!);
    expect(locked.locked_at).not.toBeNull();
    expect((await gameState(p1, roomId)).phase).toBe('RESULTS_READY');

    const ready = await Promise.all(
      players.flatMap((p) =>
        Array.from({ length: 17 }, () => p.client.rpc('set_results_ready', { p_room_id: roomId })),
      ),
    );
    expect(ready.map(errorCode).every((c) => c === 'ok')).toBe(true);
    const revealed = await roundRow(roundId!);
    expect(revealed.reveal_at).not.toBeNull();
    // reveal_at was set once: it does not move on further requests.
    await spam(10, () => p2.client.rpc('set_results_ready', { p_room_id: roomId }));
    expect((await roundRow(roundId!)).reveal_at).toBe(revealed.reveal_at);
  }, 60_000);

  it(`${String(SPAM)}× start_next_round → exactly one new round (×${String(REPEAT)} rooms)`, async () => {
    await Promise.all(
      Array.from({ length: REPEAT }, async () => {
        const { roomId, players } = await roomIn('RESULTS');
        const results = await spam(SPAM, () =>
          players[0]!.client.rpc('start_next_round', { p_room_id: roomId }),
        );
        const codes = results.map(errorCode);
        expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
        expect(
          codes.every((c) => ['ok', 'round_already_started', 'rate_limited'].includes(c)),
        ).toBe(true);
        const admin = await localAdmin();
        const { data } = await admin.from('rounds').select('round_number').eq('room_id', roomId);
        expect(data?.map((r) => r.round_number).sort()).toEqual([1, 2]);
      }),
    );
  }, 120_000);

  it(`${String(SPAM)} concurrent invalidation toggles leave a consistent, audited state`, async () => {
    const { roomId, players, roundId } = await roomIn('RESULTS');
    const [host, , unique] = players as [Player, Player, Player];
    const results = await Promise.all(
      Array.from({ length: SPAM }, (_, i) =>
        host.client.rpc('set_answer_invalidated', {
          p_room_id: roomId,
          p_round_id: roundId!,
          p_player_id: unique.id,
          p_category: 'country',
          p_invalidated: i % 2 === 0,
        }),
      ),
    );
    expect(results.map(errorCode).every((c) => c === 'ok')).toBe(true);
    const admin = await localAdmin();
    const { data: answer } = await admin
      .from('answers')
      .select('invalidated_at')
      .eq('round_id', roundId!)
      .eq('player_id', unique.id)
      .eq('category', 'country')
      .single();
    const { data: events } = await admin
      .from('answer_invalidation_events')
      .select('action')
      .eq('round_id', roundId!)
      .order('id'); // serialization order (concurrent rows share now())
    // Every recorded event is a real change: they strictly alternate.
    for (let i = 1; i < (events?.length ?? 0); i++) {
      expect(events![i]!.action).not.toBe(events![i - 1]!.action);
    }
    // The scoring agrees with the stored state.
    const { data: res } = await host.client.rpc('get_round_results', {
      p_room_id: roomId,
      p_round_id: roundId!,
    });
    const cell = (
      res as unknown as {
        players: { player_id: string; cells: { category: string; state: string }[] }[];
      }
    ).players
      .find((p) => p.player_id === unique.id)!
      .cells.find((c) => c.category === 'country')!;
    expect(cell.state).toBe(answer!.invalidated_at ? 'invalid' : 'unique');
  }, 60_000);

  it('rapid hidden/visible flapping keeps at most one open interval', async () => {
    const { roomId, players, roundId } = await roomIn('PLAYING');
    const p = players[1]!;
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        p.client.rpc('report_visibility', {
          p_room_id: roomId,
          p_round_id: roundId!,
          p_visible: i % 2 === 1,
        }),
      ),
    );
    const admin = await localAdmin();
    const { data } = await admin
      .from('visibility_events')
      .select('returned_at, away_at')
      .eq('round_id', roundId!)
      .eq('player_id', p.id);
    expect(data!.filter((e) => e.returned_at === null).length).toBeLessThanOrEqual(1);
    for (const e of data!) {
      if (e.returned_at)
        expect(Date.parse(e.returned_at)).toBeGreaterThanOrEqual(Date.parse(e.away_at));
    }
  }, 60_000);
});

describe.skipIf(!hasLocalSupabase)('host disappears in every phase', () => {
  afterAll(async () => {
    await closeAllClients();
  });

  for (const phase of [
    'LOBBY',
    'ROUND_WAITING',
    'COUNTDOWN',
    'PLAYING',
    'RESULTS_READY',
    'REVEAL',
    'RESULTS',
  ] as const) {
    it(`${phase}: deterministic new host, nothing else changes`, async () => {
      const { roomId, players, roundId } = await roomIn(phase);
      const [oldHost, next, third] = players as [Player, Player, Player];
      expect(await hostOf(roomId)).toBe(oldHost.id);
      const before = roundId ? await roundRow(roundId) : null;
      const beforePhase = (await gameState(next, roomId)).phase;

      // The host vanishes: no heartbeat for 60 s — past the 45 s host grace, before the
      // 2 min lobby seat expiry (simulated).
      const admin = await localAdmin();
      await admin
        .from('room_players')
        .update({ last_seen_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('room_id', roomId)
        .eq('player_id', oldHost.id);
      await Promise.all([next, third].map((p) => p.client.rpc('heartbeat', { p_room_id: roomId })));

      // Earliest connected member (join order) becomes the one and only host.
      expect(await hostOf(roomId)).toBe(next.id);

      if (before) {
        const after = await roundRow(roundId!);
        expect(after.id).toBe(before.id);
        expect(after.letter).toBe(before.letter);
        expect(after.started_at).toBe(before.started_at);
        expect(after.ends_at).toBe(before.ends_at);
        expect(after.reveal_at).toBe(before.reveal_at);
      }
      // The game did not restart.
      const nowPhase = (await gameState(next, roomId)).phase;
      if (phase === 'LOBBY') expect(nowPhase).toBe('LOBBY');
      else expect(nowPhase).not.toBe('LOBBY');
      expect(beforePhase === 'LOBBY').toBe(phase === 'LOBBY');

      // The old host returns: still a member, no longer host, no host powers.
      expect(errorCode(await oldHost.client.rpc('heartbeat', { p_room_id: roomId }))).toBe('ok');
      expect(await hostOf(roomId)).toBe(next.id);
      if (phase === 'LOBBY') {
        expect(errorCode(await oldHost.client.rpc('start_game', { p_room_id: roomId }))).toBe(
          'not_host',
        );
        expect(errorCode(await next.client.rpc('start_game', { p_room_id: roomId }))).toBe('ok');
      }
      if (phase === 'RESULTS') {
        expect(errorCode(await oldHost.client.rpc('start_next_round', { p_room_id: roomId }))).toBe(
          'not_host',
        );
        expect(errorCode(await next.client.rpc('start_next_round', { p_room_id: roomId }))).toBe(
          'ok',
        );
      }
    }, 60_000);
  }

  it('round 28 RESULTS: the new host can still finish the game; the old one cannot', async () => {
    const { roomId, players } = await roomIn('RESULTS');
    const [oldHost, next, third] = players as [Player, Player, Player];
    // Play rounds 2–28 quickly through the real RPCs.
    for (let round = 2; round <= 28; round++) {
      expect(errorCode(await oldHost.client.rpc('start_next_round', { p_room_id: roomId }))).toBe(
        'ok',
      );
      await Promise.all(players.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })));
      const roundId = (await gameState(oldHost, roomId)).round!.id;
      await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);
      await Promise.all(
        players.map((p) =>
          p.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
        ),
      );
      await Promise.all(
        players.map((p) => p.client.rpc('set_results_ready', { p_room_id: roomId })),
      );
      await shiftRound(roundId, ['reveal_at'], 30_000);
      await pollUntil(
        `round ${String(round)} results`,
        async () => {
          await oldHost.client.rpc('heartbeat', { p_room_id: roomId });
          return (await gameState(oldHost, roomId)).phase;
        },
        (p) => p === 'RESULTS',
        { timeoutMs: 5_000, intervalMs: 100 },
      );
    }
    const admin = await localAdmin();
    await admin
      .from('room_players')
      .update({ last_seen_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('room_id', roomId)
      .eq('player_id', oldHost.id);
    await Promise.all([next, third].map((p) => p.client.rpc('heartbeat', { p_room_id: roomId })));
    expect(await hostOf(roomId)).toBe(next.id);
    expect(errorCode(await oldHost.client.rpc('finish_game', { p_room_id: roomId }))).toBe(
      'not_host',
    );
    const finishes = await spam(SPAM, () => next.client.rpc('finish_game', { p_room_id: roomId }));
    expect(finishes.map(errorCode).every((c) => c === 'ok' || c === 'rate_limited')).toBe(true);
    expect((await gameState(third, roomId)).phase).toBe('FINISHED');
    expect(errorCode(await next.client.rpc('start_next_round', { p_room_id: roomId }))).toBe(
      'game_finished',
    );
    const { data } = await admin.from('rounds').select('letter').eq('room_id', roomId);
    expect(data).toHaveLength(28);
    expect(new Set(data!.map((r) => r.letter)).size).toBe(28);
  }, 240_000);
});
