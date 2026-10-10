import { useCallback, useEffect, useRef, useState } from 'react';

import type { AnswerValues, CategoryId, RoomId, RoundId } from '@/domain';
import { toRoomError, type RoomErrorCode } from '@/features/rooms/api/roomErrors';

import { saveAnswers } from '../api/gameApi';

/** Debounce between the last keystroke and the server write. */
export const AUTOSAVE_DEBOUNCE_MS = 500;
const RETRY_DELAY_MS = 2_000;

/** Server answers that mean "no more writes for this round" — retrying is pointless. */
const CLOSED_CODES: ReadonlySet<RoomErrorCode> = new Set([
  'answers_locked',
  'round_over',
  'round_not_active',
  'not_participant',
  'not_member',
  'wrong_phase',
]);

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'retrying' | 'closed';

export type SaveAnswersFn = typeof saveAnswers;

interface UseAnswerDraftOptions {
  roomId: RoomId;
  roundId: RoundId;
  initial: AnswerValues;
  /** Injected for tests; defaults to the real RPC. */
  save?: SaveAnswersFn;
}

/**
 * Local answer state with debounced, ordered server persistence.
 *
 * - Typing updates local state instantly; changed categories are queued.
 * - After AUTOSAVE_DEBOUNCE_MS of quiet, queued categories are sent in one RPC.
 * - Writes are chained, so they reach the server in order.
 * - `flush()` sends immediately and resolves once everything queued is persisted
 *   (used before locking, near the deadline and on unmount).
 * - Network failures re-queue and retry; "round closed" answers stop saving.
 */
export function useAnswerDraft({
  roomId,
  roundId,
  initial,
  save = saveAnswers,
}: UseAnswerDraftOptions) {
  const [values, setValues] = useState<AnswerValues>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const dirty = useRef(new Map<CategoryId, string>());
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const closed = useRef(false);
  const persistRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const persist = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      if (closed.current || dirty.current.size === 0) return;
      const batch = Object.fromEntries(dirty.current) as Partial<Record<CategoryId, string>>;
      dirty.current.clear();
      setStatus('saving');
      try {
        await save(roomId, roundId, batch);
        setStatus(dirty.current.size > 0 ? 'pending' : 'saved');
      } catch (error) {
        if (CLOSED_CODES.has(toRoomError(error).code)) {
          closed.current = true;
          setStatus('closed');
          return;
        }
        // Re-queue what failed unless the player has typed something newer since.
        for (const [category, value] of Object.entries(batch) as [CategoryId, string][]) {
          if (!dirty.current.has(category)) dirty.current.set(category, value);
        }
        setStatus('retrying');
        timer.current = window.setTimeout(() => void persistRef.current(), RETRY_DELAY_MS);
      }
    });
    return chain.current;
  }, [roomId, roundId, save]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const setValue = useCallback((category: CategoryId, value: string) => {
    if (closed.current) return;
    setValues((current) => ({ ...current, [category]: value }));
    dirty.current.set(category, value);
    setStatus('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persistRef.current(), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  /** Stop saving (the round or this sheet is locked); pending edits are dropped. */
  const close = useCallback(() => {
    closed.current = true;
    window.clearTimeout(timer.current);
    dirty.current.clear();
  }, []);

  // Best effort on unmount (navigation, phase change). Correctness never depends on it.
  useEffect(
    () => () => {
      void persistRef.current();
    },
    [],
  );

  return { values, setValue, flush: persist, close, status };
}
