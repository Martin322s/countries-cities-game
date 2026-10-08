import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { reportError } from '@/shared/lib/telemetry';

export function RouteErrorPage() {
  const error = useRouteError();
  useEffect(() => {
    if (!isRouteErrorResponse(error)) reportError('render_error', error, 'route');
  }, [error]);
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-950 px-4 text-center text-fg">
      <h1 className="font-display text-2xl font-bold">Нещо се обърка</h1>
      <p className="max-w-md text-fg-muted">
        Опитай да презаредиш страницата. Ако проблемът продължи, започни отначало.
      </p>
      {import.meta.env.DEV && detail ? (
        <pre className="max-w-full overflow-auto rounded-lg bg-ink-800 p-3 text-left text-xs text-fg-subtle">
          {detail}
        </pre>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          className="h-11 cursor-pointer rounded-xl border border-white/12 px-5 font-display text-sm font-bold"
          onClick={() => {
            window.location.reload();
          }}
        >
          Презареди
        </button>
        <Link
          to="/"
          className="inline-flex h-11 items-center rounded-lg px-3 text-brand-300 underline-offset-4 hover:underline"
        >
          Към началото
        </Link>
      </div>
    </div>
  );
}
