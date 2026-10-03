import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonClasses';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Shows a small spinner, keeps the label (no size change) and blocks double clicks. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size), className)}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="-ml-1 size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : icon ? (
        <span aria-hidden="true" className="-ml-1 shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
