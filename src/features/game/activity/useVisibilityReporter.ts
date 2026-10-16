import { useEffect, useRef } from 'react';

import type { RoomId, RoundId } from '@/domain';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { reportVisibility } from '../api/activity';
import { TabVisibilityMonitor } from './tabVisibilityMonitor';

const CHANNEL_PREFIX = 'darzhavi-i-gradove.visibility';

/**
 * Reports this player's page visibility for the round while `active` (effective
 * PLAYING, a participant, answers not locked — see shouldMonitorVisibility). The
 * browser-facing logic lives in TabVisibilityMonitor; this hook wires it to the
 * page, to the player's other tabs (BroadcastChannel, scoped to the round) and to
 * the report RPC.
 */
export function useVisibilityReporter({
  roomId,
  roundId,
  active,
}: {
  roomId: RoomId;
  roundId: RoundId;
  active: boolean;
}): void {
  // Read ahead of time: an "away" sent while the page is being hidden or unloaded
  // cannot wait for an async session lookup.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const auth = getSupabaseClient().auth;
    let disposed = false;
    void auth.getSession().then(({ data }) => {
      if (!disposed) tokenRef.current = data.session?.access_token ?? null;
    });
    const { data } = auth.onAuthStateChange((_event, session) => {
      tokenRef.current = session?.access_token ?? null;
    });
    return () => {
      disposed = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const send = (accessToken: string, visible: boolean, unloading: boolean) => {
      void reportVisibility({ roomId, roundId, visible, unloading, accessToken });
    };

    const monitor = new TabVisibilityMonitor({
      tabId: crypto.randomUUID(),
      doc: document,
      win: window,
      channel:
        typeof BroadcastChannel === 'function'
          ? new BroadcastChannel(`${CHANNEL_PREFIX}:${roundId}`)
          : null,
      now: () => Date.now(),
      report: ({ visible, unloading }) => {
        const token = tokenRef.current;
        if (token) {
          send(token, visible, unloading);
          return;
        }
        // First report right after mount, before the session was read.
        void getSupabaseClient()
          .auth.getSession()
          .then(({ data }) => {
            if (data.session) send(data.session.access_token, visible, unloading);
          });
      },
    });
    monitor.start();
    return () => {
      monitor.stop();
    };
  }, [active, roomId, roundId]);
}
