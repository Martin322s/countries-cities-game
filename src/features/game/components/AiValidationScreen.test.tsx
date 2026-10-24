import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RoomId, RoundId } from '@/domain';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AiValidationScreen } from './AiValidationScreen';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/shared/lib/supabase', () => ({ getSupabaseClient: () => ({ functions: { invoke } }) }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('AI validation phase', () => {
  it('wakes the worker with identifiers only and has no answer or READY controls', async () => {
    invoke.mockResolvedValue({ error: null });
    const view = renderWithProviders(
      <AiValidationScreen roomId={'room' as RoomId} roundId={'round' as RoundId} />,
    );
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('validate-round-answers', {
        body: { roomId: 'room', roundId: 'round' },
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Проверяваме заключените отговори');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.unmount();
  });
  it('shows a retry message on worker failure and stops retries after unmount', async () => {
    invoke.mockResolvedValue({ error: new Error('offline') });
    const view = renderWithProviders(
      <AiValidationScreen roomId={'room' as RoomId} roundId={'round' as RoundId} />,
    );
    expect(await screen.findByText(/Опитваме отново автоматично/)).toBeVisible();
    vi.useFakeTimers();
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
