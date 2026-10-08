import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="flex flex-col items-center gap-4 px-4 text-center">
      <p className="text-gradient-brand font-display text-7xl font-black">404</p>
      <h1 className="font-display text-2xl font-bold">Тази страница не съществува</h1>
      <Link
        to="/"
        className="rounded-lg text-brand-300 underline-offset-4 transition hover:underline"
      >
        Към началото
      </Link>
    </section>
  );
}
