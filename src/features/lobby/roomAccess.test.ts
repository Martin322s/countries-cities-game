import { describe, expect, it } from 'vitest';

import type { PlayerId, RoomId } from '@/domain';
import type { AuthState } from '@/features/auth/authContext';
import { RoomError } from '@/features/rooms/api/roomErrors';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';

import { resolveRoomAccess } from './roomAccess';

const ready: AuthState = { status: 'ready', playerId: 'me' as PlayerId };
const room: RoomSummary = {
  id: 'room-1' as RoomId,
  code: 'K7M4Q',
  capacity: 8,
  hostPlayerId: 'me' as PlayerId,
  phase: 'LOBBY',
};

describe('resolveRoomAccess', () => {
  it('rejects malformed codes before anything else', () => {
    expect(
      resolveRoomAccess({ codeValid: false, auth: ready, room: { data: room, error: null } }),
    ).toEqual({ kind: 'invalid_code' });
  });

  it('waits for the anonymous identity', () => {
    expect(
      resolveRoomAccess({
        codeValid: true,
        auth: { status: 'loading' },
        room: { data: undefined, error: null },
      }).kind,
    ).toBe('identity_loading');
  });

  it('surfaces identity failures', () => {
    expect(
      resolveRoomAccess({
        codeValid: true,
        auth: { status: 'error', kind: 'sign_in_failed' },
        room: { data: undefined, error: null },
      }),
    ).toEqual({ kind: 'identity_error', reason: 'sign_in_failed' });
  });

  it('restores the lobby for an existing member (refresh / deep link)', () => {
    expect(
      resolveRoomAccess({ codeValid: true, auth: ready, room: { data: room, error: null } }),
    ).toEqual({ kind: 'member', room });
  });

  it('offers joining when the player is not a member', () => {
    expect(
      resolveRoomAccess({ codeValid: true, auth: ready, room: { data: null, error: null } }).kind,
    ).toBe('not_member');
  });

  it('keeps a member in the lobby when a background refetch fails', () => {
    expect(
      resolveRoomAccess({
        codeValid: true,
        auth: ready,
        room: { data: room, error: new RoomError('network') },
      }).kind,
    ).toBe('member');
  });

  it('reports an error when membership could not be determined at all', () => {
    expect(
      resolveRoomAccess({
        codeValid: true,
        auth: ready,
        room: { data: undefined, error: new RoomError('network') },
      }),
    ).toEqual({ kind: 'error', code: 'network' });
  });

  it('is loading while the first membership check is in flight', () => {
    expect(
      resolveRoomAccess({ codeValid: true, auth: ready, room: { data: undefined, error: null } })
        .kind,
    ).toBe('loading');
  });
});
