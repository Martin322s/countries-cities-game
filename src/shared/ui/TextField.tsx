import { useId, type ComponentProps } from 'react';

import { cn } from '@/shared/lib/cn';

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'h-12 rounded-xl border bg-ink-950/60 px-4 text-base text-fg transition placeholder:text-fg-subtle',
          'focus-visible:border-brand-400 focus-visible:outline-offset-0',
          error ? 'border-status-duplicate' : 'border-white/12 hover:border-white/25',
          className,
        )}
        {...props}
      />
      {message ? (
        <p
          id={messageId}
          className={cn('text-xs', error ? 'text-status-duplicate' : 'text-fg-subtle')}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
