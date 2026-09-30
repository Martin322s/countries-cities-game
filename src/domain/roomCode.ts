import { MAX_PLAYERS, MIN_PLAYERS } from './config';

/**
 * Join codes use uppercase Latin letters and digits, excluding look-alikes
 * (0/O, 1/I/L) so they are easy to read aloud and type on any keyboard layout.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const NON_CODE_CHARACTERS = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');

/** Uppercases and drops characters that can never be part of a code (spaces, dashes…). */
export function normalizeRoomCodeInput(raw: string): string {
  return raw.toUpperCase().replace(NON_CODE_CHARACTERS, '').slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/**
 * Generates a code. The server is authoritative (it must also guarantee uniqueness);
 * this helper defines the format. `randomInt(n)` must return an integer in [0, n).
 */
export function generateRoomCode(
  randomInt: (exclusiveMax: number) => number = (max) => Math.floor(Math.random() * max),
): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}

export function isValidRoomCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= MIN_PLAYERS && capacity <= MAX_PLAYERS;
}

export function clampRoomCapacity(capacity: number): number {
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(capacity)));
}
