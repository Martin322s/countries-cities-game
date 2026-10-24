import type { RoundStage } from '@/domain';

import type { GameState } from './api/gameState';

/**
 * True while the screen (driven by authoritative timestamps) is ahead of the
 * persisted server state, e.g. started_at passed but the phase still says
 * COUNTDOWN, or the letter has not been revealed to us yet.
 */
export function isServerBehind(state: GameState, stage: RoundStage): boolean {
  switch (stage.kind) {
    case 'playing':
      return state.phase === 'COUNTDOWN' || state.round?.letter === null;
    case 'time_up':
      return state.phase === 'COUNTDOWN' || state.phase === 'PLAYING';
    case 'results':
      return state.phase === 'REVEAL';
    case 'lobby':
    case 'waiting':
    case 'countdown':
    case 'results_ready':
    case 'ai_validating':
    case 'reveal':
    case 'finished':
      return false;
  }
}
