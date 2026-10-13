import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import type { PlayerId } from '@/domain';
import { ConnectionIndicator } from '@/features/presence/ConnectionIndicator';
import { useNow } from '@/features/presence/useNow';
import type { RoomConnection } from '@/features/presence/useRoomConnection';
import type { RoomSummary } from '@/features/rooms/api/roomsApi';
import { useRoomMembers } from '@/features/rooms/hooks/useRoomQueries';
import { RoomChat } from '@/features/rooms/components/RoomChat';
import { Notice } from '@/shared/ui/Notice';

import { buildLobbyPlayers } from '../lobbyModel';
import { HostControls } from './HostControls';
import { LeaveRoomButton } from './LeaveRoomButton';
import { PlayerList } from './PlayerList';
import { RoomCodeCard } from './RoomCodeCard';

const STATUS_REFRESH_MS = 5_000;

interface LobbyViewProps {
  room: RoomSummary;
  playerId: PlayerId;
  live: RoomConnection;
}

export function LobbyView({ room, playerId, live }: LobbyViewProps) {
  const navigate = useNavigate();
  const { connection, onlinePlayerIds } = live;
  const members = useRoomMembers(room.id);
  const now = useNow(STATUS_REFRESH_MS);

  const players = useMemo(
    () =>
      members.data
        ? buildLobbyPlayers({
            members: members.data,
            hostPlayerId: room.hostPlayerId,
            currentPlayerId: playerId,
            currentPlayerConnected: connection === 'connected',
            onlinePlayerIds,
            now,
          })
        : undefined,
    [members.data, room.hostPlayerId, playerId, connection, onlinePlayerIds, now],
  );

  const isHost = room.hostPlayerId === playerId;

  return (
    <section
      aria-labelledby="lobby-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="lobby-title" className="font-display text-2xl font-black sm:text-3xl">
            Стая {room.code}
          </h1>
          <p className="text-sm text-fg-muted">
            {isHost ? 'Ти си хост на тази стая.' : 'Изчакваме играчите...'}
          </p>
        </div>
        <ConnectionIndicator state={connection} />
      </header>

      {connection === 'offline' || connection === 'reconnecting' ? (
        <Notice tone="warning">
          {connection === 'offline'
            ? 'Връзката е прекъсната. Оставаш в стаята — ще се свържем отново автоматично.'
            : 'Свързваме отново... Мястото ти в стаята е запазено.'}
        </Notice>
      ) : null}

      <RoomCodeCard code={room.code} />

      <RoomChat
        roomId={room.id}
        playerId={playerId}
        playerName={members.data?.find((member) => member.id === playerId)?.displayName ?? ''}
      />

      <div className="flex flex-col gap-6 rounded-panel bg-ink-900/40 glass p-5 sm:p-7">
        <PlayerList players={players} capacity={room.capacity} />
        {members.error && !members.data ? (
          <Notice tone="error">Неуспешно зареждане на играчите. Опитваме отново...</Notice>
        ) : null}
        <div className="border-t border-white/10 pt-6">
          <HostControls roomId={room.id} isHost={isHost} playerCount={players?.length ?? 0} />
        </div>
      </div>

      <div className="flex justify-center">
        <LeaveRoomButton
          roomId={room.id}
          code={room.code}
          isHost={isHost}
          onLeft={() => {
            void navigate('/', { replace: true });
          }}
        />
      </div>
    </section>
  );
}
