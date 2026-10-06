import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { HEARTBEAT_INTERVAL_MS, type RoomId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import { toRoomError } from '@/features/rooms/api/roomErrors';
import { sendHeartbeat } from '@/features/rooms/api/roomsApi';

/**
 * Server heartbeat for the current membership. The server uses `last_seen_at` for
 * slow, authoritative decisions (host grace period, lobby seat expiry) and runs room
 * maintenance on every beat — so no single client or `beforeunload` is relied upon.
 *
 * Beats immediately, every HEARTBEAT_INTERVAL_MS, and when the tab becomes visible
 * or the network returns. Each successful beat also reconciles the roster and game
 * state with the server (bounded staleness if a realtime event is lost). Returns `true` while heartbeats are failing.
 */
export function useHeartbeat(roomId: RoomId | null): boolean {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{ roomId: RoomId | null; failing: boolean }>({
    roomId: null,
    failing: false,
  });

  useEffect(() => {
    if (!roomId) return;
    let disposed = false;

    const beat = async () => {
      try {
        await sendHeartbeat(roomId);
        if (disposed) return;
        setFailure({ roomId, failing: false });
        // Safety net: realtime is best-effort and a burst of changes can occasionally go
        // undelivered (observed locally: a dozen joins within a second). Reconcile the
        // room (phase, host — e.g. LOBBY → game), the roster and the game state on every
        // beat, so nothing stays stale for more than one heartbeat — even when Realtime is
        // blocked entirely (proxies). Only queries on screen refetch; realtime remains the
        // fast path.
        void queryClient.invalidateQueries({ queryKey: [...roomKeys.all, 'code'] });
        void queryClient.invalidateQueries({ queryKey: roomKeys.members(roomId) });
        void queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
      } catch (error) {
        if (disposed) return;
        if (toRoomError(error).code === 'not_member') {
          // Seat is gone (left in another tab, or expired): re-check membership.
          void queryClient.invalidateQueries({ queryKey: roomKeys.all });
          return;
        }
        setFailure({ roomId, failing: true });
      }
    };

    const beatWhenVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };

    void beat();
    const intervalId = window.setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', beatWhenVisible);
    window.addEventListener('online', beatWhenVisible);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', beatWhenVisible);
      window.removeEventListener('online', beatWhenVisible);
    };
  }, [roomId, queryClient]);

  return failure.roomId === roomId && failure.failing;
}
