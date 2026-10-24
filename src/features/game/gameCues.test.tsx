import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { revealCueTimes, revealProgress, type RoomId, type RoundId } from '@/domain';
import { GameAudioEngine } from '@/features/audio/audioEngine';
import type { CueDecision } from '@/features/audio/cueGate';
import { GameAudioContext, type GameAudio } from '@/features/audio/gameAudio';
import type { SoundId } from '@/features/audio/sounds';

import { recordClockSample, resetServerClock, serverNow } from './clock/serverClock';
import { CountdownScreen } from './components/CountdownScreen';
import { RoundTimer } from './components/RoundTimer';
import {
  categorySound,
  countdownCue,
  finishedCue,
  revealCue,
  timerCue,
  TIMER_TICK_FROM_SECONDS,
} from './gameCues';

const ROUND = 'round-7' as RoundId;
const NOW = Date.parse('2026-01-01T12:00:00Z');

describe('cue rules', () => {
  it('keys the countdown by round and number, on the authoritative boundary', () => {
    expect(countdownCue(ROUND, NOW, 3)).toEqual({
      key: 'round:round-7:countdown:3',
      sound: 'countdown-tick',
      at: NOW - 3_000,
    });
    expect(countdownCue(ROUND, NOW, 1).sound).toBe('countdown-final');
  });

  it('ticks only in the final ten seconds, and not for a player who already locked', () => {
    const endsAt = NOW + 60_000;
    expect(TIMER_TICK_FROM_SECONDS).toBe(10);
    expect(timerCue(ROUND, endsAt, 30_000, { answersLocked: false })).toBeNull();
    expect(timerCue(ROUND, endsAt, 10_000, { answersLocked: false })).toMatchObject({
      key: 'round:round-7:tick:10',
      at: endsAt - 10_000,
    });
    expect(timerCue(ROUND, endsAt, 4_200, { answersLocked: true })).toBeNull();
    // Time-up is the round's end for everyone.
    expect(timerCue(ROUND, endsAt, 0, { answersLocked: true })).toMatchObject({
      key: 'round:round-7:time-up',
      sound: 'time-up',
    });
  });

  it('gives each category one sound, chosen by the player’s own cell', () => {
    expect(categorySound('unique')).toBe('reveal-unique');
    expect(categorySound('duplicate')).toBe('reveal-duplicate');
    expect(categorySound('invalid')).toBe('reveal-invalid');
    expect(categorySound('empty')).toBe('reveal-neutral');
    expect(categorySound(null)).toBe('reveal-neutral');
  });

  it('maps the reveal timeline onto suspense, categories, scores and leaderboard', () => {
    const revealAt = NOW;
    const times = revealCueTimes(revealAt);
    const at = (t: number) =>
      revealCue(ROUND, revealAt, revealProgress(revealAt, t), () => 'unique');
    expect(at(revealAt + 10)).toMatchObject({ key: 'round:round-7:suspense', sound: 'suspense' });
    expect(at(times.categories[1]! + 5)).toMatchObject({
      key: 'round:round-7:category:city',
      sound: 'reveal-unique',
      at: times.categories[1],
    });
    expect(at(times.scores + 5)).toMatchObject({ key: 'round:round-7:scores', sound: 'score' });
    expect(at(times.leaderboard + 5)).toMatchObject({ sound: 'leaderboard' });
    expect(at(revealAt + 60_000)).toBeNull();
  });

  it('celebrates the end of the game once per room, only when it is fresh', () => {
    expect(finishedCue('room-1' as RoomId, NOW)).toMatchObject({
      key: 'room:room-1:finished',
      sound: 'winner',
      at: NOW,
    });
  });
});

/** A real engine with a fake context: records what would have played. */
function harness() {
  const played: SoundId[] = [];
  const decisions: { key: string; decision: CueDecision }[] = [];
  let visible = true;
  const engine = new GameAudioEngine({
    createContext: () =>
      ({
        state: 'running',
        currentTime: 0,
        destination: {},
        createGain: () => ({ gain: { value: 1, setValueAtTime: vi.fn() }, connect: vi.fn() }),
        resume: () => Promise.resolve(),
        suspend: () => Promise.resolve(),
      }) as unknown as AudioContext,
    now: serverNow,
    isVisible: () => visible,
    isEnabled: () => true,
    render: (_ctx, _out, sound) => {
      played.push(sound);
    },
  });
  engine.unlock();
  const audio: GameAudio = {
    enabled: true,
    setEnabled: () => undefined,
    cue: (cue) => {
      const decision = engine.cue(cue);
      decisions.push({ key: cue.key, decision });
      return decision;
    },
  };
  return {
    audio,
    played,
    decisions,
    setVisible: (value: boolean) => {
      visible = value;
    },
  };
}

/**
 * Advances fake time in 100 ms steps. act() flushes React only at its end, so one big
 * step would render ~1 s late and every cue would (correctly) count as stale.
 */
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    act(() => {
      vi.advanceTimersByTime(100);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetServerClock();
  recordClockSample({ serverMs: NOW, requestStart: NOW, requestEnd: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('timer sounds follow the authoritative second', () => {
  it('ticks 10 → 1 exactly once each, then one end sound — re-renders change nothing', () => {
    const h = harness();
    const endsAt = NOW + 12_000;
    const view = (
      <GameAudioContext value={h.audio}>
        <RoundTimer roundId={ROUND} endsAt={endsAt} answersLocked={false} />
      </GameAudioContext>
    );
    const { rerender } = render(view);
    for (let second = 0; second < 13; second++) {
      advance(1_000);
      rerender(view); // e.g. a query refetch re-rendering the screen
    }
    expect(h.played.filter((s) => s === 'timer-tick')).toHaveLength(10);
    expect(h.played.filter((s) => s === 'time-up')).toHaveLength(1);
  });

  it('after a refresh at 7 s continues at 7 — never replays 10 · 9 · 8', () => {
    const h = harness();
    render(
      <GameAudioContext value={h.audio}>
        <RoundTimer roundId={ROUND} endsAt={NOW + 6_800} answersLocked={false} />
      </GameAudioContext>,
    );
    advance(1_000);
    const keys = h.decisions.map((d) => d.key);
    expect(keys).not.toContain('round:round-7:tick:10');
    expect(keys).not.toContain('round:round-7:tick:9');
    expect(keys).not.toContain('round:round-7:tick:8');
    expect(keys).toContain('round:round-7:tick:7');
  });

  it('stays calm for a player who already pressed ГОТОВ', () => {
    const h = harness();
    render(
      <GameAudioContext value={h.audio}>
        <RoundTimer roundId={ROUND} endsAt={NOW + 9_500} answersLocked />
      </GameAudioContext>,
    );
    advance(10_000);
    expect(h.played).toEqual(['time-up']);
  });

  it('plays nothing in the background and does not dump the missed ticks on return', () => {
    const h = harness();
    h.setVisible(false);
    render(
      <GameAudioContext value={h.audio}>
        <RoundTimer roundId={ROUND} endsAt={NOW + 9_500} answersLocked={false} />
      </GameAudioContext>,
    );
    advance(4_000);
    expect(h.played).toEqual([]);
    h.setVisible(true);
    advance(1_000);
    // Only the current second sounds — none of the four missed ticks.
    expect(h.played).toEqual(['timer-tick']);
  });
});

describe('countdown sounds', () => {
  it('ticks 3 · 2 · 1 once each (the last one higher), regardless of re-renders', () => {
    const h = harness();
    const view = (
      <GameAudioContext value={h.audio}>
        <CountdownScreen roundId={ROUND} startedAt={NOW + 3_000} roundNumber={7} />
      </GameAudioContext>
    );
    const { rerender } = render(view);
    for (let i = 0; i < 3; i++) {
      advance(1_000);
      rerender(view);
    }
    expect(h.played).toEqual(['countdown-tick', 'countdown-tick', 'countdown-final']);
  });

  it('a refresh during the countdown joins at the current number only', () => {
    const h = harness();
    // "2" began 600 ms ago: it still sounds; "3" is never cued.
    render(
      <GameAudioContext value={h.audio}>
        <CountdownScreen roundId={ROUND} startedAt={NOW + 1_400} roundNumber={7} />
      </GameAudioContext>,
    );
    expect(h.decisions).toEqual([{ key: 'round:round-7:countdown:2', decision: 'play' }]);
  });

  it('a number that began long ago is not sounded late', () => {
    const h = harness();
    // "2" began 950 ms ago — too late to sound like the beat.
    render(
      <GameAudioContext value={h.audio}>
        <CountdownScreen roundId={ROUND} startedAt={NOW + 1_050} roundNumber={7} />
      </GameAudioContext>,
    );
    expect(h.decisions).toEqual([{ key: 'round:round-7:countdown:2', decision: 'stale' }]);
    expect(h.played).toEqual([]);
  });
});
