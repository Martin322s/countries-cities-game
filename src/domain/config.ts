/**
 * Global game limits. These are product rules — change them deliberately,
 * and keep the database CHECK constraints in `supabase/migrations` in sync.
 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 15;

/** Hard upper bound for the answering phase of a single round. */
export const ROUND_DURATION_MS = 90 * 1000;

/**
 * Length of the "get ready" countdown shown before the letter is revealed.
 * The product spec only says "short"; this value is a tunable UX default.
 */
export const PRE_ROUND_COUNTDOWN_MS = 3_000;

/** Display-name limits for players joining a room. */
export const DISPLAY_NAME_MAX_LENGTH = 20;

/*
 * Membership liveness. Mirrored by SQL functions in supabase/migrations
 * (member_stale_after, lobby_seat_expiry) — the server values are authoritative.
 */

/** How often a connected client sends a server heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * A member without a heartbeat for this long counts as disconnected.
 * This is also the host's grace period before the role migrates.
 */
export const MEMBER_STALE_AFTER_MS = 45_000;

/** In the lobby, a member silent for this long loses their seat. */
export const LOBBY_SEAT_EXPIRY_MS = 2 * 60_000;

/** Maximum stored answer length (code points), mirrored by the database. */
export const ANSWER_MAX_LENGTH = 100;
