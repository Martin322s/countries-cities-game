import { DISPLAY_NAME_MAX_LENGTH } from './config';
import type { PlayerId } from './ids';
import type { Player } from './models';

/** A player counts toward ready checks while they have not left and are not disconnected. */
export function isActivePlayer(player: Player): boolean {
  return player.leftAt === null && player.connectionStatus !== 'disconnected';
}

/**
 * True when every active player is in `readyPlayerIds`.
 * Returns false when there are no active players, so an empty room never auto-advances.
 */
export function areAllActivePlayersReady(
  players: readonly Player[],
  readyPlayerIds: ReadonlySet<PlayerId>,
): boolean {
  const active = players.filter(isActivePlayer);
  return active.length > 0 && active.every((player) => readyPlayerIds.has(player.id));
}

function compareForHostElection(a: Player, b: Player): number {
  const aConnected = a.connectionStatus !== 'disconnected';
  const bConnected = b.connectionStatus !== 'disconnected';
  if (aConnected !== bConnected) return aConnected ? -1 : 1;
  const byJoinTime = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
  if (byJoinTime !== 0) return byJoinTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Deterministic host election. Mirrors `elect_room_host` in the database, which is the
 * authority — this function exists so the rule is documented, tested and reusable.
 *
 * Among members who have not left (excluding the outgoing host):
 *   1. connected members before disconnected ones
 *   2. earliest `joinedAt`
 *   3. lowest player id (stable tie-break; matches Postgres uuid ordering)
 */
export function selectNextHost(
  players: readonly Player[],
  departingHostId: PlayerId,
): PlayerId | null {
  const candidates = players
    .filter((player) => player.id !== departingHostId && player.leftAt === null)
    .sort(compareForHostElection);
  return candidates[0]?.id ?? null;
}

export type DisplayNameError = 'empty' | 'too_long';

/** Canonical form stored by the server: NFC, whitespace collapsed, trimmed. */
export function sanitizeDisplayName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * Case-insensitive identity of a display name within a room.
 * Mirrors `display_name_key` in the database.
 */
export function displayNameKey(raw: string): string {
  return sanitizeDisplayName(raw).toLocaleLowerCase('bg-BG');
}

/** True when an active member other than `exceptPlayerId` already uses this name. */
export function isDisplayNameTaken(
  name: string,
  members: readonly Pick<Player, 'id' | 'displayName' | 'leftAt'>[],
  exceptPlayerId?: PlayerId,
): boolean {
  const key = displayNameKey(name);
  return members.some(
    (member) =>
      member.leftAt === null &&
      member.id !== exceptPlayerId &&
      displayNameKey(member.displayName) === key,
  );
}

/**
 * Length in Unicode code points — identical to Postgres `char_length`, so the client
 * check and the database CHECK constraint can never disagree.
 */
function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function validateDisplayName(raw: string): DisplayNameError | null {
  const name = sanitizeDisplayName(raw);
  if (name.length === 0) return 'empty';
  if (codePointLength(name) > DISPLAY_NAME_MAX_LENGTH) return 'too_long';
  return null;
}
