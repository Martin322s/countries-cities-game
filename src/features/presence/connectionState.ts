/** Lifecycle of the room's realtime channel. */
export type ChannelStatus = 'connecting' | 'subscribed' | 'error' | 'closed';

/** What the player is told about their own connection. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * Combines browser, realtime and heartbeat signals into one user-facing state.
 * Brief drops show "reconnecting" — they never remove the player from the room.
 */
export function deriveConnectionState(input: {
  browserOnline: boolean;
  channelStatus: ChannelStatus;
  everConnected: boolean;
  heartbeatFailing: boolean;
}): ConnectionState {
  if (!input.browserOnline) return 'offline';
  if (input.channelStatus === 'subscribed' && !input.heartbeatFailing) return 'connected';
  if (!input.everConnected) return 'connecting';
  return 'reconnecting';
}

export const CONNECTION_STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: 'Свързване...',
  connected: 'Свързан',
  reconnecting: 'Свързваме отново...',
  offline: 'Връзката е прекъсната',
};
