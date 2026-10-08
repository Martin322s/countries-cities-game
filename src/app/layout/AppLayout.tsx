import { Link, Outlet } from 'react-router';

import { SoundToggle } from '@/features/audio/SoundToggle';

import { AmbientBackdrop } from './AmbientBackdrop';

export function AppLayout() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-ink-800 px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Към съдържанието
      </a>
      <AmbientBackdrop />

      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg font-display text-sm font-bold tracking-wide text-fg-muted transition hover:text-fg"
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-brand-400 to-accent-500 text-base font-black text-ink-950"
          >
            Д
          </span>
          <span className="sr-only sm:not-sr-only">Държави и градове</span>
        </Link>
        <SoundToggle />
      </header>

      <main id="main" className="flex flex-1 items-center justify-center py-12 sm:py-16">
        <Outlet />
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-fg-subtle">
        <span>Без регистрация · Играй от телефон или компютър</span>
        <span aria-hidden="true">·</span>
        <Link to="/about" className="underline-offset-4 hover:text-fg-muted hover:underline">
          За играта
        </Link>
        <Link to="/privacy" className="underline-offset-4 hover:text-fg-muted hover:underline">
          Поверителност
        </Link>
      </footer>
    </div>
  );
}
