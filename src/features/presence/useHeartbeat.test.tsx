import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { RoomId } from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import * as roomsApi from '@/features/rooms/api/roomsApi';

import { useHeartbeat } from './useHeartbeat';

vi.mock('@/features/rooms/api/roomsApi', () => ({ sendHeartbeat: vi.fn() }));

describe('useHeartbeat', () => {
  it('reconciles the room, roster and game state with the server after every beat', async () => {
    vi.mocked(roomsApi.sendHeartbeat).mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const roomId = 'room-1' as RoomId;
    renderHook(() => useHeartbeat(roomId), { wrapper });

    await vi.waitFor(() => {
      const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
      // Room summary (phase/host — works even when Realtime is blocked), roster, game.
      expect(keys).toContain(JSON.stringify([...roomKeys.all, 'code']));
      expect(keys).toContain(JSON.stringify(roomKeys.members(roomId)));
      expect(keys).toContain(JSON.stringify(roomKeys.game(roomId)));
    });
  });
});
