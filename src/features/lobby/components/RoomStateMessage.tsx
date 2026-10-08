import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface RoomStateMessageProps {
  title: string;
  children?: ReactNode;
  busy?: boolean;
  action?: ReactNode;
}

/** Centered full-page state for the room route (loading, errors, unavailable). */
export function RoomStateMessage({ title, children, busy = false, action }: RoomStateMessageProps) {
  return (
    <section
      aria-busy={busy}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 text-center"
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="size-10 animate-spin rounded-full border-4 border-white/10 border-t-brand-400"
        />
      ) : null}
      <h1 className="font-display text-2xl font-bold" role={busy ? 'status' : undefined}>
        {title}
      </h1>
      {children ? <div className="text-fg-muted">{children}</div> : null}
      <div className="flex flex-col items-center gap-3">
        {action}
        <Link
          to="/"
          className="rounded-lg text-sm text-brand-300 underline-offset-4 hover:underline"
        >
          Към началото
        </Link>
      </div>
    </section>
  );
}
