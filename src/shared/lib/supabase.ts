import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { getSupabaseEnv } from './env';

export type TypedSupabaseClient = SupabaseClient<Database>;

export class SupabaseConfigError extends Error {
  constructor(readonly details: string[]) {
    super(`Supabase is not configured: ${details.join(' ')}`);
    this.name = 'SupabaseConfigError';
  }
}

let client: TypedSupabaseClient | undefined;

/**
 * Returns the singleton browser client (publishable key only).
 *
 * Player identity will be a Supabase *anonymous* auth session. supabase-js persists it
 * in localStorage, so refreshes and reconnects keep the same `auth.uid()` = PlayerId.
 * Privileged operations (scoring, phase transitions, host migration) run server-side
 * in Postgres functions / Edge Functions — never with a secret key in this bundle.
 */
export function getSupabaseClient(): TypedSupabaseClient {
  if (client) return client;

  const result = getSupabaseEnv();
  if (!result.ok) throw new SupabaseConfigError(result.errors);

  client = createClient<Database>(result.env.supabaseUrl, result.env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'darzhavi-i-gradove.auth',
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv().ok;
}
