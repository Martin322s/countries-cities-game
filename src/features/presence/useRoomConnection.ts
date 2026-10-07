import type { PlayerId, RoomId } from '@/domain';

import { deriveConnectionState, type ConnectionState } from './connectionState';
import { useBrowserOnline } from './useBrowserOnline';
import { useHeartbeat } from './useHeartbeat';
import { useRoomChannel } from './useRoomChannel';

export interface RoomConnection {
  connection: ConnectionState;
  onlinePlayerIds: ReadonlySet<PlayerId>;
}

/**
 * Everything "live" about a room membership, mounted once per room view:
 * realtime channel (changes + presence), server heartbeat and browser network state.
 */
export function useRoomConnection(
  roomId: RoomId | null,
  playerId: PlayerId | null,
): RoomConnection {
  const channel = useRoomChannel(roomId, playerId);
  const heartbeatFailing = useHeartbeat(roomId);
  const browserOnline = useBrowserOnline();

  return {
    connection: deriveConnectionState({
      browserOnline,
      channelStatus: channel.status,
      everConnected: channel.everConnected,
      heartbeatFailing,
    }),
    onlinePlayerIds: channel.onlinePlayerIds,
  };
}
