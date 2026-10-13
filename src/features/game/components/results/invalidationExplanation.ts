import type { ResultCell } from '../../api/roundResults';

/** Describe the persisted verdict; never invent a factual justification for a host's choice. */
export function invalidationExplanation(cell: ResultCell): string | null {
  if (cell.state === 'wrong_letter') {
    return 'Отговорът не започва с буквата на рунда. Според правилата това носи 0 точки.';
  }
  if (cell.state !== 'invalid') return null;
  if (cell.hostInvalidated) {
    return 'Хостът е отбелязал този отговор като невалиден при проверката. Конкретно обяснение за ръчното анулиране не е записано.';
  }
  switch (cell.validationReason) {
    case 'WRONG_LETTER':
      return 'Проверката установи, че отговорът не започва с буквата на рунда. Според правилата това носи 0 точки.';
    case 'MISSPELLING':
      return cell.validationSuggestion
        ? `Географската проверка откри правописна грешка. Предложената поправка е „${cell.validationSuggestion}“, но оригиналният отговор не се променя автоматично.`
        : 'Географската проверка откри правописна грешка в изписването.';
    case 'DOES_NOT_EXIST':
      return 'Географската проверка не откри това название в използваните данни.';
    case 'WRONG_CATEGORY':
      return 'Според географската проверка това название не принадлежи към избраната категория.';
    case 'AMBIGUOUS':
      return 'Географската проверка не успя надеждно да потвърди това название за избраната категория.';
    case null:
    case undefined:
      break;
  }
  return 'Отговорът е отбелязан като невалиден при проверката. За това анулиране няма записана конкретна причина.';
}
