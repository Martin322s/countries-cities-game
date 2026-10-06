import { describe, expect, it } from 'vitest';

import { deriveConnectionState } from './connectionState';

const base = {
  browserOnline: true,
  channelStatus: 'subscribed' as const,
  everConnected: true,
  heartbeatFailing: false,
};

describe('deriveConnectionState', () => {
  it('is connected when realtime is subscribed and heartbeats succeed', () => {
    expect(deriveConnectionState(base)).toBe('connected');
  });

  it('is connecting before the first successful subscription', () => {
    expect(
      deriveConnectionState({ ...base, channelStatus: 'connecting', everConnected: false }),
    ).toBe('connecting');
  });

  it('is reconnecting after a realtime drop once we had been connected', () => {
    expect(deriveConnectionState({ ...base, channelStatus: 'error' })).toBe('reconnecting');
    expect(deriveConnectionState({ ...base, channelStatus: 'closed' })).toBe('reconnecting');
  });

  it('is reconnecting while heartbeats fail even if the socket looks fine', () => {
    expect(deriveConnectionState({ ...base, heartbeatFailing: true })).toBe('reconnecting');
  });

  it('is offline whenever the browser reports no network', () => {
    expect(deriveConnectionState({ ...base, browserOnline: false })).toBe('offline');
  });
});
