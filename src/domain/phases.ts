/**
 * Room-level game phase state machine.
 *
 * LOBBY → ROUND_WAITING → COUNTDOWN → PLAYING → ROUND_LOCKED → RESULTS_READY
 *       → AI_VALIDATING → REVEAL → RESULTS → ROUND_WAITING → … → FINISHED
 *
 * Transitions are executed by the server; clients only render the current phase.
 * This table is the single source of truth for which transitions are legal and is
 * mirrored by server-side checks.
 */
export const GAME_PHASES = [
  'LOBBY',
  'ROUND_WAITING',
  'COUNTDOWN',
  'PLAYING',
  'ROUND_LOCKED',
  'RESULTS_READY',
  'AI_VALIDATING',
  'REVEAL',
  'RESULTS',
  'FINISHED',
] as const;

export type GamePhase = (typeof GAME_PHASES)[number];

/**
 * Enum-like accessor so code reads `GamePhase.PLAYING` instead of a magic string,
 * while the type stays a plain string-literal union.
 */
export const GamePhase = Object.fromEntries(GAME_PHASES.map((phase) => [phase, phase])) as {
  readonly [P in GamePhase]: P;
};

export const PHASE_TRANSITIONS: Readonly<Record<GamePhase, readonly GamePhase[]>> = {
  LOBBY: ['ROUND_WAITING'],
  ROUND_WAITING: ['COUNTDOWN'],
  COUNTDOWN: ['PLAYING'],
  PLAYING: ['ROUND_LOCKED'],
  ROUND_LOCKED: ['RESULTS_READY'],
  RESULTS_READY: ['AI_VALIDATING'],
  AI_VALIDATING: ['REVEAL'],
  REVEAL: ['RESULTS'],
  // From RESULTS the host starts a new round, or the game ends when no letters remain.
  RESULTS: ['ROUND_WAITING', 'FINISHED'],
  FINISHED: [],
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function isGamePhase(value: string): value is GamePhase {
  return (GAME_PHASES as readonly string[]).includes(value);
}

/**
 * Which ready-check (if any) is collected in a phase. Ready flags are stored per round
 * and per stage, so moving to the next stage starts from a clean slate.
 */
export type ReadyStage = 'pre_round' | 'pre_results';

export function readyStageForPhase(phase: GamePhase): ReadyStage | null {
  switch (phase) {
    case 'ROUND_WAITING':
      return 'pre_round';
    case 'RESULTS_READY':
      return 'pre_results';
    case 'PLAYING':
      // STOP ends the round for everyone. READY is collected only in RESULTS_READY.
      return null;
    case 'LOBBY':
    case 'COUNTDOWN':
    case 'ROUND_LOCKED':
    case 'AI_VALIDATING':
    case 'REVEAL':
    case 'RESULTS':
    case 'FINISHED':
      return null;
  }
}

/** Visibility (tab/app focus) monitoring is only active while answering. */
export function isVisibilityMonitoredPhase(phase: GamePhase): boolean {
  return phase === GamePhase.PLAYING;
}
