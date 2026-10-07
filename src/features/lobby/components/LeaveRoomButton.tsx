import { useState } from 'react';

import type { RoomId } from '@/domain';
import { roomErrorMessage } from '@/features/rooms/api/roomErrors';
import { useLeaveRoom } from '@/features/rooms/hooks/useRoomMutations';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { LeaveIcon } from '@/shared/ui/icons';
import { Notice } from '@/shared/ui/Notice';

interface LeaveRoomButtonProps {
  roomId: RoomId;
  code: string;
  isHost: boolean;
  /** Leaving a running game keeps your answers; the copy explains that. */
  inGame?: boolean;
  onLeft: () => void;
}

function leaveDescription(isHost: boolean, inGame: boolean): string {
  const host = isHost ? ' Ролята на хост ще премине автоматично към следващия играч.' : '';
  if (inGame) {
    return `Отговорите ти до момента остават в играта, но в този рунд няма да можеш да пишеш повече. Можеш да се върнеш със същия код.${host}`;
  }
  return isHost
    ? 'Ти си хост. Ролята ще премине автоматично към следващия играч.'
    : 'Можеш да се върнеш по-късно със същия код, докато стаята чака играчи.';
}

export function LeaveRoomButton({
  roomId,
  code,
  isHost,
  inGame = false,
  onLeft,
}: LeaveRoomButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const leave = useLeaveRoom();

  const close = () => {
    if (leave.isPending) return;
    setConfirming(false);
    leave.reset();
  };

  return (
    <>
      <Button
        variant="ghost"
        icon={<LeaveIcon />}
        onClick={() => {
          setConfirming(true);
        }}
      >
        НАПУСНИ СТАЯТА
      </Button>
      <Dialog
        open={confirming}
        onClose={close}
        title="Да напуснеш ли стаята?"
        description={leaveDescription(isHost, inGame)}
      >
        <div className="flex flex-col gap-4">
          {leave.error ? (
            <Notice tone="error">{roomErrorMessage(leave.error.code, 'leave')}</Notice>
          ) : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={close} disabled={leave.isPending}>
              Остани
            </Button>
            <Button
              onClick={() => {
                leave.mutate({ roomId, code }, { onSuccess: onLeft });
              }}
              disabled={leave.isPending}
              aria-busy={leave.isPending}
            >
              {leave.isPending ? 'Напускане...' : 'Напусни'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
