import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { RoomId, RoundId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import { getSupabaseClient } from '@/shared/lib/supabase';
import { Notice } from '@/shared/ui/Notice';

/** Any member can wake the worker; the server claims one job per round. */
export function AiValidationScreen({ roomId, roundId }: { roomId: RoomId; roundId: RoundId }) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const schedule = (callback: () => void) => {
      if (!disposed) timer = window.setTimeout(callback, 5_000);
    };
    const refreshUntilComplete = async () => {
      await queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
      schedule(() => void refreshUntilComplete());
    };
    const wakeWorker = async () => {
      try {
        const result = await getSupabaseClient().functions.invoke(
          'validate-round-answers',
          {
            body: { roomId, roundId },
          },
        );
        if (result.error) throw new Error('Validation request failed');
        const state =
          typeof result.data === 'object' && result.data !== null && 'state' in result.data
            ? result.data.state
            : null;
        if (state !== 'completed' && state !== 'already_running_or_finished') {
          throw new Error('Unexpected validation response');
        }
        if (disposed) return;
        setRetrying(false);
      } catch {
        if (disposed) return;
        setRetrying(true);
        await queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
        schedule(() => void wakeWorker());
        return;
      }
      await queryClient.invalidateQueries({ queryKey: roomKeys.game(roomId) });
      schedule(() => void refreshUntilComplete());
    };
    void wakeWorker();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [roomId, roundId, queryClient]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-panel bg-ink-900/40 p-6 text-center">
      <h1 className="font-display text-3xl font-black">ПРОВЕРКА НА ОТГОВОРИТЕ</h1>
      <p role="status" className="text-fg-muted">
        Всички са готови. Проверяваме заключените отговори...
      </p>
      {retrying ? (
        <Notice tone="warning">Проверката се забави. Опитваме отново автоматично.</Notice>
      ) : null}
    </div>
  );
}
