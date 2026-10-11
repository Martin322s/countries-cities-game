import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { LeaveRoomButton } from '@/features/lobby/components/LeaveRoomButton';
import { ConnectionIndicator } from '@/features/presence/ConnectionIndicator';
import type { ConnectionState } from '@/features/presence/connectionState';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';
import { cn } from '@/shared/lib/cn';

interface GameFrameProps {
  room: RoomSummary;
  isHost: boolean;
  connection: ConnectionState;
  roundNumber: number | null;
  /** Results need the full width for 9 columns. */
  wide?: boolean;
  children: ReactNode;
}

/** Shared chrome for every in-game screen: round label, connection, leave. */
export function GameFrame({
  room,
  isHost,
  connection,
  roundNumber,
  wide = false,
  children,
}: GameFrameProps) {
  const navigate = useNavigate();
  return (
    <section
      className={cn('mx-auto flex w-full flex-col gap-5 px-4', wide ? 'max-w-7xl' : 'max-w-3xl')}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-[0.25em] text-fg-subtle uppercase">
          Стая {room.code}
          {roundNumber !== null ? <> · Рунд {roundNumber}</> : null}
        </p>
        <ConnectionIndicator state={connection} />
      </header>
      {children}
      <footer className="flex justify-center pt-2">
        <LeaveRoomButton
          roomId={room.id}
          code={room.code}
          isHost={isHost}
          inGame
          onLeft={() => {
            void navigate('/', { replace: true });
          }}
        />
      </footer>
    </section>
  );
}
