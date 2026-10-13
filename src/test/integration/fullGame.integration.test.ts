/**
 * An accelerated, complete 28-round game against the REAL local stack: real clients,
 * real RPCs and policies; only time is simulated (shiftRound) so the test does not
 * wait 28 × (3 s + 2 min + 11 s).
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

interface Standing {
  player_id: string;
  total_points: number;
  rounds_played: number;
}

describe.skipIf(!hasLocalSupabase)('a full 28-round game', () => {
  afterAll(async () => {
    await closeAllClients();
  });

  it('plays all 28 letters, freezes history, and finishes with authoritative standings', async () => {
    const { roomId, code, players } = await roomWith(3);
    const [stoyan, desi, kaloyan] = players as [Player, Player, Player];
    const admin = await localAdmin();
    const letters: string[] = [];

    const participantsOf = async (): Promise<Player[]> => {
      const state = (await stoyan.client.rpc('get_game_state', { p_room_id: roomId }))
        .data as unknown as {
        participants: { player_id: string }[];
      };
      return players.filter((p) => state.participants.some((x) => x.player_id === p.id));
    };

    /** ROUND_WAITING → RESULTS with the given answers. Returns the round id. */
    const playRound = async (answersOf: (p: Player) => Record<string, string>) => {
      const roundPlayers = await participantsOf();
      // Everyone ready at the same time → exactly one letter is drawn.
      const ready = await Promise.all(
        roundPlayers.map((p) => p.client.rpc('set_round_ready', { p_room_id: roomId })),
      );
      expect(ready.map(errorCode).every((c) => c === 'ok')).toBe(true);
      const countdown = await gameState(stoyan, roomId);
      expect(countdown.phase).toBe('COUNTDOWN');
      const roundId = countdown.round!.id;
      // Skip the countdown with a generous margin: right after `supabase db reset` the
      // Docker VM clock can step backwards by a second or more, which would otherwise
      // put "now" before started_at (observed as wrong_phase). Ends_at stays > 90 s ahead.
      await shiftRound(roundId, ['countdown_at', 'started_at', 'ends_at'], 30_000);

      for (const p of roundPlayers) {
        const saved = await p.client.rpc('save_answers', {
          p_room_id: roomId,
          p_round_id: roundId,
          p_answers: answersOf(p),
        });
        if (saved.error) {
          const diag = await gameState(stoyan, roomId);
          throw new Error(
            `save_answers failed: ${saved.error.message}; server_now=${diag.server_now}, ` +
              `started_at=${diag.round?.started_at ?? 'null'}`,
          );
        }
      }
      const locks = await Promise.all(
        roundPlayers.map((p) =>
          p.client.rpc('lock_answers', { p_room_id: roomId, p_round_id: roundId }),
        ),
      );
      expect(locks.map((r) => (r.error ? `${r.error.code}: ${r.error.message}` : 'ok'))).toEqual(
        roundPlayers.map(() => 'ok'),
      );
      const resultsReady = await Promise.all(
        roundPlayers.map((p) => p.client.rpc('set_results_ready', { p_room_id: roomId })),
      );
      expect(
        resultsReady.map((r) => (r.error ? `${r.error.code}: ${r.error.message}` : 'ok')),
      ).toEqual(roundPlayers.map(() => 'ok'));
      await shiftRound(roundId, ['reveal_at'], 30_000);
      const results = await pollUntil(
        'round reaches RESULTS',
        async () => {
          await stoyan.client.rpc('heartbeat', { p_room_id: roomId });
          return gameState(stoyan, roomId);
        },
        (s) => s.phase === 'RESULTS',
        { timeoutMs: 5_000, intervalMs: 100 },
      );
      letters.push(results.round!.letter!);
      return roundId;
    };

    const startNext = async (host: Player = stoyan) =>
      errorCode(await host.client.rpc('start_next_round', { p_room_id: roomId }));

    // Stoyan: unique every round (1 point). Desi and Kaloyan write the same → duplicate.
    const answers = (round: number) => (p: Player) =>
      p === stoyan ? { country: `Уникат ${round}` } : { country: 'Същото' };

    // ---- Round 1 -----------------------------------------------------------
    expect(errorCode(await stoyan.client.rpc('start_game', { p_room_id: roomId }))).toBe('ok');
    const round1 = await playRound(answers(1));

    // Kaloyan leaves before round 2 → not in its snapshot.
    expect(errorCode(await kaloyan.client.rpc('leave_room', { p_room_id: roomId }))).toBe('ok');

    // 10 simultaneous next-round requests → exactly one round 2.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        stoyan.client.rpc('start_next_round', { p_room_id: roomId }),
      ),
    );
    expect(attempts.map(errorCode).filter((c) => c === 'ok')).toHaveLength(1);
    expect(
      attempts
        .map(errorCode)
        .filter((c) => c !== 'ok')
        .every((c) => c === 'round_already_started'),
    ).toBe(true);
    const { data: rounds } = await admin
      .from('rounds')
      .select('round_number')
      .eq('room_id', roomId);
    expect(rounds?.map((r) => r.round_number).sort()).toEqual([1, 2]);

    // The previous round is frozen from now on.
    const frozen = await stoyan.client.rpc('set_answer_invalidated', {
      p_room_id: roomId,
      p_round_id: round1,
      p_player_id: stoyan.id,
      p_category: 'country',
      p_invalidated: true,
    });
    expect(errorCode(frozen)).toBe('round_not_active');

    // Kaloyan returns after the snapshot: member again, but sits out round 2.
    expect(
      errorCode(await kaloyan.client.rpc('join_room', { p_code: code, p_display_name: 'Калоян' })),
    ).toBe('ok');
    expect(errorCode(await kaloyan.client.rpc('set_round_ready', { p_room_id: roomId }))).toBe(
      'not_participant',
    );

    // Snapshots cannot be extended, even with privileged access.
    const state2 = await gameState(stoyan, roomId);
    const sneak = await admin
      .from('answer_sheets')
      .insert({ round_id: state2.round!.id, player_id: kaloyan.id, room_id: roomId });
    expect(sneak.error?.message).toMatch(/immutable/);

    // Round 2: with Kaloyan out, Desi's answer is unique.
    await playRound(answers(2));

    // ---- Rounds 3–27 ---------------------------------------------------------
    for (let round = 3; round <= 27; round++) {
      expect(await startNext()).toBe('ok');
      await playRound(answers(round));
    }
    const after27 = (await stoyan.client.rpc('get_game_state', { p_room_id: roomId }))
      .data as unknown as {
      progress: { letters_used: number; is_final_round: boolean };
    };
    expect(after27.progress.letters_used).toBe(27);
    expect(after27.progress.is_final_round).toBe(false);
    expect(errorCode(await stoyan.client.rpc('finish_game', { p_room_id: roomId }))).toBe(
      'letters_remaining',
    );

    // Exactly one letter remains, and round 28 draws it.
    const { data: used } = await admin.from('rounds').select('letter').eq('room_id', roomId);
    const eligible = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЮЯ'.split('');
    const remaining = eligible.filter((l) => !used?.some((r) => r.letter === l));
    expect(remaining).toHaveLength(1);

    // ---- Round 28 -----------------------------------------------------------
    expect(await startNext()).toBe('ok');
    await playRound(answers(28));
    expect(letters.at(-1)).toBe(remaining[0]);
    expect(new Set(letters).size).toBe(28);
    expect(letters.every((l) => eligible.includes(l))).toBe(true);

    expect(await startNext()).toBe('no_letters_left');
    expect((await gameState(stoyan, roomId)).phase).toBe('RESULTS');

    // ---- Finalization -----------------------------------------------------------
    expect(errorCode(await desi.client.rpc('finish_game', { p_room_id: roomId }))).toBe('not_host');
    const finishes = await Promise.all(
      Array.from({ length: 4 }, () => stoyan.client.rpc('finish_game', { p_room_id: roomId })),
    );
    expect(finishes.map(errorCode)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect((await gameState(desi, roomId)).phase).toBe('FINISHED');

    const summary = (await desi.client.rpc('get_game_summary', { p_room_id: roomId }))
      .data as unknown as {
      rounds_completed: number;
      standings: Standing[];
    };
    expect(summary.rounds_completed).toBe(28);
    const byPlayer = new Map(summary.standings.map((s) => [s.player_id, s]));
    // Stoyan: unique in all 28 rounds. Desi: unique only in round 2 (Kaloyan absent).
    expect(byPlayer.get(stoyan.id)).toMatchObject({ total_points: 28, rounds_played: 28 });
    expect(byPlayer.get(desi.id)).toMatchObject({ total_points: 1, rounds_played: 28 });
    expect(byPlayer.get(kaloyan.id)).toMatchObject({ total_points: 0, rounds_played: 27 });

    // ---- FINISHED is terminal ---------------------------------------------------
    const finalRound = (await gameState(stoyan, roomId)).round!.id;
    const blocked = await Promise.all([
      stoyan.client.rpc('set_answer_invalidated', {
        p_room_id: roomId,
        p_round_id: finalRound,
        p_player_id: stoyan.id,
        p_category: 'country',
        p_invalidated: true,
      }),
      desi.client.rpc('save_answers', {
        p_room_id: roomId,
        p_round_id: finalRound,
        p_answers: { city: 'Х' },
      }),
      desi.client.rpc('set_round_ready', { p_room_id: roomId }),
      desi.client.rpc('set_results_ready', { p_room_id: roomId }),
      stoyan.client.rpc('start_next_round', { p_room_id: roomId }),
    ]);
    expect(blocked.map(errorCode)).toEqual([
      'results_not_available',
      'answers_locked',
      'game_finished',
      'game_finished',
      'game_finished',
    ]);

    // History stays readable for members.
    const history = await kaloyan.client.rpc('get_round_results', {
      p_room_id: roomId,
      p_round_id: round1,
    });
    expect(errorCode(history)).toBe('ok');
  }, 180_000);
});
