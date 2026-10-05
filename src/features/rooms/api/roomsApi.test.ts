import { describe, expect, it, vi } from 'vitest';

import { roomErrorMessage } from './roomErrors';
import { joinRoom } from './roomsApi';

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({ getSupabaseClient: () => ({ rpc }) }));

describe('joinRoom', () => {
  it('turns the server’s NULL for an unknown code into "room not found"', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(joinRoom({ code: 'ZZZZZ', displayName: 'Деси' })).rejects.toMatchObject({
      code: 'room_not_found',
    });
  });

  it('returns the canonical code on success', async () => {
    rpc.mockResolvedValueOnce({ data: 'K7M4Q', error: null });
    await expect(joinRoom({ code: 'k7m4q', displayName: 'Деси' })).resolves.toBe('K7M4Q');
  });

  it('maps rate limiting to a calm message', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate_limited', hint: 'app_error', code: 'P0001', details: null },
    });
    await expect(joinRoom({ code: 'K7M4Q', displayName: 'Деси' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(roomErrorMessage('rate_limited', 'join')).toBe(
      'Твърде много заявки. Опитай отново след малко.',
    );
  });
});
