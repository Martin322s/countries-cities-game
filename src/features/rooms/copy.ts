import { DISPLAY_NAME_MAX_LENGTH, type DisplayNameError } from '@/domain';
import type { AuthErrorKind } from '@/features/auth/authContext';

export function displayNameErrorMessage(error: DisplayNameError): string {
  switch (error) {
    case 'empty':
      return 'Въведи име, с което другите да те познаят.';
    case 'too_long':
      return `Името може да е най-много ${DISPLAY_NAME_MAX_LENGTH} символа.`;
  }
}

export const ROOM_CODE_ERROR_MESSAGE = 'Кодът на стаята е от 5 знака — букви и цифри.';

export function identityErrorMessage(kind: AuthErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return 'Сървърът за онлайн игра не е конфигуриран.';
    case 'unreachable':
      return 'Няма връзка със сървъра. Опитваме отново автоматично...';
    case 'sign_in_failed':
      return 'Неуспешно свързване със сървъра.';
  }
}
