import { describe, expect, it } from 'vitest';

import {
  canTransition,
  GAME_PHASES,
  GamePhase,
  isVisibilityMonitoredPhase,
  PHASE_TRANSITIONS,
  readyStageForPhase,
} from './phases';

describe('game phase state machine', () => {
  it('follows the round loop in order', () => {
    const loop: GamePhase[] = [
      'LOBBY',
      'ROUND_WAITING',
      'COUNTDOWN',
      'PLAYING',
      'ROUND_LOCKED',
      'RESULTS_READY',
      'REVEAL',
      'RESULTS',
      'ROUND_WAITING',
    ];
    for (let i = 0; i < loop.length - 1; i++) {
      expect(canTransition(loop[i]!, loop[i + 1]!)).toBe(true);
    }
  });

  it('starts the reveal immediately after the results ready check', () => {
    expect(canTransition('RESULTS_READY', 'REVEAL')).toBe(true);
  });

  it('rejects skipping phases', () => {
    expect(canTransition('ROUND_WAITING', 'PLAYING')).toBe(false);
    expect(canTransition('PLAYING', 'RESULTS')).toBe(false);
    expect(canTransition('LOBBY', 'RESULTS')).toBe(false);
    expect(canTransition('RESULTS_READY', 'REVEAL')).toBe(true);
    expect(canTransition('RESULTS_READY', 'RESULTS')).toBe(false);
  });

  it('can only finish the game from RESULTS, and FINISHED is terminal', () => {
    const phasesThatCanFinish = GAME_PHASES.filter((phase) => canTransition(phase, 'FINISHED'));
    expect(phasesThatCanFinish).toEqual(['RESULTS']);
    expect(PHASE_TRANSITIONS.FINISHED).toEqual([]);
  });

  it('only references known phases in the transition table', () => {
    for (const targets of Object.values(PHASE_TRANSITIONS)) {
      for (const target of targets) expect(GAME_PHASES).toContain(target);
    }
  });

  it('exposes an enum-like accessor matching the phase names', () => {
    expect(GamePhase.PLAYING).toBe('PLAYING');
    expect(Object.keys(GamePhase)).toEqual([...GAME_PHASES]);
  });
});

describe('readyStageForPhase', () => {
  it('collects ready checks before the round and before results only', () => {
    expect(readyStageForPhase('ROUND_WAITING')).toBe('pre_round');
    expect(readyStageForPhase('RESULTS_READY')).toBe('pre_results');
    const others = GAME_PHASES.filter((p) => p !== 'ROUND_WAITING' && p !== 'RESULTS_READY');
    for (const phase of others) expect(readyStageForPhase(phase)).toBeNull();
  });
});

describe('isVisibilityMonitoredPhase', () => {
  it('monitors only while PLAYING', () => {
    expect(GAME_PHASES.filter(isVisibilityMonitoredPhase)).toEqual(['PLAYING']);
  });
});
