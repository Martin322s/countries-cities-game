import type { EligibleLetter } from './alphabet';
import type { CategoryId } from './categories';
import type { PlayerId, RoomId, RoundId } from './ids';
import type { GamePhase, ReadyStage } from './phases';

/** Connection state as observed through realtime presence + server heartbeat. */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface Player {
  id: PlayerId;
  displayName: string;
  /** ISO timestamp; earliest joiners are preferred during host migration. */
  joinedAt: string;
  /** Server time of the last heartbeat (ISO). */
  lastSeenAt: string;
  /** Derived on the client from presence + heartbeat, see presence.ts. */
  connectionStatus: ConnectionStatus;
  /** Set when the player explicitly left the room; they no longer count as active. */
  leftAt: string | null;
}

export interface Room {
  id: RoomId;
  /** Short uppercase join code, see `roomCode.ts`. */
  code: string;
  capacity: number;
  hostPlayerId: PlayerId;
  phase: GamePhase;
  usedLetters: EligibleLetter[];
  currentRoundId: RoundId | null;
  createdAt: string;
}

/**
 * A round exists from ROUND_WAITING onward. Its letter and timer are assigned by the
 * server when the countdown starts, so they are `null` while players are getting ready.
 */
export interface Round {
  id: RoundId;
  roomId: RoomId;
  /** 1-based round number within the game. */
  number: number;
  letter: EligibleLetter | null;
  /** Server timestamps (ISO). `endsAt` is the authoritative answering deadline. */
  startedAt: string | null;
  endsAt: string | null;
  lockedAt: string | null;
}

/** One player's raw answers for one round. Missing categories count as empty. */
export type AnswerSet = Partial<Record<CategoryId, string>>;

export interface ReadyState {
  roundId: RoundId;
  stage: ReadyStage;
  readyPlayerIds: ReadonlySet<PlayerId>;
}

/** Informational anti-cheat signal: the player left the game view while PLAYING. */
export interface VisibilityAbsence {
  playerId: PlayerId;
  roundId: RoundId;
  leftAt: string;
  /** `null` while the player is still away. */
  returnedAt: string | null;
  /** Detection source. Browser signals are best-effort, never proof. */
  source: 'visibility' | 'blur' | 'presence';
}
