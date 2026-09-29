type ClassValue = string | false | null | undefined;

/** Joins conditional class names. Tailwind classes are kept non-conflicting by design. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
