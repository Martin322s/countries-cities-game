import type { CellState } from '../../api/roundResults';

/** Text meaning for every state — colour is never the only signal. */
export const CELL_STATE_LABELS: Readonly<Record<CellState, string>> = {
  unique: 'уникален',
  duplicate: 'повтарящ се',
  empty: 'празен',
  invalid: 'невалиден',
};
