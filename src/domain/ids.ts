/**
 * Branded identifiers prevent accidentally passing e.g. a RoomId where a PlayerId
 * is expected. They are plain strings (UUIDs) at runtime.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

/** Equals the Supabase anonymous-auth user id (`auth.uid()`) of the player. */
export type PlayerId = Brand<string, 'PlayerId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type RoundId = Brand<string, 'RoundId'>;
