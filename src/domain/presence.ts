import { MEMBER_STALE_AFTER_MS } from './config';
import type { ConnectionStatus } from './models';

/**
 * Membership vs presence.
 *
 * - Membership ("belongs to the room") is server state: a `room_players` row whose
 *   `left_at` is null. It survives refreshes and short network drops.
 * - Presence ("this client is connected right now") comes from Realtime Presence and
 *   is fast but best-effort.
 * - The server heartbeat (`last_seen_at`) is the authority for slow decisions:
 *   host migration and seat expiry.
 *
 * The UI combines the two signals:
 *   in presence                          → connected
 *   not in presence, heartbeat is recent → reconnecting (brief drop, refresh, app switch)
 *   not in presence, heartbeat is stale  → disconnected
 */
export function deriveConnectionStatus(input: {
  inPresence: boolean;
  lastSeenAt: string;
  now: number;
}): ConnectionStatus {
  if (input.inPresence) return 'connected';
  const lastSeen = Date.parse(input.lastSeenAt);
  if (Number.isFinite(lastSeen) && input.now - lastSeen < MEMBER_STALE_AFTER_MS) {
    return 'reconnecting';
  }
  return 'disconnected';
}
