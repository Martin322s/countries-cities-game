import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameAudioEngine, MASTER_GAIN } from './audioEngine';
import { CueGate, DEFAULT_CUE_MAX_AGE_MS, type Cue, type CueContext } from './cueGate';
import {
  readSoundEnabled,
  resetSoundPreferenceCache,
  subscribeSoundEnabled,
  writeSoundEnabled,
} from './soundPreference';

const ctx = (overrides: Partial<CueContext> = {}): CueContext => ({
  now: 10_000,
  visible: true,
  enabled: true,
  available: true,
  ...overrides,
});
const cue = (key: string, at?: number): Cue => ({
  key,
  sound: 'timer-tick',
  ...(at === undefined ? {} : { at }),
});

describe('CueGate', () => {
  it('plays an event once — re-renders, refetches and StrictMode repeats are duplicates', () => {
    const gate = new CueGate();
    expect(gate.decide(cue('round:1:tick:5'), ctx())).toBe('play');
    expect(gate.decide(cue('round:1:tick:5'), ctx())).toBe('duplicate');
    expect(gate.decide(cue('round:1:tick:4'), ctx())).toBe('play');
  });

  it('drops an event whose moment has passed (refresh, resumed tab, late data)', () => {
    const gate = new CueGate();
    const now = 50_000;
    expect(gate.decide(cue('a', now - DEFAULT_CUE_MAX_AGE_MS - 1), ctx({ now }))).toBe('stale');
    expect(gate.decide(cue('b', now - 200), ctx({ now }))).toBe('play');
    expect(gate.decide({ ...cue('c', now - 3_000), maxAgeMs: 4_000 }, ctx({ now }))).toBe('play');
  });

  it('stays silent in the background and never replays the missed sound later', () => {
    const gate = new CueGate();
    expect(gate.decide(cue('round:1:category:city'), ctx({ visible: false }))).toBe('hidden');
    expect(gate.decide(cue('round:1:category:city'), ctx({ visible: true }))).toBe('duplicate');
  });

  it('respects mute, and audio that is not unlocked yet — without queueing', () => {
    const gate = new CueGate();
    expect(gate.decide(cue('x'), ctx({ enabled: false }))).toBe('muted');
    expect(gate.decide(cue('y'), ctx({ available: false }))).toBe('unavailable');
    expect(gate.decide(cue('y'), ctx())).toBe('duplicate');
  });

  it('keeps a bounded memory', () => {
    const gate = new CueGate();
    for (let i = 0; i < 1_000; i++) gate.decide(cue(`k${String(i)}`), ctx());
    // The oldest keys were forgotten, recent ones are still remembered.
    expect(gate.decide(cue('k999'), ctx())).toBe('duplicate');
    expect(gate.decide(cue('k0'), ctx())).toBe('play');
  });
});

/** Minimal stand-in for an AudioContext: enough for the engine, records nothing real. */
function fakeContext(state: AudioContextState = 'running') {
  const gain = { value: 1, setValueAtTime: vi.fn() };
  const context = {
    state,
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain, connect: vi.fn() }),
    resume: vi.fn(() => {
      context.state = 'running';
      return Promise.resolve();
    }),
    suspend: vi.fn(() => {
      context.state = 'suspended';
      return Promise.resolve();
    }),
  };
  return { context: context as unknown as AudioContext, gain, raw: context };
}

function engineWith(
  options: {
    context?: AudioContext | null;
    visible?: () => boolean;
    enabled?: () => boolean;
    now?: () => number;
    render?: () => void;
  } = {},
) {
  const render = vi.fn(options.render);
  const createContext = vi.fn(() =>
    options.context === undefined ? fakeContext().context : options.context,
  );
  const engine = new GameAudioEngine({
    createContext,
    now: options.now ?? (() => 1_000),
    isVisible: options.visible ?? (() => true),
    isEnabled: options.enabled ?? (() => true),
    render,
  });
  return { engine, render, createContext };
}

describe('GameAudioEngine', () => {
  it('creates no audio before a user gesture (autoplay rules)', () => {
    const { engine, render, createContext } = engineWith();
    expect(engine.cue(cue('early'))).toBe('unavailable');
    expect(createContext).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    engine.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(engine.cue(cue('later'))).toBe('play');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('falls back to silence when audio is unavailable — gameplay continues', () => {
    const { engine, render } = engineWith({ context: null });
    engine.unlock();
    engine.unlock();
    expect(engine.cue(cue('a'))).toBe('unavailable');
    expect(render).not.toHaveBeenCalled();
  });

  it('survives a context that throws on creation or a rejected resume (autoplay refusal)', () => {
    const throwing = new GameAudioEngine({
      createContext: () => {
        throw new Error('NotAllowedError');
      },
      now: () => 0,
      isVisible: () => true,
      isEnabled: () => true,
    });
    expect(() => {
      throwing.unlock();
    }).not.toThrow();
    expect(throwing.cue(cue('a'))).toBe('unavailable');

    const { context, raw } = fakeContext('suspended');
    raw.resume = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const { engine } = engineWith({ context });
    expect(() => {
      engine.unlock();
    }).not.toThrow();
    expect(engine.cue(cue('b'))).toBe('unavailable');
  });

  it('swallows a failing sound', () => {
    const { engine } = engineWith({
      render: () => {
        throw new Error('boom');
      },
    });
    engine.unlock();
    expect(() => engine.cue(cue('a'))).not.toThrow();
  });

  it('suspends while hidden and only resumes when visible', () => {
    const { context, raw } = fakeContext();
    const { engine } = engineWith({ context });
    engine.unlock();
    engine.onVisibilityChange(false);
    expect(raw.suspend).toHaveBeenCalled();
    engine.onVisibilityChange(true);
    expect(raw.resume).toHaveBeenCalled();
  });

  it('mutes instantly, also a sound already ringing', () => {
    const { context, gain } = fakeContext();
    const { engine } = engineWith({ context });
    engine.unlock();
    engine.onEnabledChange(false);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    engine.onEnabledChange(true);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(MASTER_GAIN, 0);
  });

  it('judges freshness on the server clock it is given', () => {
    let now = 100_000;
    const { engine } = engineWith({ now: () => now });
    engine.unlock();
    expect(engine.cue(cue('fresh', now - 100))).toBe('play');
    now += 5_000;
    expect(engine.cue(cue('old', now - 2_000))).toBe('stale');
  });
});

describe('sound preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSoundPreferenceCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to ON and persists the choice locally', () => {
    expect(readSoundEnabled()).toBe(true);
    writeSoundEnabled(false);
    expect(window.localStorage.getItem('darzhavi-i-gradove.sound')).toBe('off');
    resetSoundPreferenceCache();
    expect(readSoundEnabled()).toBe(false);
  });

  it('notifies subscribers and follows changes from other tabs', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSoundEnabled(listener);
    writeSoundEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'darzhavi-i-gradove.sound', newValue: 'on' }),
    );
    expect(readSoundEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readSoundEnabled()).toBe(true);
    expect(() => {
      writeSoundEnabled(false);
    }).not.toThrow();
    expect(readSoundEnabled()).toBe(false);
  });

  it('is independent of reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    expect(readSoundEnabled()).toBe(true);
  });
});
