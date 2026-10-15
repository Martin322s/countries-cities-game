import type { PlayerId } from './ids';
import type { RoundStage } from './round';

/**
 * Fair-play visibility activity — informational only.
 *
 * An away interval says that a player's game page was hidden (another tab or app, a
 * locked phone…) during their answering window. It never says why, never affects
 * scores, and the server assigns every timestamp. These pure rules decide what the
 * UI shows; browser APIs live in features/game/activity.
 */

/** Absences shorter than this are kept but not shown (accidental switches, OS UI). */
export const MEANINGFUL_AWAY_MS = 2_000;

/**
 * Display grace for an away caused by the page unloading (refresh, close). A refresh
 * reports "away" while unloading and "visible" as soon as the game is back, so a
 * normal reload stays well below this and is not shown as leaving the game.
 */
export const UNLOAD_GRACE_MS = 5_000;

export type AwaySource = 'visibility' | 'unload';
export type AwayEndReason = 'returned' | 'round_ended' | 'answers_locked';

export interface AwayInterval {
  id: number;
  playerId: PlayerId;
  source: AwaySource;
  /** Server time the page was reported hidden (epoch ms). */
  awayAt: number;
  /** Server time it ended — null while still away. Already clamped by the server. */
  returnedAt: number | null;
  endedBy: AwayEndReason | null;
  /** End of the player's answering window: an open interval can never last longer. */
  capAt: number | null;
}

export function displayThresholdMs(interval: Pick<AwayInterval, 'source'>): number {
  return interval.source === 'unload' ? UNLOAD_GRACE_MS : MEANINGFUL_AWAY_MS;
}

/** End of the interval as of `now`: its return, or now — never past the cap. */
export function intervalEnd(interval: AwayInterval, now: number): number {
  const end =
    interval.returnedAt ?? (interval.capAt === null ? now : Math.min(now, interval.capAt));
  return Math.max(interval.awayAt, end);
}

export function intervalDurationMs(interval: AwayInterval, now: number): number {
  return intervalEnd(interval, now) - interval.awayAt;
}

/** Still away right now (not returned and the answering window is still open). */
export function isOpen(interval: AwayInterval, now: number): boolean {
  return interval.returnedAt === null && (interval.capAt === null || now < interval.capAt);
}

export function isMeaningful(interval: AwayInterval, now: number): boolean {
  return intervalDurationMs(interval, now) >= displayThresholdMs(interval);
}

export interface PlayerActivity {
  playerId: PlayerId;
  /** Meaningful absences (completed or ongoing). */
  count: number;
  /** Total duration of the meaningful absences, ongoing one included. */
  totalMs: number;
  /** The ongoing absence, if any (shown once meaningful). */
  current: { awayAt: number; elapsedMs: number; meaningful: boolean } | null;
}

/**
 * Per-player summary for the given players (in their order). Players without events
 * get an empty summary — never an invented absence.
 */
export function summarizeActivity(
  intervals: readonly AwayInterval[],
  playerIds: readonly PlayerId[],
  now: number,
): PlayerActivity[] {
  return playerIds.map((playerId) => {
    let count = 0;
    let totalMs = 0;
    let current: PlayerActivity['current'] = null;
    for (const interval of intervals) {
      if (interval.playerId !== playerId) continue;
      const meaningful = isMeaningful(interval, now);
      const durationMs = intervalDurationMs(interval, now);
      if (isOpen(interval, now)) {
        current = { awayAt: interval.awayAt, elapsedMs: durationMs, meaningful };
      }
      if (meaningful) {
        count += 1;
        totalMs += durationMs;
      }
    }
    return { playerId, count, totalMs, current };
  });
}

/** Whole seconds, rounded down: a 2.0 s absence reads "2 сек.", 1.9 s is not shown. */
export function awaySeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

export function formatAwayDuration(ms: number): string {
  return `${String(awaySeconds(ms))} сек.`;
}

export function formatAwayCount(count: number): string {
  return count === 1 ? '1 излизане' : `${String(count)} излизания`;
}

/* ---------------------------------------------------------------------------
 * Monitoring rules
 * ------------------------------------------------------------------------- */

/**
 * The client reports visibility only while the player can still edit answers:
 * effective PLAYING, a participant of the round, not left, answers not locked.
 */
export function shouldMonitorVisibility(input: {
  stage: RoundStage['kind'];
  isParticipant: boolean;
  left: boolean;
  answersLocked: boolean;
}): boolean {
  return input.stage === 'playing' && input.isParticipant && !input.left && !input.answersLocked;
}

/* ---------------------------------------------------------------------------
 * Multi-tab aggregation — visibility is per player, not per tab
 * ------------------------------------------------------------------------- */

/** A visible tab re-announces itself this often; silence for STALE means it is gone. */
export const TAB_HEARTBEAT_MS = 2_000;
export const TAB_STALE_MS = 5_000;

export interface PeerTab {
  visible: boolean;
  seenAt: number;
}

/** The player is visible if this tab or any other live tab of the same game is visible. */
export function isPlayerVisible(
  selfVisible: boolean,
  peers: Iterable<PeerTab>,
  now: number,
): boolean {
  if (selfVisible) return true;
  for (const peer of peers) {
    if (peer.visible && now - peer.seenAt <= TAB_STALE_MS) return true;
  }
  return false;
}

export type VisibilityReport = 'away' | 'return';

export interface TabObservation {
  /** This tab's own document is visible. */
  selfVisible: boolean;
  /** Any tab of this player's game is visible (isPlayerVisible). */
  playerVisible: boolean;
}

/**
 * What this tab reports when its view of the player's visibility changes. Only
 * transitions observed by this tab count, so repeated browser events (visibilitychange
 * + pagehide, focus after visibilitychange…) are swallowed:
 *  - away   — the player went from visible to hidden (no tab of the game visible). The
 *             first observation never reports away: a tab opened in the background
 *             does not yet know whether another tab is visible.
 *  - return — this tab itself became visible (or starts visible). Only a visible tab
 *             reports a return; the server ignores it when nothing is open.
 */
export function nextVisibilityReport(
  previous: TabObservation | null,
  next: TabObservation,
): VisibilityReport | null {
  if (next.selfVisible) return previous?.selfVisible === true ? null : 'return';
  if (previous?.playerVisible === true && !next.playerVisible) return 'away';
  return null;
}
