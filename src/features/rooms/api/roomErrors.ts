/**
 * Expected failures of room operations.
 *
 * Server codes are raised by the room RPCs as `MESSAGE = <code>, HINT = 'app_error'`
 * (see supabase/migrations). Only codes on this whitelist are trusted; anything else
 * becomes `unknown`, so the UI never depends on arbitrary database error text.
 */
export const SERVER_ROOM_ERROR_CODES = [
  'not_authenticated',
  'invalid_display_name',
  'invalid_capacity',
  'invalid_room_code',
  'room_not_found',
  'room_full',
  'room_finished',
  'game_in_progress',
  'display_name_taken',
  'not_member',
  'room_code_unavailable',
  // Gameplay
  'not_host',
  'game_already_started',
  'not_enough_players',
  'not_participant',
  'wrong_phase',
  'round_not_active',
  'round_over',
  'answers_locked',
  'invalid_answers',
  'invalid_category',
  'answer_too_long',
  // Results
  'results_not_available',
  'answer_empty',
  // Multi-round game
  'round_already_started',
  'no_letters_left',
  'letters_remaining',
  'game_finished',
  // Production hardening
  'rate_limited',
  'payload_too_large',
] as const;

export type ServerRoomErrorCode = (typeof SERVER_ROOM_ERROR_CODES)[number];

/** Client-side classifications in addition to server codes. */
export type RoomErrorCode = ServerRoomErrorCode | 'network' | 'unknown';

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    readonly causeError?: unknown,
  ) {
    super(`Room operation failed: ${code}`);
    this.name = 'RoomError';
  }
}

function isServerRoomErrorCode(value: unknown): value is ServerRoomErrorCode {
  return (
    typeof value === 'string' && (SERVER_ROOM_ERROR_CODES as readonly string[]).includes(value)
  );
}

function hasStringField<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    key in value &&
    typeof (value as Record<K, unknown>)[key] === 'string'
  );
}

/** Network-level failures (offline, DNS, CORS, aborted request). */
function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (hasStringField(error, 'name') && error.name === 'AuthRetryableFetchError') return true;
  // postgrest-js reports fetch failures with an empty code and a "TypeError" message.
  return (
    hasStringField(error, 'message') &&
    hasStringField(error, 'code') &&
    error.code === '' &&
    error.message.includes('Failed to fetch')
  );
}

/** Converts anything thrown by a room operation into a typed `RoomError`. */
export function toRoomError(error: unknown): RoomError {
  if (error instanceof RoomError) return error;
  if (
    hasStringField(error, 'hint') &&
    error.hint === 'app_error' &&
    hasStringField(error, 'message') &&
    isServerRoomErrorCode(error.message)
  ) {
    return new RoomError(error.message, error);
  }
  if (isNetworkFailure(error)) return new RoomError('network', error);
  return new RoomError('unknown', error);
}

export type RoomOperation =
  | 'create'
  | 'join'
  | 'leave'
  | 'start'
  | 'ready'
  | 'answers'
  | 'results'
  | 'invalidate'
  | 'next_round'
  | 'finish';

function notHostMessage(operation: RoomOperation): string {
  switch (operation) {
    case 'next_round':
      return 'Само хостът може да започне нов рунд.';
    case 'finish':
      return 'Само хостът може да покаже крайното класиране.';
    case 'invalidate':
      return 'Само хостът може да променя валидността на отговорите.';
    case 'create':
    case 'join':
    case 'leave':
    case 'start':
    case 'ready':
    case 'answers':
    case 'results':
      return 'Само хостът може да започне играта.';
  }
}

/** Polished Bulgarian copy for every expected failure. */
export function roomErrorMessage(code: RoomErrorCode, operation: RoomOperation): string {
  switch (code) {
    case 'invalid_room_code':
      return 'Невалиден код. Кодът е от 5 знака — букви и цифри.';
    case 'room_not_found':
      return 'Стаята не съществува. Провери кода и опитай отново.';
    case 'room_full':
      return 'Стаята е пълна.';
    case 'room_finished':
      return 'Тази игра вече е приключила.';
    case 'game_in_progress':
      return 'Играта вече е започнала. Изчакай следващата игра.';
    case 'display_name_taken':
      return 'Това име вече се използва в стаята. Избери друго.';
    case 'invalid_display_name':
      return 'Името трябва да е между 1 и 20 символа.';
    case 'invalid_capacity':
      return 'Броят играчи трябва да е между 2 и 15.';
    case 'not_member':
      return 'Вече не си в тази стая.';
    case 'not_authenticated':
      return 'Сесията ти изтече. Презареди страницата.';
    case 'network':
      return 'Връзката със сървъра беше прекъсната. Опитай отново.';
    case 'not_host':
      // E.g. the host role moved to someone else a moment ago.
      return notHostMessage(operation);
    case 'game_already_started':
      return 'Играта вече е започнала.';
    case 'not_enough_players':
      return operation === 'next_round'
        ? 'Нужни са поне 2 свързани играчи за нов рунд. Изчакваме играчите да се върнат.'
        : 'Нужни са поне 2 играчи, за да започне играта.';
    case 'not_participant':
      return 'Не участваш в този рунд.';
    case 'wrong_phase':
    case 'round_not_active':
      return 'Играта вече премина към следващия етап.';
    case 'round_over':
      return 'Времето изтече — отговорите са заключени.';
    case 'answers_locked':
      return 'Отговорите ти вече са заключени.';
    case 'invalid_answers':
    case 'invalid_category':
      return 'Отговорите не можаха да бъдат запазени.';
    case 'answer_too_long':
      return 'Отговорът може да е най-много 100 символа.';
    case 'results_not_available':
      return 'Резултатите още не са налични.';
    case 'answer_empty':
      return 'Празен отговор не може да бъде отбелязан като невалиден.';
    case 'round_already_started':
      return 'Следващият рунд вече започна.';
    case 'no_letters_left':
      return 'Всички 28 букви са изиграни.';
    case 'letters_remaining':
      return 'Играта приключва след 28-ия рунд.';
    case 'game_finished':
      return 'Играта вече приключи.';
    case 'rate_limited':
      return 'Твърде много заявки. Опитай отново след малко.';
    case 'payload_too_large':
      return 'Данните са твърде големи.';
    case 'room_code_unavailable':
    case 'unknown':
      switch (operation) {
        case 'create':
          return 'Неуспешно създаване на стаята. Опитай отново.';
        case 'join':
          return 'Неуспешно влизане в стаята. Опитай отново.';
        case 'leave':
          return 'Неуспешно напускане на стаята. Опитай отново.';
        case 'start':
          return 'Играта не можа да започне. Опитай отново.';
        case 'ready':
          return 'Неуспешно потвърждение. Опитай отново.';
        case 'answers':
          return 'Отговорите не можаха да бъдат запазени. Опитваме отново...';
        case 'results':
          return 'Резултатите не можаха да бъдат заредени. Опитай отново.';
        case 'invalidate':
          return 'Промяната не беше запазена. Опитай отново.';
        case 'next_round':
          return 'Новият рунд не можа да започне. Опитай отново.';
        case 'finish':
          return 'Играта не можа да бъде завършена. Опитай отново.';
      }
  }
}
