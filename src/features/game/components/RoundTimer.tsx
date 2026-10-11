import { formatTimer, timerUrgency, type RoundId, type TimerUrgency } from '@/domain';
import { useCue } from '@/features/audio/gameAudio';
import { cn } from '@/shared/lib/cn';

import { useServerSecondTick } from '../clock/useServerTime';
import { timerCue } from '../gameCues';

const URGENCY_CLASSES: Record<TimerUrgency, string> = {
  calm: 'border-white/10 bg-white/5 text-fg',
  low: 'border-status-warning/50 bg-status-warning/10 text-status-warning',
  critical: 'border-status-duplicate/70 bg-status-duplicate/20 text-status-duplicate',
};

/** Announced to screen readers only at these remaining-second marks (not every tick). */
const ANNOUNCE_AT_SECONDS = new Set([60, 30, 10]);

/**
 * Remaining time = ends_at − estimated server time. Re-renders once per second,
 * aligned to ends_at so all clients flip at the same moment. Three levels: calm
 * (> 30 s), subtle urgency (≤ 30 s), strong urgency (≤ 10 s: a beat per second and,
 * for players still answering, one quiet tick). Sounds hang off the same authoritative
 * second, so there is no second countdown that could drift; a refresh at 7 s continues
 * at 7 instead of replaying 10 · 9 · 8. Urgency is also given as text, never colour only.
 */
export function RoundTimer({
  roundId,
  endsAt,
  answersLocked,
}: {
  roundId: RoundId;
  endsAt: number;
  /** The player already pressed ГОТОВ: they are waiting, not racing — no ticking. */
  answersLocked: boolean;
}) {
  const now = useServerSecondTick(endsAt);
  const remaining = Math.max(0, endsAt - now);
  const urgency = timerUrgency(remaining);
  const seconds = Math.ceil(remaining / 1000);
  const cue = timerCue(roundId, endsAt, remaining, { answersLocked });
  useCue(cue !== null, cue);

  return (
    <div className="flex flex-col items-end">
      <span className="text-[0.65rem] font-bold tracking-[0.2em] text-fg-subtle uppercase">
        Време
      </span>
      <span
        role="timer"
        aria-label={`Оставащо време ${formatTimer(remaining)}`}
        className={cn(
          'rounded-xl border px-3 py-1 font-display text-2xl font-black tabular-nums transition-colors duration-(--motion-normal) sm:text-3xl',
          URGENCY_CLASSES[urgency],
        )}
      >
        <span
          // A fresh key each critical second restarts the one-shot beat.
          key={urgency === 'critical' && remaining > 0 ? seconds : 'steady'}
          className={cn(
            'inline-block',
            urgency === 'critical' && remaining > 0 && 'animate-[soft-pulse_600ms_ease-out_1]',
          )}
        >
          {formatTimer(remaining)}
        </span>
      </span>
      <span className="sr-only" aria-live="polite">
        {ANNOUNCE_AT_SECONDS.has(seconds) ? `Остават ${seconds} секунди` : ''}
        {remaining === 0 ? 'Времето изтече' : ''}
      </span>
    </div>
  );
}
