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
  pollUntil,
  roomWith,
  shiftRound,
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

describe.skipIf(!hasLocalSupabase)('permanent per-round visibility locks', () => {
  afterAll(closeAllClients);

  it('streams player locks to members and rejects future edits after return', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [host, player] = players;
    const outsider = await anonymousPlayer();
    const changes: string[] = [];
    await host.client.realtime.setAuth();
    const channel = host.client
      .channel('room:' + roomId, {
        config: { private: true, postgres_changes_options: { wait: true } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'answer_sheets',
          filter: 'room_id=eq.' + roomId,
        },
        () => changes.push('lock'),
      );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Realtime subscription timed out'));
      }, 10_000);
      channel.subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    try {
      const result = await player.client.rpc('report_visibility', {
        p_room_id: roomId,
        p_round_id: roundId,
        p_visible: false,
        p_answers: { city: 'Snapshot' },
      });
      expect(errorCode(result)).toBe('ok');
      const before = await gameState(host, roomId);
      expect(before.phase).toBe('PLAYING');
      await pollUntil(
        'lock streamed to member',
        () => Promise.resolve(changes),
        (events) => events.length > 0,
      );
      expect(errorCode(await report(player, roomId, roundId, true))).toBe('ok');
      expect(
        errorCode(
          await player.client.rpc('save_answers', {
            p_room_id: roomId,
            p_round_id: roundId,
            p_answers: { city: 'Changed' },
          }),
        ),
      ).toBe('answers_locked');
      const answers = await player.client
        .from('answers')
        .select('raw_value')
        .eq('round_id', roundId);
      expect(answers.data).toEqual([{ raw_value: 'Snapshot' }]);
      expect(await activity(host, roomId, roundId)).toMatchObject([
        { player_id: player.id, ended_by: 'answers_locked' },
      ]);
      expect(errorCode(await report(outsider, roomId, roundId, false))).toBe('not_member');
      expect((await outsider.client.from('visibility_events').select('id')).data).toEqual([]);
    } finally {
      await host.client.removeChannel(channel);
    }
  }, 30_000);

  it('concurrent reports persist one lock and preserve the first snapshot', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [host, player] = players;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => report(player, roomId, roundId, false)),
    );
    expect(results.map(errorCode)).toEqual(Array(10).fill('ok'));
    expect(await activity(host, roomId, roundId)).toHaveLength(1);
    expect(errorCode(await report(player, roomId, roundId, true))).toBe('ok');
    expect(
      errorCode(
        await player.client.rpc('save_answers', {
          p_room_id: roomId,
          p_round_id: roundId,
          p_answers: { city: 'Late' },
        }),
      ),
    ).toBe('answers_locked');
  });

  it('STOP racing tab exit never accepts later writes or skips READY', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const [host, player] = players;
    const results = await Promise.all([
      host.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
      report(player, roomId, roundId, false),
    ]);
    expect(results.map(errorCode)).toEqual(['ok', 'ok']);
    expect((await gameState(host, roomId)).phase).toBe('RESULTS_READY');
    expect(
      errorCode(
        await player.client.rpc('save_answers', {
          p_room_id: roomId,
          p_round_id: roundId,
          p_answers: { city: 'Late' },
        }),
      ),
    ).toBe('answers_locked');
  });
});
