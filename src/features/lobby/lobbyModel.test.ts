import { describe, expect, it } from 'vitest';

import type { PlayerId } from '@/domain';
import type { RoomMember } from '@/features/rooms/api/roomsApi';

import { buildLobbyPlayers } from './lobbyModel';

const now = Date.parse('2026-01-01T12:00:00Z');
const member = (id: string, name: string, lastSeenSecondsAgo: number): RoomMember => ({
  id: id as PlayerId,
  displayName: name,
  joinedAt: '2026-01-01T11:00:00Z',
  lastSeenAt: new Date(now - lastSeenSecondsAgo * 1000).toISOString(),
});

describe('buildLobbyPlayers', () => {
  const members = [member('a', 'Стоян', 3), member('b', 'Деси', 10), member('c', 'Иван', 300)];

  it('marks host and current player and keeps join order', () => {
    const players = buildLobbyPlayers({
      members,
      hostPlayerId: 'a' as PlayerId,
      currentPlayerId: 'b' as PlayerId,
      currentPlayerConnected: true,
      onlinePlayerIds: new Set(['a'] as PlayerId[]),
      now,
    });
    expect(players.map((p) => [p.displayName, p.isHost, p.isYou])).toEqual([
      ['Стоян', true, false],
      ['Деси', false, true],
      ['Иван', false, false],
    ]);
  });

  it('derives statuses from presence and heartbeat freshness', () => {
    const players = buildLobbyPlayers({
      members,
      hostPlayerId: 'a' as PlayerId,
      currentPlayerId: 'b' as PlayerId,
      currentPlayerConnected: false,
      onlinePlayerIds: new Set(['a'] as PlayerId[]),
      now,
    });
    expect(players.map((p) => p.status)).toEqual(['connected', 'reconnecting', 'disconnected']);
  });
});
