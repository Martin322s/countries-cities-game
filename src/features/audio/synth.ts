import type { SoundId } from './sounds';

/*
 * Original, programmatically generated sound effects (Web Audio API): short tones
 * with envelopes, a few noise swells. Nothing is sampled or downloaded. Levels are
 * deliberately low; the master gain sits on top of these per-voice gains.
 */

interface Voice {
  type: OscillatorType;
  /** Start frequency (Hz) and optional glide target. */
  freq: number;
  to?: number;
  /** Seconds from now. */
  start?: number;
  duration: number;
  gain: number;
  attack?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, voice: Voice): void {
  const t0 = ctx.currentTime + (voice.start ?? 0);
  const t1 = t0 + voice.duration;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = voice.type;
  osc.frequency.setValueAtTime(voice.freq, t0);
  if (voice.to !== undefined) osc.frequency.exponentialRampToValueAtTime(voice.to, t1);
  const attack = voice.attack ?? 0.006;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(voice.gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(env);
  env.connect(out);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Filtered noise swell (suspense, leaderboard whoosh). */
function noise(
  ctx: BaseAudioContext,
  out: AudioNode,
  options: { duration: number; gain: number; from: number; to: number; start?: number },
): void {
  const t0 = ctx.currentTime + (options.start ?? 0);
  const length = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(options.from, t0);
  filter.frequency.exponentialRampToValueAtTime(options.to, t0 + options.duration);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(options.gain, t0 + options.duration * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);
  source.connect(filter);
  filter.connect(env);
  env.connect(out);
  source.start(t0);
  source.stop(t0 + options.duration + 0.02);
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

const SOUNDS: Record<SoundId, (ctx: BaseAudioContext, out: AudioNode) => void> = {
  'countdown-tick': (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 660, duration: 0.12, gain: 0.5 });
  },
  'countdown-final': (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 880, duration: 0.14, gain: 0.55 });
  },
  letter: (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: C5, duration: 0.35, gain: 0.35 });
    tone(ctx, out, { type: 'triangle', freq: G5, duration: 0.45, gain: 0.3, start: 0.05 });
    tone(ctx, out, { type: 'sine', freq: C6, to: 1318.5, duration: 0.5, gain: 0.18, start: 0.1 });
  },
  'timer-tick': (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 1200, duration: 0.05, gain: 0.22 });
  },
  'time-up': (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: G5, duration: 0.22, gain: 0.4 });
    tone(ctx, out, { type: 'triangle', freq: C5, duration: 0.45, gain: 0.4, start: 0.18 });
  },
  ready: (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 587.33, duration: 0.12, gain: 0.35 });
    tone(ctx, out, { type: 'sine', freq: 880, duration: 0.22, gain: 0.32, start: 0.09 });
  },
  'all-ready': (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: C5, duration: 0.18, gain: 0.3 });
    tone(ctx, out, { type: 'triangle', freq: E5, duration: 0.18, gain: 0.3, start: 0.1 });
    tone(ctx, out, { type: 'triangle', freq: G5, duration: 0.35, gain: 0.3, start: 0.2 });
  },
  suspense: (ctx, out) => {
    noise(ctx, out, { duration: 1.6, gain: 0.12, from: 180, to: 900 });
    tone(ctx, out, { type: 'sine', freq: 110, to: 164.8, duration: 1.7, gain: 0.25, attack: 0.6 });
  },
  'reveal-unique': (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: 987.77, duration: 0.14, gain: 0.32 });
    tone(ctx, out, { type: 'sine', freq: 1318.5, duration: 0.22, gain: 0.22, start: 0.06 });
  },
  'reveal-duplicate': (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: 311.13, duration: 0.2, gain: 0.35 });
    tone(ctx, out, { type: 'sine', freq: 293.66, duration: 0.24, gain: 0.2, start: 0.04 });
  },
  'reveal-invalid': (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 233.08, to: 196, duration: 0.22, gain: 0.3 });
  },
  'reveal-neutral': (ctx, out) => {
    tone(ctx, out, { type: 'sine', freq: 523.25, duration: 0.09, gain: 0.2 });
  },
  score: (ctx, out) => {
    tone(ctx, out, { type: 'triangle', freq: E5, duration: 0.12, gain: 0.3 });
    tone(ctx, out, { type: 'triangle', freq: G5, duration: 0.12, gain: 0.3, start: 0.08 });
    tone(ctx, out, { type: 'triangle', freq: C6, duration: 0.3, gain: 0.3, start: 0.16 });
  },
  leaderboard: (ctx, out) => {
    noise(ctx, out, { duration: 0.45, gain: 0.08, from: 600, to: 3000 });
    tone(ctx, out, { type: 'sine', freq: G5, duration: 0.4, gain: 0.2, start: 0.12 });
  },
  winner: (ctx, out) => {
    const notes = [C5, E5, G5, C6];
    notes.forEach((freq, index) => {
      tone(ctx, out, { type: 'triangle', freq, duration: 0.22, gain: 0.3, start: index * 0.11 });
    });
    for (const freq of [C5, E5, G5, C6]) {
      tone(ctx, out, { type: 'sine', freq, duration: 1.3, gain: 0.12, start: 0.44, attack: 0.05 });
    }
  },
};

export function synthesize(ctx: BaseAudioContext, out: AudioNode, sound: SoundId): void {
  SOUNDS[sound](ctx, out);
}
