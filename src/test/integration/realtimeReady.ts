/**
 * Global setup for integration tests: wait until the local stack is actually
 * delivering Postgres Changes on a private Realtime channel.
 *
 * Why: right after `supabase db reset` the stack restarts its containers. Measured
 * behaviour during that warm-up:
 *   - anonymous sign-in can fail ("Database error creating anonymous user");
 *   - the first private-channel joins fail with "transport failure" and the client's
 *     rejoin backoff grows, so SUBSCRIBED can take 10–20 s;
 *   - RPCs issued in that window can fail too.
 * Tests that need Realtime would otherwise race this warm-up. This is an explicit,
 * bounded readiness check that keeps generating a real change until one is observed —
 * not an arbitrary sleep. On timeout it reports every step with timings.
 */
import { createClient, REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

import type { Database } from '@/shared/lib/database.types';

const READY_TIMEOUT_MS = 90_000;
const PROBE_INTERVAL_MS = 2_000;

export default async function realtimeReady(): Promise<void> {
  const env = loadEnv('test', process.cwd(), 'VITE_');
  const url = env.VITE_SUPABASE_URL ?? '';
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!url || !key) return; // suites skip themselves without a local stack

  const started = Date.now();
  const steps: string[] = [];
  const note = (step: string) => {
    steps.push(`${step}@${((Date.now() - started) / 1000).toFixed(1)}s`);
  };
  const remaining = () => READY_TIMEOUT_MS - (Date.now() - started);
  const fail = (reason: string): never => {
    throw new Error(`Realtime not ready: ${reason}. Steps: ${steps.join(' → ') || 'none'}`);
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const signIn = async (label: string) => {
    while (remaining() > 0) {
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInAnonymously();
      if (!error) return client;
      note(`${label} sign-in failed (${error.message})`);
      await sleep(1_000);
    }
    return fail(`${label} could not sign in`);
  };

  const owner = await signIn('owner');
  const guest = await signIn('guest');

  let code = '';
  let roomId = '';
  while (!roomId && remaining() > 0) {
    const created = await owner.rpc('create_room', { p_display_name: 'Проба', p_capacity: 2 });
    if (created.error) {
      note(`create_room failed (${created.error.message})`);
      await sleep(1_000);
      continue;
    }
    code = created.data;
    const room = await owner.from('rooms').select('id').eq('code', code).single();
    if (room.error) note(`room lookup failed (${room.error.message})`);
    else roomId = room.data.id;
  }
  if (!roomId) fail('could not create a probe room');

  await owner.realtime.setAuth();
  // Mutated from Realtime callbacks.
  const probe = { observed: false, subscribed: false };
  // Read through a function: TypeScript cannot see the callback mutations.
  const isObserved = () => probe.observed;
  owner
    .channel(`room:${roomId}`, {
      config: { private: true, postgres_changes_options: { wait: true } },
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
      (payload) => {
        if ((payload.new as { display_name?: string }).display_name === 'Сонда') {
          probe.observed = true;
          note(`event ${payload.eventType}`);
        }
      },
    )
    .subscribe((status, err) => {
      note(err ? `${status}(${err.message})` : status);
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) probe.subscribed = true;
    });

  try {
    // Keep producing a real change (join, then leave/rejoin) until one arrives.
    let inRoom = false;
    while (!isObserved() && remaining() > 0) {
      if (probe.subscribed) {
        const result = inRoom
          ? await guest.rpc('leave_room', { p_room_id: roomId })
          : await guest.rpc('join_room', { p_code: code, p_display_name: 'Сонда' });
        note(`${inRoom ? 'leave' : 'join'}: ${result.error?.message ?? 'ok'}`);
        if (!result.error) inRoom = !inRoom;
      }
      const deadline = Date.now() + PROBE_INTERVAL_MS;
      while (!isObserved() && Date.now() < deadline) await sleep(100);
    }
    if (!isObserved()) fail(`no change delivered within ${READY_TIMEOUT_MS} ms`);
    console.warn(`[realtime-ready] ok after ${Date.now() - started} ms (${steps.join(' → ')})`);
  } finally {
    await owner.removeAllChannels();
  }
}
