import { describe, expect, it } from 'vitest';

import { MEMBER_STALE_AFTER_MS } from './config';
import { deriveConnectionStatus } from './presence';

const now = Date.parse('2026-01-01T12:00:00Z');
const secondsAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe('deriveConnectionStatus', () => {
  it('is connected whenever the client is in realtime presence', () => {
    expect(deriveConnectionStatus({ inPresence: true, lastSeenAt: secondsAgo(600), now })).toBe(
      'connected',
    );
  });

  it('is reconnecting after a brief drop while the heartbeat is still fresh', () => {
    expect(deriveConnectionStatus({ inPresence: false, lastSeenAt: secondsAgo(5), now })).toBe(
      'reconnecting',
    );
  });

  it('is disconnected once the heartbeat is older than the stale threshold', () => {
    const stale = secondsAgo(MEMBER_STALE_AFTER_MS / 1000 + 1);
    expect(deriveConnectionStatus({ inPresence: false, lastSeenAt: stale, now })).toBe(
      'disconnected',
    );
  });

  it('treats an unparseable timestamp as disconnected', () => {
    expect(deriveConnectionStatus({ inPresence: false, lastSeenAt: 'nope', now })).toBe(
      'disconnected',
    );
  });
});
