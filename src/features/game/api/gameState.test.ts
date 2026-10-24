import { describe, expect, it } from 'vitest';

import { RoomError } from '@/features/rooms/api/roomErrors';

import { parseGameState } from './gameState';

const raw = {
  server_now: '2026-01-01T12:00:05.250Z',
  phase: 'PLAYING',
  progress: {
    total_rounds: 28,
    letters_used: 1,
    rounds_completed: 0,
    is_final_round: false,
    eligible_players: 1,
  },
  revealed_rounds: [],
  round: {
    id: 'round-1',
    number: 1,
    letter: 'М',
    countdown_at: '2026-01-01T12:00:00Z',
    started_at: '2026-01-01T12:00:03Z',
    ends_at: '2026-01-01T12:01:03Z',
    locked_at: null,
    lock_reason: null,
  },
  participants: [
    {
      player_id: 'p1',
      display_name: 'Стоян',
      joined_at: '2026-01-01T11:00:00Z',
      last_seen_at: '2026-01-01T12:00:01Z',
      left: false,
      round_ready: true,
      answers_locked_at: null,
      answers_lock_reason: null,
      results_ready: false,
    },
  ],
};

describe('parseGameState', () => {
  it('accepts synchronized STOP and tab-exit lock reasons', () => {
    const state = parseGameState({
      ...raw,
      phase: 'RESULTS_READY',
      round: { ...raw.round, lock_reason: 'stop', locked_at: raw.server_now },
      participants: [
        {
          ...raw.participants[0],
          answers_lock_reason: 'tab_exit',
          answers_locked_at: raw.server_now,
        },
      ],
    });
    expect(state.round?.lockReason).toBe('stop');
    expect(state.participants[0]?.answersLockReason).toBe('tab_exit');
  });
  it('parses the server read model into typed values', () => {
    const state = parseGameState(raw);
    expect(state.phase).toBe('PLAYING');
    expect(state.serverNow).toBe(Date.parse('2026-01-01T12:00:05.250Z'));
    expect(state.round?.letter).toBe('М');
    const timeline = state.round!.timeline;
    expect(timeline.endsAt! - timeline.startedAt!).toBe(60_000);
    expect(state.participants[0]).toMatchObject({ displayName: 'Стоян', roundReady: true });
  });

  it('accepts a hidden letter during the countdown and a game without a round', () => {
    expect(
      parseGameState({ ...raw, round: { ...raw.round, letter: null } }).round?.letter,
    ).toBeNull();
    expect(
      parseGameState({ ...raw, phase: 'LOBBY', round: null, participants: [] }).round,
    ).toBeNull();
  });

  it('rejects ineligible letters and unknown phases', () => {
    expect(() => parseGameState({ ...raw, round: { ...raw.round, letter: 'Ъ' } })).toThrow(
      RoomError,
    );
    expect(() => parseGameState({ ...raw, phase: 'HACKED' })).toThrow(RoomError);
    expect(() => parseGameState(null)).toThrow(RoomError);
  });
});
