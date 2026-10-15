import type { AwayEndReason, AwayInterval, AwaySource, PlayerId, RoomId, RoundId } from '@/domain';
import { callBackend } from '@/features/rooms/api/roomsApi';
import { RoomError } from '@/features/rooms/api/roomErrors';
import { getSupabaseEnv } from '@/shared/lib/env';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { recordClockSample } from '../clock/serverClock';

/*
 * Fair-play activity of a round: when participants' game pages were hidden. The
 * server decides identity, round and every timestamp; the client only says
 * "my page is hidden / visible again".
 */

export interface RoundActivity {
  roundId: RoundId;
  intervals: AwayInterval[];
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function malformed(field: string): never {
  throw new RoomError('unknown', `Malformed round activity: ${field}`);
}

function time(object: JsonObject, key: string, optional: true): number | null;
function time(object: JsonObject, key: string, optional?: false): number;
function time(object: JsonObject, key: string, optional = false): number | null {
  const value = object[key];
  if (value === null || value === undefined) return optional ? null : malformed(key);
  if (typeof value !== 'string') return malformed(key);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : malformed(key);
}

const SOURCES: readonly string[] = ['visibility', 'unload'];
const END_REASONS: readonly string[] = ['returned', 'round_ended', 'answers_locked'];

function parseInterval(value: unknown): AwayInterval {
  if (!isObject(value)) return malformed('event');
  const { id, player_id: playerId, source, ended_by: endedBy } = value;
  if (typeof id !== 'number') return malformed('event.id');
  if (typeof playerId !== 'string') return malformed('event.player_id');
  if (typeof source !== 'string') return malformed('event.source');
  if (endedBy !== null && (typeof endedBy !== 'string' || !END_REASONS.includes(endedBy))) {
    return malformed('event.ended_by');
  }
  return {
    id,
    playerId: playerId as PlayerId,
    // Legacy enum values ('blur', 'presence') are never written; treat them as plain hides.
    source: (SOURCES.includes(source) ? source : 'visibility') as AwaySource,
    awayAt: time(value, 'away_at'),
    returnedAt: time(value, 'returned_at', true),
    endedBy: endedBy as AwayEndReason | null,
    capAt: time(value, 'cap_at', true),
  };
}

export function parseRoundActivity(value: unknown): RoundActivity & { serverNow: number } {
  if (!isObject(value)) return malformed('root');
  const { round_id: roundId, events } = value;
  if (typeof roundId !== 'string') return malformed('round_id');
  if (!Array.isArray(events)) return malformed('events');
  return {
    roundId: roundId as RoundId,
    serverNow: time(value, 'server_now'),
    intervals: events.map(parseInterval),
  };
}

export function fetchRoundActivity(roomId: RoomId, roundId: RoundId): Promise<RoundActivity> {
  return callBackend(async () => {
    const requestStart = Date.now();
    const { data, error } = await getSupabaseClient().rpc('get_round_activity', {
      p_room_id: roomId,
      p_round_id: roundId,
    });
    const requestEnd = Date.now();
    if (error) throw error;
    const { serverNow, ...activity } = parseRoundActivity(data);
    recordClockSample({ serverMs: serverNow, requestStart, requestEnd });
    return activity;
  });
}

/**
 * Reports this player's page visibility. Sent with `fetch(..., { keepalive: true })`
 * rather than through supabase-js, so an "away" sent from visibilitychange/pagehide
 * still reaches the server when a phone suspends the page or the tab is unloading.
 * The access token is passed in by the caller (read ahead of time: there is no time
 * to await a session lookup while a page is being hidden).
 *
 * Fire-and-forget by design: a lost report only means one fewer informational entry.
 */
export async function reportVisibility(input: {
  roomId: RoomId;
  roundId: RoundId;
  visible: boolean;
  unloading?: boolean;
  accessToken: string;
}): Promise<void> {
  const env = getSupabaseEnv();
  if (!env.ok) return;
  try {
    await fetch(`${env.env.supabaseUrl}/rest/v1/rpc/report_visibility`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: env.env.supabasePublishableKey,
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        p_room_id: input.roomId,
        p_round_id: input.roundId,
        p_visible: input.visible,
        p_unloading: input.unloading ?? false,
      }),
    });
  } catch (error) {
    // Offline or unloading: nothing to recover — visibility is best-effort.
    if (import.meta.env.DEV) console.warn('Visibility report failed', error);
  }
}
