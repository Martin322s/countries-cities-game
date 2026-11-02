/**
 * Round results against a REAL local Supabase stack: reveal timeline under
 * concurrency, server scoring cross-checked with the domain implementation,
 * host invalidation (incl. concurrent requests and realtime), REVEAL → RESULTS.
 * Run with:  npm run test:integration
 */
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CATEGORY_IDS, isCategoryId, scoreRound, type AnswerSet, type PlayerId } from '@/domain';

import {
  closeAllClients,
  errorCode,
  gameState,
  finishValidation,
  hasLocalSupabase,
  playRoundToResultsReady,
  pollUntil,
  roomWith,
  type Player,
} from './helpers';

interface CellShape {
  category: string;
  answer: string;
  state: string;
  points: number;
}
interface PlayerShape {
  player_id: string;
  round_points: number;
  total_points: number;
  cells: CellShape[];
}
interface ResultsShape {
  phase: string;
  round: { reveal_at: string };
  players: PlayerShape[];
}

const ANSWERS: Record<string, string>[] = [
  { country: 'Уникат', city: 'Монтана', animal: 'Мечка', plant: 'Мента' },
  { country: '', city: 'монтана', animal: 'Мечка', plant: 'Малина' },
  { country: 'Мароко', city: ' МОНТАНА ', animal: 'Мравка' },
];

describe.skipIf(!hasLocalSupabase)('round results against local Supabase', () => {
  let roomId = '';
  let roundId = '';
  let players: Player[] = [];
  let host: Player;
  let desi: Player;
  let kaloyan: Player;

  async function results(player: Player): Promise<ResultsShape> {
    const { data, error } = await player.client.rpc('get_round_results', { p_room_id: roomId });
    if (error) throw new Error(error.message);
    return data as unknown as ResultsShape;
  }
  const cell = (r: ResultsShape, player: Player, category: string) =>
    r.players.find((p) => p.player_id === player.id)!.cells.find((c) => c.category === category)!;
  const totals = (r: ResultsShape, player: Player) => {
    const p = r.players.find((x) => x.player_id === player.id)!;
    return [p.round_points, p.total_points];
  };
  const invalidate = (player: Player, target: Player, category: string, invalidated: boolean) =>
    player.client.rpc('set_answer_invalidated', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_player_id: target.id,
      p_category: category,
      p_invalidated: invalidated,
    });
  const revision = async () => {
    const { data } = await host.client
      .from('rooms')
      .select('results_revision')
      .eq('id', roomId)
      .single();
    return data?.results_revision ?? -1;
  };

  beforeAll(async () => {
    const room = await roomWith(3);
    roomId = room.roomId;
    players = room.players;
    [host, desi, kaloyan] = players as [Player, Player, Player];
    ({ roundId } = await playRoundToResultsReady(roomId, players, (_, index) => ANSWERS[index]!));
  }, 30_000);

  afterAll(async () => {
    await closeAllClients();
  });

  it('keeps results private until the reveal (host included)', async () => {
    expect((await gameState(host, roomId)).phase).toBe('RESULTS_READY');
    const early = await host.client.rpc('get_round_results', { p_room_id: roomId });
    expect(errorCode(early)).toBe('results_not_available');
    const others = await host.client.from('answers').select('player_id').neq('player_id', host.id);
    expect(others.data).toEqual([]);
  });

  it('establishes exactly one reveal timeline when everyone readies at once', async () => {
    const ready = await Promise.all(
      players.flatMap((p) => [
        p.client.rpc('set_results_ready', { p_room_id: roomId }),
        p.client.rpc('set_results_ready', { p_room_id: roomId }),
      ]),
    );
    expect(ready.map(errorCode).every((code) => code === 'ok')).toBe(true);

    expect((await gameState(players[0]!, roomId)).phase).toBe('AI_VALIDATING');
    await finishValidation(roomId, roundId);
    const states = await Promise.all(players.map((p) => gameState(p, roomId)));
    const revealAts = new Set(states.map((s) => s.round?.reveal_at));
    expect(states.map((s) => s.phase)).toEqual(['REVEAL', 'REVEAL', 'REVEAL']);
    expect(revealAts.size).toBe(1);
    expect([...revealAts][0]).not.toBeNull();
  });

  it('scores on the server exactly like the domain rules', async () => {
    const r = await results(desi);
    expect(r.players.map((p) => p.round_points)).toEqual([2, 1, 2]);
    expect(cell(r, host, 'city').state).toBe('duplicate');
    expect(cell(r, desi, 'city').answer).toBe('монтана');
    expect(cell(r, host, 'animal').state).toBe('duplicate');
    expect(cell(r, kaloyan, 'animal')).toMatchObject({ state: 'unique', points: 1 });
    expect(cell(r, desi, 'country').state).toBe('empty');
    expect(cell(r, host, 'name').state).toBe('empty');
    expect(r.players.every((p) => p.round_points <= 7)).toBe(true);

    // Cross-check: feed the revealed answers into the pure domain implementation.
    const { data: rows } = await desi.client
      .from('answers')
      .select('player_id, category, raw_value')
      .eq('round_id', roundId);
    const sets = new Map<PlayerId, AnswerSet>(players.map((p) => [p.id as PlayerId, {}]));
    for (const row of rows ?? []) {
      if (isCategoryId(row.category))
        sets.get(row.player_id as PlayerId)![row.category] = row.raw_value;
    }
    const domain = scoreRound(sets);
    for (const p of players) {
      expect(totals(r, p)[0]).toBe(domain.get(p.id as PlayerId)!.total);
      for (const category of CATEGORY_IDS) {
        const expected = domain.get(p.id as PlayerId)!.answers[category]!.status;
        expect(cell(r, p, category).state).toBe(expected);
      }
    }
  });

  it('lets only the current host invalidate, and every client learns about it in realtime', async () => {
    expect(errorCode(await invalidate(desi, host, 'animal', true))).toBe('not_host');

    // Kaloyan listens to room changes (results_revision bumps on every change).
    // Fails with the channel status history instead of a bare timeout.
    await kaloyan.client.realtime.setAuth();
    const statuses: string[] = [];
    let invalidation = 'not sent';
    const bumped = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `No results_revision event within 12 s. Channel: ${statuses.join(' → ')}; invalidate: ${invalidation}`,
          ),
        );
      }, 12_000);
      kaloyan.client
        .channel(`room:${roomId}`, {
          config: { private: true, postgres_changes_options: { wait: true } },
        })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
          (payload) => {
            const value = (payload.new as { results_revision: number }).results_revision;
            if (value > 0) {
              clearTimeout(timer);
              resolve(value);
            }
          },
        )
        .subscribe((status, err) => {
          statuses.push(err ? `${status}(${err.message})` : status);
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED && invalidation === 'not sent') {
            invalidation = 'pending';
            void invalidate(host, desi, 'animal', true).then((result) => {
              invalidation = errorCode(result);
            });
          }
        });
    });
    await expect(bumped).resolves.toBe(1);

    const r = await results(kaloyan);
    expect(cell(r, desi, 'animal')).toMatchObject({ state: 'invalid', points: 0 });
    expect(cell(r, host, 'animal')).toMatchObject({ state: 'unique', points: 1 });
    expect(totals(r, host)).toEqual([3, 3]);

    expect(errorCode(await invalidate(host, desi, 'animal', false))).toBe('ok');
    const restored = await results(kaloyan);
    expect(cell(restored, host, 'animal').state).toBe('duplicate');
    expect(cell(restored, desi, 'animal').state).toBe('duplicate');
    expect(totals(restored, host)).toEqual([2, 2]);
  }, 20_000);

  it('stays consistent under simultaneous invalidation requests', async () => {
    const before = await revision();
    const same = await Promise.all(
      Array.from({ length: 6 }, () => invalidate(host, kaloyan, 'city', true)),
    );
    expect(same.map(errorCode).every((code) => code === 'ok')).toBe(true);
    expect(await revision()).toBe(before + 1); // idempotent: one real change

    // Mixed concurrent requests on different cells.
    await Promise.all([
      invalidate(host, host, 'plant', true),
      invalidate(host, desi, 'plant', true),
      invalidate(host, host, 'plant', false),
      invalidate(host, kaloyan, 'city', false),
    ]);
    const r = await results(desi);
    const { data: rows } = await desi.client
      .from('answers')
      .select('player_id, category, invalidated_at')
      .eq('round_id', roundId);
    for (const row of rows ?? []) {
      const target = players.find((p) => p.id === row.player_id)!;
      const state = cell(r, target, row.category).state;
      if (row.invalidated_at) expect(state).toBe('invalid');
      else expect(state).not.toBe('invalid');
    }
    const sum = r.players.reduce((total, p) => total + p.round_points, 0);
    const cellSum = r.players.flatMap((p) => p.cells).reduce((total, c) => total + c.points, 0);
    expect(sum).toBe(cellSum);
  });

  it('rejects empty targets and answer edits during the results', async () => {
    expect(errorCode(await invalidate(host, desi, 'country', true))).toBe('answer_empty');
    const edit = await desi.client.rpc('save_answers', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_answers: { village: 'Ново' },
    });
    expect(errorCode(edit)).toBe('answers_locked');
  });

  it('moves to RESULTS on server time without changing the reveal timeline', async () => {
    const { round } = await results(host);
    const state = await pollUntil(
      'phase RESULTS after the 11 s reveal',
      async () => {
        await desi.client.rpc('heartbeat', { p_room_id: roomId });
        return gameState(desi, roomId);
      },
      (s) => s.phase === 'RESULTS',
      { timeoutMs: 16_000, intervalMs: 1_000 },
    );
    expect(state.round?.reveal_at).toBe(round.reveal_at);
    expect((await results(kaloyan)).phase).toBe('RESULTS');
  }, 25_000);
});
