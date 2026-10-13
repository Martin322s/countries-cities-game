import type { ResultCell } from '../../api/roundResults';

/** Describe a persisted host decision without inventing a factual justification. */
export function invalidationExplanation(cell: ResultCell): string | null {
  if (cell.state === 'wrong_letter') {
    return 'Отговорът не започва с буквата на рунда. Според правилата това носи 0 точки.';
  }
  if (cell.state !== 'invalid') return null;
  if (cell.hostInvalidated) {
    return 'Хостът е отбелязал този отговор като невалиден при проверката. Конкретно обяснение за ръчното анулиране не е записано.';
  }
  return 'Отговорът е отбелязан като невалиден. Конкретно обяснение не е записано.';
}
