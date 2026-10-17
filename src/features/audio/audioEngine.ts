import { CueGate, type Cue, type CueDecision } from './cueGate';
import type { SoundId } from './sounds';
import { synthesize } from './synth';

/** Overall level on top of the per-sound gains — nothing should startle. */
export const MASTER_GAIN = 0.45;

export interface AudioEngineDeps {
  /** Creates the AudioContext; only ever called from a user gesture (autoplay rules). */
  createContext: () => AudioContext | null;
  /** Estimated server time (the shared clock) — cue freshness is judged on it. */
  now: () => number;
  isVisible: () => boolean;
  isEnabled: () => boolean;
  render?: (ctx: AudioContext, out: AudioNode, sound: SoundId) => void;
  /** Observes every decision — played or skipped and why (diagnostics / browser tests). */
  onDecision?: (cue: Cue, decision: CueDecision) => void;
}

export function browserAudioContext(): AudioContext | null {
  // Older Safari only has the prefixed constructor; some environments have neither.
  const scope = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * The single place that makes sound. Components never touch audio APIs: they `cue()`
 * game events; the gate decides (once per event) and failures are swallowed — audio
 * can never block or break gameplay.
 */
export class GameAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unsupported = false;
  private readonly gate = new CueGate();

  constructor(private readonly deps: AudioEngineDeps) {}

  /** Call from user gestures. Creates/resumes the context; harmless to repeat. */
  unlock(): void {
    if (this.unsupported) return;
    try {
      if (!this.ctx) {
        const ctx = this.deps.createContext();
        if (!ctx) {
          this.unsupported = true;
          return;
        }
        const master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      }
      if (this.ctx.state === 'suspended' && this.deps.isVisible()) {
        this.ctx.resume().catch(() => undefined);
      }
    } catch {
      this.unsupported = true;
      this.ctx = null;
    }
  }

  /** Audio is unlocked and running. */
  get available(): boolean {
    return this.ctx?.state === 'running';
  }

  cue(cue: Cue): CueDecision {
    const decision = this.gate.decide(cue, {
      now: this.deps.now(),
      visible: this.deps.isVisible(),
      enabled: this.deps.isEnabled(),
      available: this.available,
    });
    if (decision === 'play' && this.ctx && this.master) {
      try {
        (this.deps.render ?? synthesize)(this.ctx, this.master, cue.sound);
      } catch {
        // A failed sound is just silence.
      }
    }
    this.deps.onDecision?.(cue, decision);
    return decision;
  }

  /** Background tab: cut anything still ringing; resume only when visible again. */
  onVisibilityChange(visible: boolean): void {
    if (!this.ctx) return;
    const action = visible ? this.ctx.resume() : this.ctx.suspend();
    action.catch(() => undefined);
  }

  /** Muting also silences a sound already in progress. */
  onEnabledChange(enabled: boolean): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setValueAtTime(enabled ? MASTER_GAIN : 0, this.ctx.currentTime);
  }
}
