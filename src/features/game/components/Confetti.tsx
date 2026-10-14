import { useEffect, useState, type CSSProperties } from 'react';

import { useReducedMotion } from '@/shared/hooks/useReducedMotion';
import { cn } from '@/shared/lib/cn';

import { claimCelebration } from '../celebration';

const COLORS = [
  'bg-brand-400',
  'bg-accent-400',
  'bg-violet-400',
  'bg-cyan-400',
  'bg-status-unique',
];
const PIECES = Array.from({ length: 28 }, (_, index) => ({
  left: `${String((index * 37 + 11) % 100)}%`,
  delay: `${String((index % 7) * 0.08)}s`,
  duration: `${String(2.2 + (index % 5) * 0.18)}s`,
  drift: `${String(((index * 53) % 121) - 60)}px`,
  spin: `${String(360 + (index % 4) * 180)}deg`,
  wide: index % 3 === 0,
  color: COLORS[index % COLORS.length],
}));
/** Longest piece (duration + delay) — then the confetti is removed from the DOM. */
const LIFETIME_MS = 3_400;

/**
 * A short, lightweight confetti burst (28 CSS pieces, ~3 s, runs once). Decorative:
 * pointer-events none, hidden from assistive tech, and absent with reduced motion.
 */
export function Confetti({ gameKey }: { gameKey: string }) {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(() => !reducedMotion && claimCelebration(gameKey));

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      setActive(false);
    }, LIFETIME_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [active]);

  if (!active || reducedMotion) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="confetti"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {PIECES.map((piece, index) => (
        <span
          // Static decoration; the index is the identity.
          key={index}
          className={cn(
            'absolute -top-4 animate-confetti rounded-sm',
            piece.wide ? 'h-2 w-3' : 'h-3 w-1.5',
            piece.color,
          )}
          style={
            {
              left: piece.left,
              animationDelay: piece.delay,
              '--confetti-duration': piece.duration,
              '--drift': piece.drift,
              '--spin': piece.spin,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
