import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type NoticeTone = 'info' | 'warning' | 'error';

const TONE_CLASSES: Record<NoticeTone, string> = {
  info: 'border-cyan-400/30 bg-cyan-400/10 text-fg',
  warning: 'border-status-warning/40 bg-status-warning/10 text-fg',
  error: 'border-status-duplicate/40 bg-status-duplicate/10 text-fg',
};

/** Inline message. Errors are announced assertively (`role="alert"`). */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm', TONE_CLASSES[tone], className)}
    >
      {children}
    </div>
  );
}
