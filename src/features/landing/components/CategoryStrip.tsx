import { CATEGORY_IDS, CATEGORY_LABELS } from '@/domain';

/** Preview of the game sheet's columns, derived from the domain category list. */
export function CategoryStrip() {
  return (
    <ul aria-label="Категории" className="flex flex-wrap justify-center gap-2">
      {CATEGORY_IDS.map((category) => (
        <li
          key={category}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold tracking-wide text-fg-muted sm:text-sm"
        >
          {CATEGORY_LABELS[category]}
        </li>
      ))}
    </ul>
  );
}
