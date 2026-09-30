import { describe, expect, it } from 'vitest';

import { MAX_PLAYERS, MIN_PLAYERS } from './config';
import {
  clampRoomCapacity,
  generateRoomCode,
  isValidRoomCapacity,
  isValidRoomCode,
  normalizeRoomCodeInput,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './roomCode';

describe('room codes', () => {
  it('excludes ambiguous characters from the alphabet', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('generates valid codes', () => {
    for (let i = 0; i < 50; i++) expect(isValidRoomCode(generateRoomCode())).toBe(true);
  });

  it('normalizes user input to uppercase and drops separators', () => {
    expect(normalizeRoomCodeInput(' ab-c d7 ')).toBe('ABCD7');
    expect(normalizeRoomCodeInput('abcdefgh')).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('rejects wrong length and invalid characters', () => {
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode('ABCD0')).toBe(false);
    expect(isValidRoomCode('abcd7')).toBe(false);
    expect(isValidRoomCode('ABCD7')).toBe(true);
  });
});

describe('room capacity', () => {
  it(`accepts integers from ${MIN_PLAYERS} to ${MAX_PLAYERS}`, () => {
    expect(isValidRoomCapacity(MIN_PLAYERS)).toBe(true);
    expect(isValidRoomCapacity(MAX_PLAYERS)).toBe(true);
    expect(isValidRoomCapacity(MIN_PLAYERS - 1)).toBe(false);
    expect(isValidRoomCapacity(MAX_PLAYERS + 1)).toBe(false);
    expect(isValidRoomCapacity(4.5)).toBe(false);
  });

  it('clamps out-of-range values', () => {
    expect(clampRoomCapacity(0)).toBe(MIN_PLAYERS);
    expect(clampRoomCapacity(99)).toBe(MAX_PLAYERS);
  });
});
