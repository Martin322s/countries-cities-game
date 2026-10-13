/** The darkened moment before the synchronized results reveal begins. */
export function SuspenseOverlay() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-40 grid animate-fade-in place-items-center bg-ink-950/85 backdrop-blur-md"
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        <p className="font-display text-2xl font-black tracking-wide sm:text-4xl">
          РЕЗУЛТАТИТЕ СЕ РАЗКРИВАТ
        </p>
        <span className="flex gap-2">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-3 animate-dot rounded-full bg-brand-400"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
