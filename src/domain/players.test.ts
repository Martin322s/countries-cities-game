import { describe, expect, it } from 'vitest';

import type { PlayerId } from './ids';
import type { Player } from './models';
import {
  areAllActivePlayersReady,
  displayNameKey,
  isDisplayNameTaken,
  sanitizeDisplayName,
  selectNextHost,
  validateDisplayName,
} from './players';

function player(id: string, joinedAt: string, overrides: Partial<Player> = {}): Player {
  return {
    id: id as PlayerId,
    displayName: id,
    joinedAt,
    lastSeenAt: joinedAt,
    connectionStatus: 'connected',
    leftAt: null,
    ...overrides,
  };
}

const host = player('host', '2026-01-01T10:00:00Z');
const early = player('early', '2026-01-01T10:01:00Z');
const late = player('late', '2026-01-01T10:05:00Z');

describe('selectNextHost', () => {
  it('picks the earliest-joined active player other than the departing host', () => {
    expect(selectNextHost([late, host, early], host.id)).toBe('early');
  });

  it('prefers connected members and never picks members who left', () => {
    const players = [
      host,
      { ...early, connectionStatus: 'disconnected' as const },
      player('gone', '2026-01-01T10:02:00Z', { leftAt: '2026-01-01T10:03:00Z' }),
      late,
    ];
    expect(selectNextHost(players, host.id)).toBe('late');
  });

  it('treats a reconnecting member as connected (still within the heartbeat window)', () => {
    const players = [host, { ...early, connectionStatus: 'reconnecting' as const }, late];
    expect(selectNextHost(players, host.id)).toBe('early');
  });

  it('falls back to a disconnected member so the room always has a host', () => {
    const players = [host, { ...early, connectionStatus: 'disconnected' as const }];
    expect(selectNextHost(players, host.id)).toBe('early');
  });

  it('breaks join-time ties deterministically by id', () => {
    const b = player('b', '2026-01-01T10:01:00Z');
    const a = player('a', '2026-01-01T10:01:00Z');
    expect(selectNextHost([host, b, a], host.id)).toBe('a');
    expect(selectNextHost([host, a, b], host.id)).toBe('a');
  });

  it('returns null when nobody can take over', () => {
    expect(selectNextHost([host], host.id)).toBeNull();
    const left = player('left', '2026-01-01T10:01:00Z', { leftAt: '2026-01-01T10:02:00Z' });
    expect(selectNextHost([host, left], host.id)).toBeNull();
  });
});

describe('areAllActivePlayersReady', () => {
  it('requires every active player to be ready', () => {
    const players = [host, early, late];
    expect(areAllActivePlayersReady(players, new Set([host.id, early.id]))).toBe(false);
    expect(areAllActivePlayersReady(players, new Set([host.id, early.id, late.id]))).toBe(true);
  });

  it('ignores disconnected players', () => {
    const players = [host, { ...late, connectionStatus: 'disconnected' as const }];
    expect(areAllActivePlayersReady(players, new Set([host.id]))).toBe(true);
  });

  it('is false when there are no active players', () => {
    expect(areAllActivePlayersReady([], new Set())).toBe(false);
  });
});

describe('display names', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeDisplayName('  Деси   Петров ')).toBe('Деси Петров');
  });

  it('validates emptiness and length', () => {
    expect(validateDisplayName('   ')).toBe('empty');
    expect(validateDisplayName('Деси')).toBeNull();
    expect(validateDisplayName('Я'.repeat(20))).toBeNull();
    expect(validateDisplayName('  ' + 'Я'.repeat(20) + '  ')).toBeNull();
    expect(validateDisplayName('Я'.repeat(21))).toBe('too_long');
  });

  it('builds a case- and whitespace-insensitive key', () => {
    expect(displayNameKey('  ДЕСИ   Петров ')).toBe('деси петров');
    expect(displayNameKey('Йоана')).toBe(displayNameKey('ЙОАНА'));
  });

  it('detects duplicate active names case-insensitively', () => {
    const members = [
      player('a', '2026-01-01T10:00:00Z', { displayName: 'Стоян' }),
      player('b', '2026-01-01T10:00:00Z', {
        displayName: 'Деси',
        leftAt: '2026-01-01T10:05:00Z',
      }),
    ];
    expect(isDisplayNameTaken(' стоян ', members)).toBe(true);
    // A member who left frees their name.
    expect(isDisplayNameTaken('ДЕСИ', members)).toBe(false);
    // A player is never in conflict with themselves (rejoin).
    expect(isDisplayNameTaken('Стоян', members, 'a' as PlayerId)).toBe(false);
  });
});
