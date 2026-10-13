import { useEffect, useRef, useState } from 'react';

import { useReducedMotion } from '@/shared/hooks/useReducedMotion';

const COUNT_MS = 800;

/**
 * Visual count to the authoritative `value`. On mount it counts up from `from` only
 * when `animateInitial` (the live reveal); history and settled screens show the value
 * at once. Later changes (host invalidation) always glide from the shown value. The
 * animation is cosmetic; screen readers get the final value only.
 */
export function PointsCounter({
  value,
  className,
  from = 0,
  animateInitial = true,
}: {
  value: number;
  className?: string;
  from?: number;
  animateInitial?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion || !animateInitial ? value : from);
  const shownRef = useRef(shown);

  useEffect(() => {
    if (reducedMotion) {
      shownRef.current = value;
      return;
    }
    const start = shownRef.current;
    if (start === value) return;
    let frame = 0;
    const started = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / COUNT_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(start + (value - start) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [value, reducedMotion]);

  return (
    <span className={className}>
      <span aria-hidden="true">{reducedMotion ? value : shown}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
