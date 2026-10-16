/**
 * Fair-play visibility monitoring against the REAL local stack: RPC-only writes,
 * server timestamps, realtime delivery to members (and only members), the keepalive
 * REST path the browser uses, concurrency, and finalization at the round lock.
 * Only time is simulated (shiftRound).
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
  localAdmin,
  pollUntil,
  roomWith,
  shiftRound,
  supabaseKey,
  supabaseUrl,
  type Player,
} from './helpers';

interface ActivityEvent {
  id: number;
  player_id: string;
  source: string;
  away_at: string;
  returned_at: string | null;
  ended_by: string | null;
  cap_at: string | null;
}

async function activity(player: Player, roomId: string, roundId: string) {
  const { data, error } = await player.client.rpc('get_round_activity', {
    p_room_id: roomId,
    p_round_id: roundId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as { events: ActivityEvent[] }).events;
}

/** Room of three in effective PLAYING (countdown skipped by shifting the timeline). */
async function playingRoom() {
  const { roomId, players } = await roomWith(3);
  const [stoyan] = players as [Player, Player, Player];
  expect(errorCode(await stoyan.client.rpc('start_game', { p_room_id: roomId }))).toBe('ok');
  await Promise.all(players.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })));
  const roundId = (await gameState(stoyan, roomId)).round!.id;
  // Generous margin: the Docker VM clock can step after restarts (see README).
  await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);
  return { roomId, roundId, players: players as [Player, Player, Player] };
}

const report = (player: Player, roomId: string, roundId: string, visible: boolean) =>
  player.client.rpc('report_visibility', {
    p_room_id: roomId,
    p_round_id: roundId,
    p_visible: visible,
  });

describe.skipIf(!hasLocalSupabase)('fair-play visibility', () => {
  afterAll(async () => {
    await closeAllClients();
  });

  it('records away/return with server time and streams it to members only', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [stoyan, desi] = players;
    const outsider = await anonymousPlayer();

    const seen: { by: string; event: string }[] = [];
    const watch = async (player: Player, name: string) => {
      await player.client.realtime.setAuth();
      await new Promise<void>((resolve) => {
        player.client
          .channel(`room:${roomId}`, {
            config: { private: true, postgres_changes_options: { wait: true } },
          })
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'visibility_events',
              filter: `room_id=eq.${roomId}`,
            },
            (payload) => seen.push({ by: name, event: payload.eventType }),
          )
          .subscribe((status) => {
            if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve();
          });
        // A rejected (non-member) subscription never confirms; don't block on it.
        setTimeout(resolve, 5_000);
      });
    };
    await watch(stoyan, 'stoyan');
    await watch(outsider, 'outsider');

    const away = await report(desi, roomId, roundId, false);
    expect(errorCode(away)).toBe('ok');
    const stateBefore = await gameState(stoyan, roomId);
    const awayAt = Date.parse((away.data as { event: { away_at: string } }).event.away_at);
    // Server-assigned: within a few seconds of the server's own clock reading.
    expect(Math.abs(Date.parse(stateBefore.server_now) - awayAt)).toBeLessThan(5_000);

    await pollUntil(
      'Stoyan receives Desi going away',
      () => Promise.resolve(seen),
      (events) => events.some((e) => e.by === 'stoyan' && e.event === 'INSERT'),
      { timeoutMs: 10_000 },
    );

    const back = await report(desi, roomId, roundId, true);
    expect(errorCode(back)).toBe('ok');
    const event = (back.data as { event: { duration_ms: number } }).event;
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);

    await pollUntil(
      'Stoyan receives Desi returning',
      () => Promise.resolve(seen),
      (events) => events.some((e) => e.by === 'stoyan' && e.event === 'UPDATE'),
      { timeoutMs: 10_000 },
    );
    expect(seen.filter((e) => e.by === 'outsider')).toEqual([]);

    const events = await activity(stoyan, roomId, roundId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player_id: desi.id, ended_by: 'returned' });

    // Outsiders can neither read nor report.
    expect(
      errorCode(
        await outsider.client.rpc('get_round_activity', {
          p_room_id: roomId,
          p_round_id: roundId,
        }),
      ),
    ).toBe('not_member');
    expect(errorCode(await report(outsider, roomId, roundId, false))).toBe('not_member');
    const direct = await outsider.client.from('visibility_events').select('id');
    expect(direct.data).toEqual([]);
  }, 45_000);

  it('keeps one open interval under concurrent reports from several tabs', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [stoyan, desi] = players;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => report(desi, roomId, roundId, false)),
    );
    expect(results.map(errorCode).every((c) => c === 'ok')).toBe(true);
    const awayTimes = new Set(
      results.map((r) => (r.data as { event: { away_at: string } }).event.away_at),
    );
    expect(awayTimes.size).toBe(1);

    const returns = await Promise.all(
      Array.from({ length: 5 }, () => report(desi, roomId, roundId, true)),
    );
    expect(returns.map(errorCode).every((c) => c === 'ok')).toBe(true);
    expect(returns.filter((r) => (r.data as { event: unknown }).event !== null)).toHaveLength(1);
    expect(await activity(stoyan, roomId, roundId)).toHaveLength(1);
  });

  it('accepts the keepalive REST call the browser sends while hiding/unloading', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [stoyan, desi] = players;
    const { data } = await desi.client.auth.getSession();
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/report_visibility`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${data.session!.access_token}`,
      },
      body: JSON.stringify({
        p_room_id: roomId,
        p_round_id: roundId,
        p_visible: false,
        p_unloading: true,
      }),
    });
    expect(response.status).toBe(200);
    const events = await activity(stoyan, roomId, roundId);
    expect(events).toMatchObject([{ player_id: desi.id, source: 'unload', returned_at: null }]);
  });

  it('finalizes an open absence at the deadline and keeps it out of scoring', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [stoyan, desi, kaloyan] = players;
    for (const [player, country] of [
      [stoyan, 'Малта'],
      [desi, 'Малта'],
      [kaloyan, 'Мароко'],
    ] as const) {
      expect(
        errorCode(
          await player.client.rpc('save_answers', {
            p_room_id: roomId,
            p_round_id: roundId,
            p_answers: { country },
          }),
        ),
      ).toBe('ok');
    }
    // Kaloyan goes away and never comes back before the deadline.
    const away = await report(kaloyan, roomId, roundId, false);
    expect(errorCode(away)).toBe('ok');
    const awayAt = Date.parse((away.data as { event: { away_at: string } }).event.away_at);
    // The deadline passes 500 ms after she left (simulated time); the round locks on the
    // next request of anyone — nobody has to report anything for her.
    const admin = await localAdmin();
    const deadline = await admin
      .from('rounds')
      .update({ ends_at: new Date(awayAt + 500).toISOString() })
      .eq('id', roundId);
    expect(deadline.error).toBeNull();
    await pollUntil(
      'server time passes the simulated deadline',
      async () => (await gameState(stoyan, roomId)).server_now,
      (serverNow) => Date.parse(serverNow) > awayAt + 500,
      { timeoutMs: 5_000 },
    );
    await stoyan.client.rpc('heartbeat', { p_room_id: roomId });
    expect((await gameState(stoyan, roomId)).phase).toBe('RESULTS_READY');

    const [event] = await activity(stoyan, roomId, roundId);
    expect(event).toMatchObject({ player_id: kaloyan.id, ended_by: 'round_ended' });
    expect(Date.parse(event!.returned_at!)).toBe(awayAt + 500);
    expect(Date.parse(event!.returned_at!)).toBe(Date.parse(event!.cap_at!));
    // Coming back much later changes nothing, and no new away can start.
    expect((await report(kaloyan, roomId, roundId, true)).data).toMatchObject({ event: null });
    expect(errorCode(await report(kaloyan, roomId, roundId, false))).toBe('round_over');

    // Scoring is untouched: Kaloyan's unique answer still scores.
    await Promise.all(players.map((p) => p.client.rpc('set_results_ready', { p_room_id: roomId })));
    await shiftRound(roundId, ['reveal_at'], 30_000);
    await stoyan.client.rpc('heartbeat', { p_room_id: roomId });
    const { data: results } = await stoyan.client.rpc('get_round_results', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    const points = Object.fromEntries(
      (
        results as unknown as { players: { player_id: string; round_points: number }[] }
      ).players.map((p) => [p.player_id, p.round_points]),
    );
    expect(points).toEqual({ [stoyan.id]: 0, [desi.id]: 0, [kaloyan.id]: 1 });
  });
});
