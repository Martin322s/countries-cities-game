import { cn } from '@/shared/lib/cn';

/**
 * Button hierarchy:
 *  - primary   — the one action the screen is about (ГОТОВ, СЪЗДАЙ СТАЯ, НОВ РУНД)
 *  - secondary — a real alternative (ВЛЕЗ В СТАЯ, КЪМ НАЧАЛОТО)
 *  - ghost     — quiet actions (retry, back to the current round, leave)
 *  - danger    — destructive confirmations
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const BASE =
  'inline-flex cursor-pointer items-center justify-center font-display font-bold tracking-wide select-none ' +
  'transition duration-(--motion-instant) ease-standard active:scale-[0.98] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 disabled:hover:brightness-100';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-linear-to-r from-brand-400 via-brand-500 to-accent-500 text-ink-950 shadow-glow hover:brightness-110 active:brightness-95',
  secondary: 'glass text-fg hover:border-white/25 hover:bg-white/10 active:bg-white/5',
  ghost: 'text-fg-muted hover:bg-white/8 hover:text-fg active:bg-white/5',
  danger:
    'border border-status-duplicate/50 bg-status-duplicate/15 text-fg hover:bg-status-duplicate/25',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'h-11 gap-2 rounded-xl px-5 text-sm whitespace-nowrap',
  // Large labels may wrap on narrow phones instead of overflowing the screen.
  lg: 'min-h-14 gap-3 rounded-2xl px-6 py-3 text-center text-base leading-tight text-balance sm:min-h-16 sm:px-8 sm:text-lg',
};

/** The same look for links that act as buttons. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cn(BASE, VARIANT_CLASSES[variant], SIZE_CLASSES[size]);
}
