import type { AuthErrorKind, AuthState } from '@/features/auth/authContext';
import type { RoomError, RoomErrorCode } from '@/features/rooms/api/roomErrors';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';

/** What `/room/:code` should render. */
export type RoomAccess =
  | { kind: 'invalid_code' }
  | { kind: 'identity_loading' }
  | { kind: 'identity_error'; reason: AuthErrorKind }
  | { kind: 'loading' }
  | { kind: 'member'; room: RoomSummary }
  | { kind: 'not_member' }
  | { kind: 'error'; code: RoomErrorCode };

/**
 * Resolves room access from identity + the membership query.
 *
 * Once membership data exists it wins over a later refetch error: a transient network
 * failure must never kick a member out of the lobby. `null` data means "not an active
 * member" — RLS makes that indistinguishable from "room does not exist" on purpose.
 */
export function resolveRoomAccess(input: {
  codeValid: boolean;
  auth: AuthState;
  room: { data: RoomSummary | null | undefined; error: RoomError | null };
}): RoomAccess {
  if (!input.codeValid) return { kind: 'invalid_code' };

  switch (input.auth.status) {
    case 'loading':
      return { kind: 'identity_loading' };
    case 'error':
      return { kind: 'identity_error', reason: input.auth.kind };
    case 'ready':
      break;
  }

  const { data, error } = input.room;
  if (data) return { kind: 'member', room: data };
  if (data === null) return { kind: 'not_member' };
  if (error) return { kind: 'error', code: error.code };
  return { kind: 'loading' };
}
