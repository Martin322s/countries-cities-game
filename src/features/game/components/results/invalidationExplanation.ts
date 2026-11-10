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
  if (cell.validationTimedOut) {
    return 'AI проверката не приключи в определения срок и този отговор остана непотвърден. Затова е отбелязан като невалиден, без това да доказва, че думата е грешна.';
  }
  switch (cell.validationReason) {
    case 'WRONG_LETTER':
      return 'Проверката установи, че отговорът не започва с буквата на рунда. Според правилата това носи 0 точки.';
    case 'MISSPELLING':
      return cell.validationSuggestion
        ? `AI проверката откри правописна грешка в изписването. Предложената поправка е „${cell.validationSuggestion}“, но оригиналният отговор не се променя автоматично.`
        : 'AI проверката откри правописна грешка в изписването. Отговорите с грешно изписване се отбелязват като невалидни.';
    case 'DOES_NOT_EXIST':
      return 'AI проверката не потвърди, че въведеният отговор съществува като реално название. Затова го отбеляза като невалиден за тази категория.';
    case 'WRONG_CATEGORY':
      return 'Според AI проверката думата не принадлежи към избраната категория. Дори да е реална дума, тук тя не носи точки.';
    case 'AMBIGUOUS':
      return 'AI проверката не успя надеждно да потвърди този отговор за избраната категория. Той е отбелязан като невалиден поради несигурност, а не като доказано несъществуваща дума.';
    case null:
    case undefined:
      break;
  }
  return 'Отговорът е отбелязан като невалиден при проверката. За това анулиране няма записана конкретна причина.';
}
