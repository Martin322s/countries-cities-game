import { MEMBER_STALE_AFTER_MS } from './config';
import type { PlayerId } from './ids';
import type { GamePhase } from './phases';
import { REVEAL_DURATION_MS } from './reveal';

/**
 * Authoritative round timeline (epoch ms, server clock). Set by the server when the
 * countdown starts: startedAt = countdownAt + 3 s, endsAt = startedAt + 60 s.
 */
export interface RoundTimeline {
  countdownAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  lockedAt: number | null;
  /** Start of the synchronized results reveal (set when everyone is ready for results). */
  revealAt: number | null;
}

/**
 * What a client should show, derived from the persisted phase PLUS the timeline and
 * the estimated server time. Timed transitions are therefore never late on screen even
 * if the persisted phase update lags behind (the server applies it lazily).
 */
export type RoundStage =
  | { kind: 'lobby' }
  | { kind: 'waiting' }
  | { kind: 'countdown'; secondsLeft: number }
  | { kind: 'playing'; remainingMs: number }
  /** ends_at has passed; the server will persist the lock on its next request. */
  | { kind: 'time_up' }
  | { kind: 'results_ready' }
  | { kind: 'map_validating' }
  | { kind: 'reveal' }
  | { kind: 'results' }
  | { kind: 'finished' };

function timedStage(timeline: RoundTimeline, serverNow: number): RoundStage {
  const { startedAt, endsAt, lockedAt } = timeline;
  if (startedAt === null || endsAt === null) return { kind: 'waiting' };
  if (lockedAt !== null) return { kind: 'time_up' };
  if (serverNow < startedAt) {
    return {
      kind: 'countdown',
      secondsLeft: Math.max(1, Math.ceil((startedAt - serverNow) / 1000)),
    };
  }
  if (serverNow < endsAt) return { kind: 'playing', remainingMs: endsAt - serverNow };
  return { kind: 'time_up' };
}

export function deriveRoundStage(
  phase: GamePhase,
  timeline: RoundTimeline | null,
  serverNow: number,
): RoundStage {
  switch (phase) {
    case 'LOBBY':
      return { kind: 'lobby' };
    case 'ROUND_WAITING':
      return { kind: 'waiting' };
    case 'COUNTDOWN':
    case 'PLAYING':
      return timeline ? timedStage(timeline, serverNow) : { kind: 'waiting' };
    case 'ROUND_LOCKED':
    case 'RESULTS_READY':
      return { kind: 'results_ready' };
    case 'MAP_VALIDATING':
      return { kind: 'map_validating' };
    case 'REVEAL':
      // The server moves REVEAL → RESULTS lazily; the screen does not wait for it.
      return timeline?.revealAt != null && serverNow >= timeline.revealAt + REVEAL_DURATION_MS
        ? { kind: 'results' }
        : { kind: 'reveal' };
    case 'RESULTS':
      return { kind: 'results' };
    case 'FINISHED':
      return { kind: 'finished' };
  }
}

/** "1:59" — whole seconds rounded up, so the display reaches 0:00 exactly at the deadline. */
export function formatTimer(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export type TimerUrgency = 'calm' | 'low' | 'critical';

export function timerUrgency(remainingMs: number): TimerUrgency {
  if (remainingMs > 30_000) return 'calm';
  if (remainingMs > 10_000) return 'low';
  return 'critical';
}

/** A round participant as seen by every player (no answer content). */
export interface RoundParticipant {
  playerId: PlayerId;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  left: boolean;
  roundReady: boolean;
  answersLockedAt: string | null;
  answersLockReason: 'ready' | 'left' | 'tab_exit' | null;
  resultsReady: boolean;
}

export type ReadyCheck = 'round' | 'results';

/**
 * Required for a ready check: has not left and has a fresh heartbeat. Mirrors
 * `all_required_ready` in SQL — a short disconnect keeps the player required.
 */
export function isRequiredForReadyCheck(participant: RoundParticipant, serverNow: number): boolean {
  if (participant.left) return false;
  const lastSeen = Date.parse(participant.lastSeenAt);
  return Number.isFinite(lastSeen) && serverNow - lastSeen < MEMBER_STALE_AFTER_MS;
}

function isReadyFor(participant: RoundParticipant, check: ReadyCheck): boolean {
  return check === 'round' ? participant.roundReady : participant.resultsReady;
}

export function readyProgress(
  participants: readonly RoundParticipant[],
  check: ReadyCheck,
  serverNow: number,
): { ready: number; required: number } {
  const required = participants.filter((p) => isRequiredForReadyCheck(p, serverNow));
  return { ready: required.filter((p) => isReadyFor(p, check)).length, required: required.length };
}

/** Mirrors `all_answers_locked`: everyone still in the game has pressed ready. */
export function allAnswersLocked(participants: readonly RoundParticipant[]): boolean {
  return participants.every((p) => p.left || p.answersLockedAt !== null);
}
