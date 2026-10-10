import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { RoomId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import { sendHeartbeat } from '@/features/rooms/api/roomsApi';

const NUDGE_INTERVAL_MS = 750;
const MAX_NUDGES = 12;

/**
 * When the screen has moved past an authoritative deadline (started_at / ends_at)
 * but the server state has not caught up yet, ask the server to apply due
 * transitions. A heartbeat runs `advance_game`, which decides from server time;
 * the client never decides anything itself. Any connected client may do this, so
 * no single (host) browser is required. Stops as soon as `lagging` turns false.
 */
export function useDeadlineNudge(roomId: RoomId, lagging: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!lagging) return;
    let attempts = 0;
    let disposed = false;

    const nudge = async () => {
      attempts += 1;
      try {
        await sendHeartbeat(roomId);
      } catch {
        // Ignore: the regular heartbeat and realtime will recover.
      }
      if (!disposed) await queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
    };

    void nudge();
    const intervalId = window.setInterval(() => {
      if (attempts >= MAX_NUDGES) {
        window.clearInterval(intervalId);
        return;
      }
      void nudge();
    }, NUDGE_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [roomId, lagging, queryClient]);
}
