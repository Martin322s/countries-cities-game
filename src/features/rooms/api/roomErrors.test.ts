import { describe, expect, it } from 'vitest';

import {
  RoomError,
  roomErrorMessage,
  SERVER_ROOM_ERROR_CODES,
  toRoomError,
  type RoomErrorCode,
} from './roomErrors';

const appError = (message: string) => ({
  message,
  hint: 'app_error',
  code: 'P0001',
  details: null,
});

describe('toRoomError', () => {
  it.each(SERVER_ROOM_ERROR_CODES)('maps the server code %s', (code) => {
    expect(toRoomError(appError(code)).code).toBe(code);
  });

  it('ignores server messages that are not on the whitelist', () => {
    expect(toRoomError(appError('drop table rooms')).code).toBe('unknown');
  });

  it('does not trust a known code without the app_error marker', () => {
    expect(toRoomError({ message: 'room_full', hint: null, code: 'P0001' }).code).toBe('unknown');
  });

  it('classifies raw database errors as unknown', () => {
    expect(
      toRoomError({ message: 'permission denied for table rooms', code: '42501', hint: null }).code,
    ).toBe('unknown');
  });

  it('classifies fetch failures as network errors', () => {
    expect(toRoomError(new TypeError('Failed to fetch')).code).toBe('network');
    expect(toRoomError({ message: 'TypeError: Failed to fetch', code: '', hint: '' }).code).toBe(
      'network',
    );
    expect(toRoomError({ name: 'AuthRetryableFetchError', message: 'x' }).code).toBe('network');
  });

  it('passes RoomError through unchanged', () => {
    const error = new RoomError('room_full');
    expect(toRoomError(error)).toBe(error);
  });
});

describe('roomErrorMessage', () => {
  const allCodes: RoomErrorCode[] = [...SERVER_ROOM_ERROR_CODES, 'network', 'unknown'];

  it('has Bulgarian copy for every code and operation', () => {
    for (const code of allCodes) {
      for (const operation of [
        'create',
        'join',
        'leave',
        'start',
        'ready',
        'answers',
        'results',
        'invalidate',
        'next_round',
        'finish',
      ] as const) {
        const message = roomErrorMessage(code, operation);
        expect(message.length).toBeGreaterThan(0);
        expect(message).toMatch(/\p{Script=Cyrillic}/u);
      }
    }
  });

  it('uses the expected copy for common join failures', () => {
    expect(roomErrorMessage('room_full', 'join')).toBe('Стаята е пълна.');
    expect(roomErrorMessage('room_not_found', 'join')).toMatch(/^Стаята не съществува/);
    expect(roomErrorMessage('display_name_taken', 'join')).toMatch(/^Това име вече се използва/);
    expect(roomErrorMessage('game_in_progress', 'join')).toMatch(/^Играта вече е започнала/);
    expect(roomErrorMessage('unknown', 'create')).toMatch(/^Неуспешно създаване на стаята/);
  });

  it('explains a lost host role in terms of the action that was attempted', () => {
    expect(roomErrorMessage('not_host', 'start')).toBe('Само хостът може да започне играта.');
    expect(roomErrorMessage('not_host', 'next_round')).toBe(
      'Само хостът може да започне нов рунд.',
    );
    expect(roomErrorMessage('not_host', 'finish')).toMatch(/крайното класиране/);
    expect(roomErrorMessage('not_host', 'invalidate')).toMatch(/валидността/);
  });

  it('asks for connected players before a next round, not for a game start', () => {
    expect(roomErrorMessage('not_enough_players', 'next_round')).toMatch(
      /свързани играчи за нов рунд/,
    );
    expect(roomErrorMessage('not_enough_players', 'start')).toMatch(/за да започне играта/);
  });

  it('never exposes database internals', () => {
    for (const code of allCodes) {
      const message = roomErrorMessage(code, 'answers');
      expect(message).not.toMatch(/postgres|supabase|sql|rpc|error|null|undefined/i);
    }
  });
});
