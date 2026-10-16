/**
 * Motion tokens for JavaScript-driven animation (FLIP, counters, timers). Mirrors the
 * CSS custom properties in src/app/styles/index.css — keep both in sync.
 *
 *   instant  — hover/press feedback, status swaps
 *   fast     — small state changes, toasts, badges
 *   normal   — screen and panel entrances
 *   dramatic — game events: countdown numbers, the letter, the winner
 */
export const MOTION_MS = {
  instant: 120,
  fast: 200,
  normal: 360,
  dramatic: 720,
} as const;

export const EASING = {
  standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** Duration to actually use: reduced motion makes every transition (nearly) instant. */
export function motionDuration(token: keyof typeof MOTION_MS, reducedMotion: boolean): number {
  return reducedMotion ? 0 : MOTION_MS[token];
}
