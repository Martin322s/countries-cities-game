import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
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
} from './helpers';

async function playingRoom() {
  const room = await roomWith(3);
  const host = room.players[0]!;
  expect(errorCode(await host.client.rpc('start_game', { p_room_id: room.roomId }))).toBe('ok');
  await Promise.all(
    room.players.map((p) => p.client.rpc('set_round_ready', { p_room_id: room.roomId })),
  );
  const roundId = (await gameState(host, room.roomId)).round!.id;
  const admin = await localAdmin();
  const { data } = await admin
    .from('rounds')
    .select('started_at, ends_at')
    .eq('id', roundId)
    .single();
  expect(Date.parse(data!.ends_at!) - Date.parse(data!.started_at!)).toBe(60_000);
  await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 10_000);
  expect((await gameState(host, room.roomId)).phase).toBe('PLAYING');
  return { ...room, roundId };
}

describe.skipIf(!hasLocalSupabase)('STOP / READY multiplayer controls', () => {
  afterAll(closeAllClients);

  it('serializes simultaneous STOP, streams STOP and READY, and reveals only after everyone readies', async () => {
    const { roomId, roundId, players } = await playingRoom();
    const host = players[0]!;
    const changes: string[] = [];
    await host.client.realtime.setAuth();
    const channel = host.client
      .channel(`room:${roomId}`, {
        config: { private: true, postgres_changes_options: { wait: true } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        () => changes.push('phase'),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ready_checks',
          filter: `room_id=eq.${roomId}`,
        },
        () => changes.push('ready'),
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
      const stopped = await Promise.all(
        players.map((p) =>
          p.client.rpc('lock_answers', {
            p_room_id: roomId,
            p_round_id: roundId,
          }),
        ),
      );
      expect(stopped.map(errorCode)).toEqual(['ok', 'ok', 'ok']);
      const original = await host.client
        .from('rounds')
        .select('locked_at, lock_reason')
        .eq('id', roundId)
        .single();
      expect(original.data?.lock_reason).toBe('stop');
      for (const player of players) {
        expect((await gameState(player, roomId)).phase).toBe('RESULTS_READY');
        expect(
          errorCode(
            await player.client.rpc('save_answers', {
              p_room_id: roomId,
              p_round_id: roundId,
              p_answers: { city: 'Late' },
            }),
          ),
        ).toBe('answers_locked');
      }
      await host.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId });
      expect(
        (await host.client.from('rounds').select('locked_at').eq('id', roundId).single()).data
          ?.locked_at,
      ).toBe(original.data?.locked_at);
      await pollUntil(
        'STOP streamed',
        () => Promise.resolve(changes),
        (c) => c.includes('phase'),
      );
      await host.client.rpc('set_results_ready', { p_room_id: roomId });
      expect((await gameState(host, roomId)).phase).toBe('RESULTS_READY');
      await pollUntil(
        'READY streamed',
        () => Promise.resolve(changes),
        (c) => c.includes('ready'),
      );
      const ready = await Promise.all(
        players
          .slice(1)
          .flatMap((p) => [
            p.client.rpc('set_results_ready', { p_room_id: roomId }),
            p.client.rpc('set_results_ready', { p_room_id: roomId }),
          ]),
      );
      expect(ready.map(errorCode)).toEqual(['ok', 'ok', 'ok', 'ok']);
      const revealed = await gameState(host, roomId);
      expect(revealed.phase).toBe('REVEAL');
      await host.client.rpc('set_results_ready', { p_room_id: roomId });
      expect((await gameState(host, roomId)).round?.reveal_at).toBe(revealed.round?.reveal_at);
    } finally {
      await host.client.removeChannel(channel);
    }
  }, 30_000);

  it('timeout racing STOP retains deadline and waits for READY', async () => {
    const { roomId, roundId, players } = await playingRoom();
    await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 60_000);
    const results = await Promise.all([
      players[0]!.client.rpc('heartbeat', { p_room_id: roomId }),
      players[1]!.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
    ]);
    expect(results.map(errorCode)).toEqual(['ok', 'ok']);
    expect((await gameState(players[0]!, roomId)).phase).toBe('RESULTS_READY');
    const round = await players[0]!.client
      .from('rounds')
      .select('locked_at, ends_at, lock_reason')
      .eq('id', roundId)
      .single();
    expect(round.data?.lock_reason).toBe('timeout');
    expect(round.data?.locked_at).toBe(round.data?.ends_at);
  });

  it('a disconnected participant is required on reconnect, then stops blocking when stale', async () => {
    const { roomId, code, roundId, players } = await playingRoom();
    const [host, guest, disconnected] = players;
    await host!.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId });
    await host!.client.rpc('set_results_ready', { p_room_id: roomId });
    await disconnected!.client.rpc('join_room', { p_code: code, p_display_name: 'Reconnected' });
    await guest!.client.rpc('set_results_ready', { p_room_id: roomId });
    expect((await gameState(host!, roomId)).phase).toBe('RESULTS_READY');
    const admin = await localAdmin();
    const serverNow = Date.parse((await gameState(host!, roomId)).server_now);
    await admin
      .from('room_players')
      .update({ last_seen_at: new Date(serverNow - 46_000).toISOString() })
      .eq('room_id', roomId)
      .eq('player_id', disconnected!.id);
    await host!.client.rpc('heartbeat', { p_room_id: roomId });
    expect((await gameState(host!, roomId)).phase).toBe('REVEAL');
  });
});
