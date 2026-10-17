import { createContext, useContext, useEffect } from 'react';

import type { Cue, CueDecision } from './cueGate';

export interface GameAudio {
  /** The player's preference ("Звук: включен"). */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Announce a game event; the engine decides (once) whether it makes a sound. */
  cue: (cue: Cue) => CueDecision;
}

/** Without a provider (tests, isolated renders) the game is simply silent. */
const SILENT: GameAudio = {
  enabled: false,
  setEnabled: () => undefined,
  cue: () => 'unavailable',
};

export const GameAudioContext = createContext<GameAudio>(SILENT);

export function useGameAudio(): GameAudio {
  return useContext(GameAudioContext);
}

/**
 * Cues `cue` whenever `when` holds. Safe to re-run on every render: the gate keys
 * events by identity, so the same event never sounds twice.
 */
export function useCue(when: boolean, cue: Cue | null): void {
  const audio = useGameAudio();
  const key = when && cue ? cue.key : null;
  useEffect(() => {
    if (key !== null && cue) audio.cue(cue);
    // The key identifies the event; the rest of the cue is derived from the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, audio]);
}
