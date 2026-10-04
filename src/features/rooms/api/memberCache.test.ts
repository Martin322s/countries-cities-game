import { describe, expect, it } from 'vitest';

import type { PlayerId } from '@/domain';

import { applyMemberRowChange, type MemberRowChange } from './memberCache';
import type { RoomMember } from './roomsApi';

const stoyan: RoomMember = {
  id: 'a' as PlayerId,
  displayName: 'Стоян',
  joinedAt: '2026-01-01T10:00:00Z',
  lastSeenAt: '2026-01-01T10:00:00Z',
};
const desi: RoomMember = {
  id: 'b' as PlayerId,
  displayName: 'Деси',
  joinedAt: '2026-01-01T10:01:00Z',
  lastSeenAt: '2026-01-01T10:01:00Z',
};

function row(member: RoomMember, overrides: Partial<MemberRowChange> = {}): MemberRowChange {
  return {
    player_id: member.id,
    display_name: member.displayName,
    joined_at: member.joinedAt,
    last_seen_at: member.lastSeenAt,
    left_at: null,
    ...overrides,
  };
}

describe('applyMemberRowChange', () => {
  it('adds a newly joined member in join order', () => {
    const result = applyMemberRowChange([desi], row(stoyan));
    expect(result.map((m) => m.displayName)).toEqual(['Стоян', 'Деси']);
  });

  it('updates an existing member in place without duplicating them (heartbeat / rejoin)', () => {
    const result = applyMemberRowChange(
      [stoyan, desi],
      row(desi, { last_seen_at: '2026-01-01T10:05:00Z' }),
    );
    expect(result).toHaveLength(2);
    expect(result[1]?.lastSeenAt).toBe('2026-01-01T10:05:00Z');
  });

  it('removes a member who left or whose seat expired', () => {
    const result = applyMemberRowChange(
      [stoyan, desi],
      row(desi, { left_at: '2026-01-01T10:06:00Z' }),
    );
    expect(result.map((m) => m.id)).toEqual(['a']);
  });

  it('moves a member who rejoined after leaving to the end (fresh join time)', () => {
    const result = applyMemberRowChange(
      [stoyan, desi],
      row(stoyan, { joined_at: '2026-01-01T11:00:00Z' }),
    );
    expect(result.map((m) => m.displayName)).toEqual(['Деси', 'Стоян']);
  });

  it('does not mutate the input array', () => {
    const members = [stoyan];
    applyMemberRowChange(members, row(desi));
    expect(members).toEqual([stoyan]);
  });
});
