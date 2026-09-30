/**
 * Answer categories in the order they appear on the game sheet.
 * Identifiers are English and stable (they are persisted); labels are Bulgarian UI copy.
 *
 * "Точки" (points) is intentionally NOT a category: it is derived by scoring.
 */
export const CATEGORY_IDS = [
  'country',
  'city',
  'village',
  'animal',
  'plant',
  'object',
  'name',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORY_LABELS: Readonly<Record<CategoryId, string>> = {
  country: 'Държава',
  city: 'Град',
  village: 'Село',
  animal: 'Животно',
  plant: 'Растение',
  object: 'Предмет',
  name: 'Име',
};

/** Column header for the derived score column of the results table. */
export const POINTS_COLUMN_LABEL = 'Точки';

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}
