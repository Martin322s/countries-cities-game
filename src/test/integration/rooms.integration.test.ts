/**
 * Integration tests against a REAL local Supabase stack (npx supabase start).
 * Run with:  npm run test:integration
 *
 * These exercise what unit and pgTAP tests cannot: real concurrency across separate
 * connections, the public API surface (PostgREST + RLS) and Realtime delivery.
 */
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import type { Database } from '@/shared/lib/database.types';

type Client = SupabaseClient<Database>;

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const clients: Client[] = [];

async function anonymousPlayer(): Promise<{ client: Client; id: string }> {
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${String(error)}`);
  clients.push(client);
  return { client, id: data.user.id };
}

async function createRoom(client: Client, name: string, capacity: number): Promise<string> {
  const { data, error } = await client.rpc('create_room', {
    p_display_name: name,
    p_capacity: capacity,
  });
  if (error) throw new Error(error.message);
  return data;
}

function joinOutcome(client: Client, code: string, name: string) {
  return client
    .rpc('join_room', { p_code: code, p_display_name: name })
    .then(({ error }) => (error ? error.message : 'joined'));
}

async function roomId(client: Client, code: string): Promise<string> {
  const { data, error } = await client.from('rooms').select('id').eq('code', code).single();
  if (error) throw new Error(error.message);
  return data.id;
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.removeAllChannels()));
});

describe.skipIf(!url || !key)('rooms against local Supabase', () => {
  it('lets exactly one of many concurrent joiners take the last seat', async () => {
    const host = await anonymousPlayer();
    const code = await createRoom(host.client, 'Хост', 2);
    const racers = await Promise.all(Array.from({ length: 6 }, () => anonymousPlayer()));

    const outcomes = await Promise.all(
      racers.map((racer, index) => joinOutcome(racer.client, code, `Играч ${index}`)),
    );

    expect(outcomes.filter((outcome) => outcome === 'joined')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'room_full')).toHaveLength(5);
    const { count } = await host.client
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .is('left_at', null);
    expect(count).toBe(2);
  });

  it('accepts a display name only once under concurrent joins', async () => {
    const host = await anonymousPlayer();
    const code = await createRoom(host.client, 'Хост', 15);
    const racers = await Promise.all(Array.from({ length: 5 }, () => anonymousPlayer()));

    const outcomes = await Promise.all(
      racers.map((racer, index) => joinOutcome(racer.client, code, index % 2 ? 'ДЕСИ' : 'деси')),
    );

    expect(outcomes.filter((outcome) => outcome === 'joined')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'display_name_taken')).toHaveLength(4);
  });

  it('treats repeated joins by the same identity as a rejoin', async () => {
    const host = await anonymousPlayer();
    const code = await createRoom(host.client, 'Стоян', 4);

    await Promise.all([
      joinOutcome(host.client, code, 'Стоян'),
      joinOutcome(host.client, code, 'Стоян'),
      joinOutcome(host.client, code.toLowerCase(), 'Друго'),
    ]);

    const { data } = await host.client.from('room_players').select('player_id, display_name');
    expect(data).toEqual([{ player_id: host.id, display_name: 'Стоян' }]);
  });

  it('hides rooms from non-members and rejects direct writes', async () => {
    const host = await anonymousPlayer();
    const outsider = await anonymousPlayer();
    const code = await createRoom(host.client, 'Стоян', 4);
    const id = await roomId(host.client, code);

    const rooms = await outsider.client.from('rooms').select('id').eq('code', code);
    expect(rooms.data).toEqual([]);
    const members = await outsider.client.from('room_players').select('*').eq('room_id', id);
    expect(members.data).toEqual([]);

    const hijack = await host.client
      .from('rooms')
      .update({ host_player_id: outsider.id })
      .eq('id', id);
    expect(hijack.error?.code).toBe('42501');

    const insert = await outsider.client.from('room_players').insert({
      room_id: id,
      player_id: outsider.id,
      display_name: 'Хакер',
      display_name_key: 'хакер',
    });
    expect(insert.error?.code).toBe('42501');
  });

  it('migrates host atomically when the host leaves', async () => {
    const host = await anonymousPlayer();
    const guest = await anonymousPlayer();
    const code = await createRoom(host.client, 'Стоян', 4);
    expect(await joinOutcome(guest.client, code, 'Деси')).toBe('joined');
    const id = await roomId(host.client, code);

    const { error } = await host.client.rpc('leave_room', { p_room_id: id });
    expect(error).toBeNull();

    const { data } = await guest.client.from('rooms').select('host_player_id').single();
    expect(data?.host_player_id).toBe(guest.id);
  });

  it('delivers membership changes over realtime and protects the private channel', async () => {
    const host = await anonymousPlayer();
    const guest = await anonymousPlayer();
    const outsider = await anonymousPlayer();
    const code = await createRoom(host.client, 'Стоян', 4);
    const id = await roomId(host.client, code);

    // Member subscribes and waits for the guest's INSERT.
    await host.client.realtime.setAuth();
    const joined = new Promise<string>((resolve) => {
      host.client
        .channel(`room:${id}`, {
          config: { private: true, postgres_changes_options: { wait: true } },
        })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_players', filter: `room_id=eq.${id}` },
          (payload) => {
            // The host's own creation INSERT may also arrive late; wait for the guest.
            const name = (payload.new as { display_name: string }).display_name;
            if (name === 'Деси') resolve(name);
          },
        )
        .subscribe((status) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
            void joinOutcome(guest.client, code, 'Деси');
        });
    });
    await expect(joined).resolves.toBe('Деси');

    // A non-member is refused on the private room channel (RLS on realtime.messages).
    await outsider.client.realtime.setAuth();
    const outsiderResult = await new Promise<{ status: string; message: string }>((resolve) => {
      outsider.client
        .channel(`room:${id}`, { config: { private: true } })
        .subscribe((status, error) => {
          resolve({ status, message: error?.message ?? '' });
        });
    });
    expect(outsiderResult.status).toBe('CHANNEL_ERROR');
    expect(outsiderResult.message).toMatch(/Unauthorized/);
  }, 30_000);
});
