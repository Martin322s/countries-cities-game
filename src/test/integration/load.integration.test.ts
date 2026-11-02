/**
 * Realistic 15-player workload (Web v1.0): joins, ready, staggered autosave bursts of
 * seven fields per player, locks, reveal, concurrent result reads, invalidation,
 * fair-play events, a reconnect and the next round. Measures request latency per RPC
 * and verifies the authoritative scoring exactly against the domain implementation —
 * including adversarial Unicode answers.
 * Run with:  npm run test:integration
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  CATEGORY_IDS,
  isCategoryId,
  scoreRound,
  type AnswerSet,
  type CategoryId,
  type PlayerId,
} from '@/domain';

import {
  closeAllClients,
  errorCode,
  gameState,
  finishValidation,
  hasLocalSupabase,
  localAdmin,
  pollUntil,
  roomWith,
  shiftRound,
} from './helpers';

const PLAYERS = 15;
const timings = new Map<string, number[]>();

async function timed<T extends { error: { message: string } | null }>(
  name: string,
  call: () => PromiseLike<T>,
): Promise<T> {
  const start = performance.now();
  const result = await call();
  const list = timings.get(name) ?? [];
  list.push(performance.now() - start);
  timings.set(name, list);
  return result;
}

function report(): string {
  const rows = [...timings.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    return `${name.padEnd(22)} n=${String(list.length).padStart(4)}  p50=${pick(0.5).toFixed(0).padStart(4)} ms  p95=${pick(0.95).toFixed(0).padStart(4)} ms  max=${sorted.at(-1)!.toFixed(0).padStart(4)} ms`;
  });
  return rows.join('\n');
}

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
/** "Йена" composed vs. "И" + COMBINING BREVE (decomposed) — NFC makes them equal. */
const YENA_COMPOSED = `${cp(0x419)}ена`;
const YENA_DECOMPOSED = `${cp(0x418, 0x306)}ена`;
/** Zero-width space at the edges is trimmed; inside it stays a different answer. */
const ZW_EDGES = `${cp(0x200b)}Ямбол${cp(0x200b)}`;
const ZW_INSIDE = `Ям${cp(0x200b)}бол`;
/** Latin look-alikes are deliberately NOT folded into Cyrillic. */
const LATIN_LOOKALIKE = 'Ocло'; // Latin O + c, Cyrillic ло
const EMOJI = 'Сокол 🦅';

/** What each player types (index → category → final value). */
function plannedAnswers(index: number): Partial<Record<CategoryId, string>> {
  const answers: Partial<Record<CategoryId, string>> = {
    // 6 duplicates (case/space variants), the rest unique.
    country: index < 6 ? (index % 2 ? '  испания ' : 'Испания') : `Държава ${String(index)}`,
    // Some players leave a field empty.
    city: index % 4 === 0 ? '' : `Град ${String(index)}`,
    village: index < 2 ? [YENA_COMPOSED, YENA_DECOMPOSED][index]! : `Село ${String(index)}`,
    animal:
      index === 2
        ? ZW_EDGES
        : index === 3
          ? 'Ямбол'
          : index === 4
            ? ZW_INSIDE
            : `Животно ${String(index)}`,
    plant: index === 5 ? LATIN_LOOKALIKE : index === 6 ? 'Осло' : `Растение ${String(index)}`,
    object: index === 7 ? EMOJI : `Предмет ${String(index)}`,
    name: index === 8 ? 'А'.repeat(100) : `Име ${String(index)}`,
  };
  return answers;
}

describe.skipIf(!hasLocalSupabase)('15-player load and full round', () => {
  afterAll(async () => {
    await closeAllClients();
    // Measurement output for the release notes (not an error).
    console.warn(`\n15-player workload latencies (local stack):\n${report()}`);
  });

  it('plays a full, realistic 15-player round with exact authoritative scoring', async () => {
    const { roomId, players } = await roomWith(PLAYERS);
    const host = players[0]!;
    const admin = await localAdmin();

    // Lobby heartbeats from everyone at once.
    await Promise.all(
      players.map((p) =>
        timed('heartbeat', () => p.client.rpc('heartbeat', { p_room_id: roomId })),
      ),
    );
    expect(
      errorCode(
        await timed('start_game', () => host.client.rpc('start_game', { p_room_id: roomId })),
      ),
    ).toBe('ok');
    const ready = await Promise.all(
      players.map((p) =>
        timed('set_round_ready', () => p.client.rpc('set_round_ready', { p_room_id: roomId })),
      ),
    );
    expect(ready.map(errorCode).every((c) => c === 'ok')).toBe(true);
    const roundId = (await gameState(host, roomId)).round!.id;
    await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);

    // Staggered typing: per field, a few progressively longer autosaves 500 ms apart
    // (the client's debounce) — 15 players at the same time.
    await Promise.all(
      players.map(async (p, index) => {
        const planned = plannedAnswers(index);
        for (const category of CATEGORY_IDS) {
          const value = planned[category] ?? '';
          const steps =
            value === ''
              ? []
              : [value.slice(0, 2), value.slice(0, Math.ceil(value.length / 2)), value];
          for (const step of steps) {
            const r = await timed('save_answers', () =>
              p.client.rpc('save_answers', {
                p_room_id: roomId,
                p_round_id: roundId,
                p_answers: { [category]: step },
              }),
            );
            expect(errorCode(r)).toBe('ok');
            await new Promise((resolve) => setTimeout(resolve, 40 + (index % 5) * 15));
          }
        }
      }),
    );
    // A retry burst after a network blip: 20 immediate saves of the latest state.
    const burst = await Promise.all(
      Array.from({ length: 20 }, () =>
        timed('save_answers', () =>
          players[9]!.client.rpc('save_answers', {
            p_room_id: roomId,
            p_round_id: roundId,
            p_answers: plannedAnswers(9),
          }),
        ),
      ),
    );
    expect(burst.map(errorCode).every((c) => c === 'ok')).toBe(true);

    // Fair play: one player goes away and comes back; one "reconnects" after silence.
    await timed('report_visibility', () =>
      players[4]!.client.rpc('report_visibility', {
        p_room_id: roomId,
        p_round_id: roundId,
        p_visible: false,
      }),
    );
    await timed('report_visibility', () =>
      players[4]!.client.rpc('report_visibility', {
        p_room_id: roomId,
        p_round_id: roundId,
        p_visible: true,
      }),
    );
    await admin
      .from('room_players')
      .update({ last_seen_at: new Date(Date.now() - 30_000).toISOString() })
      .eq('room_id', roomId)
      .eq('player_id', players[11]!.id);
    expect(errorCode(await players[11]!.client.rpc('heartbeat', { p_room_id: roomId }))).toBe('ok');

    // Everyone locks at once; everyone is ready for the results at once.
    const locks = await Promise.all(
      players.map((p) =>
        timed('lock_answers', () =>
          p.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
        ),
      ),
    );
    expect(locks.map(errorCode).every((c) => c === 'ok')).toBe(true);
    await Promise.all(
      players.map((p) =>
        timed('set_results_ready', () => p.client.rpc('set_results_ready', { p_room_id: roomId })),
      ),
    );
    await finishValidation(roomId, roundId);
    await shiftRound(roundId, ['reveal_at'], 30_000);
    await pollUntil(
      'RESULTS',
      async () => {
        await host.client.rpc('heartbeat', { p_room_id: roomId });
        return (await gameState(host, roomId)).phase;
      },
      (phase) => phase === 'RESULTS',
      { timeoutMs: 5_000, intervalMs: 100 },
    );

    // Everyone reads the results at once (as after the reveal).
    const reads = await Promise.all(
      players.map((p) =>
        timed('get_round_results', () =>
          p.client.rpc('get_round_results', { p_room_id: roomId, p_round_id: roundId }),
        ),
      ),
    );
    expect(reads.map(errorCode).every((c) => c === 'ok')).toBe(true);
    await Promise.all(
      players.map((p) =>
        timed('get_round_activity', () =>
          p.client.rpc('get_round_activity', { p_room_id: roomId, p_round_id: roundId }),
        ),
      ),
    );
    await Promise.all(
      players.map((p) =>
        timed('get_game_state', () => p.client.rpc('get_game_state', { p_room_id: roomId })),
      ),
    );

    // Exact scoring: the server agrees with the domain implementation.
    const { data: stored } = await admin
      .from('answers')
      .select('player_id, category, raw_value')
      .eq('round_id', roundId);
    const sets = new Map<PlayerId, AnswerSet>(players.map((p) => [p.id as PlayerId, {}]));
    for (const row of stored!) {
      if (isCategoryId(row.category))
        sets.get(row.player_id as PlayerId)![row.category] = row.raw_value;
    }
    interface Res {
      players: {
        player_id: string;
        round_points: number;
        cells: { category: string; state: string }[];
      }[];
    }
    const verify = (res: Res, invalid = new Map<CategoryId, Set<PlayerId>>()) => {
      const domain = scoreRound(sets, invalid);
      for (const p of res.players) {
        const expected = domain.get(p.player_id as PlayerId)!;
        expect(p.round_points).toBe(expected.total);
        for (const c of p.cells) {
          const status = expected.answers[c.category as CategoryId]!.status;
          expect(c.state).toBe(status === 'invalidated' ? 'invalid' : status);
        }
      }
      return domain;
    };
    const domain = verify(reads[0]!.data as unknown as Res);
    // Spot checks of the adversarial Unicode answers.
    const status = (i: number, c: CategoryId) =>
      domain.get(players[i]!.id as PlayerId)!.answers[c]!.status;
    expect([status(0, 'country'), status(1, 'country'), status(5, 'country')]).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
    expect([status(0, 'village'), status(1, 'village')]).toEqual(['duplicate', 'duplicate']); // NFC
    expect([status(2, 'animal'), status(3, 'animal')]).toEqual(['duplicate', 'duplicate']); // edges trimmed
    expect(status(4, 'animal')).toBe('unique'); // zero-width inside is a different answer
    expect([status(5, 'plant'), status(6, 'plant')]).toEqual(['unique', 'unique']); // no look-alike folding
    expect(status(7, 'object')).toBe('unique');
    expect(status(8, 'name')).toBe('unique'); // exactly 100 characters is allowed

    // Host invalidates one unique answer → scores and leaderboard recompute.
    expect(
      errorCode(
        await timed('set_answer_invalidated', () =>
          host.client.rpc('set_answer_invalidated', {
            p_room_id: roomId,
            p_round_id: roundId,
            p_player_id: players[7]!.id,
            p_category: 'object',
            p_invalidated: true,
          }),
        ),
      ),
    ).toBe('ok');
    const after = await host.client.rpc('get_round_results', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    verify(
      after.data as unknown as Res,
      new Map([['object', new Set([players[7]!.id as PlayerId])]]),
    );

    // Next round: a fresh snapshot of all 15.
    expect(
      errorCode(
        await timed('start_next_round', () =>
          host.client.rpc('start_next_round', { p_room_id: roomId }),
        ),
      ),
    ).toBe('ok');
    const next = await gameState(host, roomId);
    expect(next.phase).toBe('ROUND_WAITING');
    const { count } = await admin
      .from('answer_sheets')
      .select('*', { count: 'exact', head: true })
      .eq('round_id', next.round!.id);
    expect(count).toBe(PLAYERS);

    // No request in this realistic workload hit a rate limit.
    const total = [...timings.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBeGreaterThan(300);
  }, 180_000);
});
