import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

import { serverNow } from '@/features/game/clock/serverClock';

import { browserAudioContext, GameAudioEngine } from './audioEngine';
import { GameAudioContext, type GameAudio } from './gameAudio';
import { readSoundEnabled, subscribeSoundEnabled, writeSoundEnabled } from './soundPreference';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * One audio engine for the whole app. The AudioContext is created on the first user
 * gesture (browser autoplay rules) — before that, cues are silently skipped and never
 * replayed. Hidden pages make no sound and suspend the context.
 */
export function GameAudioProvider({
  children,
  engine: injected,
}: {
  children: ReactNode;
  /** Tests inject an engine with fake dependencies. */
  engine?: GameAudioEngine;
}) {
  const [engine] = useState(
    () =>
      injected ??
      new GameAudioEngine({
        createContext: browserAudioContext,
        now: serverNow,
        isVisible: () => document.visibilityState === 'visible',
        isEnabled: readSoundEnabled,
        // A DOM event per decision (key, sound id, played/skipped-why), so browser tests
        // and devtools can see what the game played without touching audio output.
        onDecision: ({ key, sound }, decision) => {
          window.dispatchEvent(
            new CustomEvent('gameaudio:cue', { detail: { key, sound, decision } }),
          );
        },
      }),
  );
  const enabled = useSyncExternalStore(subscribeSoundEnabled, readSoundEnabled, () => true);

  useEffect(() => {
    const unlock = () => {
      engine.unlock();
    };
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true });
    const onVisibility = () => {
      engine.onVisibilityChange(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [engine]);

  useEffect(() => {
    engine.onEnabledChange(enabled);
  }, [engine, enabled]);

  const value = useMemo<GameAudio>(
    () => ({
      enabled,
      setEnabled: writeSoundEnabled,
      cue: (cue) => engine.cue(cue),
    }),
    [engine, enabled],
  );

  return <GameAudioContext value={value}>{children}</GameAudioContext>;
}
