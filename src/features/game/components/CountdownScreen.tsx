import { PRE_ROUND_COUNTDOWN_MS, type RoundId } from '@/domain';
import { useCue } from '@/features/audio/gameAudio';

import { useServerSecondTick } from '../clock/useServerTime';
import { countdownCue } from '../gameCues';

/**
 * 3 · 2 · 1, derived from the authoritative started_at on every render — a refresh
 * mid-countdown shows (and ticks) the correct number, and a slow device cannot delay
 * anyone. Each number gets its own entrance (keyed), a beat of emphasis and an exit;
 * the letter itself is revealed by the playing screen at started_at.
 */
export function CountdownScreen({
  roundId,
  startedAt,
  roundNumber,
}: {
  roundId: RoundId;
  startedAt: number;
  roundNumber: number;
}) {
  const now = useServerSecondTick(startedAt);
  // Never above the countdown length, even if the clock estimate briefly lags.
  const secondsLeft = Math.min(
    PRE_ROUND_COUNTDOWN_MS / 1000,
    Math.max(1, Math.ceil((startedAt - now) / 1000)),
  );
  useCue(true, countdownCue(roundId, startedAt, secondsLeft));

  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-sm font-bold tracking-[0.3em] text-brand-300 uppercase">
        Рунд {roundNumber}
      </p>
      <p className="text-fg-muted">Буквата идва след…</p>
      <div className="relative grid size-[clamp(11rem,48vw,15rem)] place-items-center">
        <span
          key={`ring-${String(secondsLeft)}`}
          aria-hidden="true"
          className="absolute inset-0 animate-letter-settle rounded-full border-2 border-brand-400/40"
        />
        <p
          key={secondsLeft}
          aria-live="assertive"
          aria-atomic="true"
          className="animate-count-pop text-gradient-brand font-display text-[clamp(7rem,30vw,11rem)] leading-none font-black tabular-nums"
        >
          {secondsLeft}
        </p>
      </div>
    </div>
  );
}
