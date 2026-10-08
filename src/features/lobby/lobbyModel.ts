import { deriveConnectionStatus, type ConnectionStatus, type PlayerId } from '@/domain';
import type { RoomMember } from '@/features/rooms/api/roomsApi';

export interface LobbyPlayer {
  id: PlayerId;
  displayName: string;
  isHost: boolean;
  isYou: boolean;
  status: ConnectionStatus;
}

/**
 * View model for the lobby roster. Join order is preserved (it is also the host
 * election order). The local player's status follows their own connection state,
 * because a client is never in its own presence list before subscribing.
 */
export function buildLobbyPlayers(input: {
  members: readonly RoomMember[];
  hostPlayerId: PlayerId;
  currentPlayerId: PlayerId;
  currentPlayerConnected: boolean;
  onlinePlayerIds: ReadonlySet<PlayerId>;
  now: number;
}): LobbyPlayer[] {
  return input.members.map((member) => {
    const isYou = member.id === input.currentPlayerId;
    return {
      id: member.id,
      displayName: member.displayName,
      isHost: member.id === input.hostPlayerId,
      isYou,
      status: isYou
        ? input.currentPlayerConnected
          ? 'connected'
          : 'reconnecting'
        : deriveConnectionStatus({
            inPresence: input.onlinePlayerIds.has(member.id),
            lastSeenAt: member.lastSeenAt,
            now: input.now,
          }),
    };
  });
}
