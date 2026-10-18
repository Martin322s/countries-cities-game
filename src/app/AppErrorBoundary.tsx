import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportError } from '@/shared/lib/telemetry';

interface State {
  failed: boolean;
}

/**
 * Last line of defence for rendering errors outside the router (providers, layout).
 * Route-level errors are handled by RouteErrorPage. Never shows a stack trace to
 * players; the error is reported (sanitized) and the player can reload or go home.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError('render_error', error, info.componentStack?.split('\n')[1]?.trim());
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <ErrorFallback />;
  }
}

/** Calm, non-technical copy with a way out. */
export function ErrorFallback() {
  return (
    <div
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-950 px-4 text-center text-fg"
    >
      <h1 className="font-display text-2xl font-bold">Нещо се обърка</h1>
      <p className="max-w-md text-fg-muted">
        Опитай да презаредиш страницата. Ако играеш в стая, ще се върнеш в нея — мястото и
        отговорите ти са запазени.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          className="h-11 cursor-pointer rounded-xl bg-linear-to-r from-brand-400 to-accent-500 px-5 font-display text-sm font-bold text-ink-950"
          onClick={() => {
            window.location.reload();
          }}
        >
          Презареди
        </button>
        <a
          href="/"
          className="inline-flex h-11 items-center rounded-xl border border-white/12 px-5 font-display text-sm font-bold"
        >
          Към началото
        </a>
      </div>
    </div>
  );
}
