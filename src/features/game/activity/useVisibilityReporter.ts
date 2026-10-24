import { useEffect, useRef, useState } from 'react';

import { CATEGORY_IDS, type AnswerValues, type RoomId, type RoundId } from '@/domain';
import { getSupabaseClient } from '@/shared/lib/supabase';

import { reportVisibility } from '../api/activity';
import { TabVisibilityMonitor } from './tabVisibilityMonitor';

export const roundTabLockKey = (roomId: RoomId, roundId: RoundId) =>
  `round-tab-lock:${roomId}:${roundId}`;

function hasTabLock(roomId: RoomId, roundId: RoundId): boolean {
  try {
    return sessionStorage.getItem(roundTabLockKey(roomId, roundId)) !== null;
  } catch {
    return false;
  }
}

export function readLockedDraft(roomId: RoomId, roundId: RoundId): AnswerValues | null {
  try {
    const stored = sessionStorage.getItem(roundTabLockKey(roomId, roundId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const values = parsed as Record<string, unknown>;
    return CATEGORY_IDS.every((category) => typeof values[category] === 'string')
      ? (values as AnswerValues)
      : null;
  } catch {
    return null;
  }
}

/** Immediate local lock, keepalive server report and retries until acknowledged. */
export function useVisibilityReporter({
  roomId,
  roundId,
  active,
  onExit,
}: {
  roomId: RoomId;
  roundId: RoundId;
  active: boolean;
  onExit: () => AnswerValues | undefined;
}): boolean {
  const storageKey = roundTabLockKey(roomId, roundId);
  const [locked, setLocked] = useState(() => {
    return hasTabLock(roomId, roundId);
  });
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const isDisposed = () => disposed;
    let pending = hasTabLock(roomId, roundId);
    let snapshot = readLockedDraft(roomId, roundId) ?? undefined;
    let sending = false;
    let token: string | null = null;
    let retry: number | undefined;

    const send = async (unloading = false) => {
      if (disposed || sending || !pending) return;
      sending = true;
      try {
        if (!token) {
          const { data } = await getSupabaseClient().auth.getSession();
          token = data.session?.access_token ?? null;
        }
        if (!token) throw new Error('Session unavailable');
        await reportVisibility({
          roomId,
          roundId,
          visible: false,
          unloading,
          accessToken: token,
          ...(snapshot ? { answers: snapshot } : {}),
        });
        pending = false;
        // Keep the marker across refresh; focus never unlocks this round.
      } catch {
        if (!isDisposed()) retry = window.setTimeout(() => void send(), 2_000);
      } finally {
        sending = false;
      }
    };
    const auth = getSupabaseClient().auth;
    void auth.getSession().then(({ data }) => {
      if (!disposed) token = data.session?.access_token ?? null;
    });
    const { data } = auth.onAuthStateChange((_event, session) => {
      token = session?.access_token ?? null;
    });
    const monitor = new TabVisibilityMonitor({
      tabId: crypto.randomUUID(),
      doc: document,
      win: window,
      channel: null,
      now: () => Date.now(),
      lockOnExit: true,
      report: ({ unloading }) => {
        if (!pending) {
          snapshot = onExitRef.current();
          pending = true;
          try {
            sessionStorage.setItem(storageKey, snapshot ? JSON.stringify(snapshot) : 'locked');
          } catch {
            /* In-memory snapshot still retries without storage. */
          }
        }
        setLocked(true);
        void send(unloading);
      },
    });
    if (pending) {
      onExitRef.current();
      void send();
    }
    monitor.start();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      monitor.stop();
      data.subscription.unsubscribe();
    };
  }, [active, roomId, roundId, storageKey]);
  return locked;
}
