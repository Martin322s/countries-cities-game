import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyAnswers, type RoomId, type RoundId } from '@/domain';
import { RoomError } from '@/features/rooms/api/roomErrors';

import { AUTOSAVE_DEBOUNCE_MS, useAnswerDraft, type SaveAnswersFn } from './useAnswerDraft';

const roomId = 'room' as RoomId;
const roundId = 'round' as RoundId;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(save: SaveAnswersFn) {
  return renderHook(() => useAnswerDraft({ roomId, roundId, initial: emptyAnswers(), save }));
}

describe('useAnswerDraft', () => {
  it('updates locally at once and persists one batched write after the debounce', async () => {
    const save = vi.fn<SaveAnswersFn>().mockResolvedValue(undefined);
    const { result } = setup(save);

    act(() => {
      result.current.setValue('country', 'М');
      result.current.setValue('country', 'Ма');
      result.current.setValue('city', 'Монтана');
    });
    expect(result.current.values.country).toBe('Ма');
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(roomId, roundId, { country: 'Ма', city: 'Монтана' });
    expect(result.current.status).toBe('saved');
  });

  it('flush() writes immediately (used before locking)', async () => {
    const save = vi.fn<SaveAnswersFn>().mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => {
      result.current.setValue('name', 'Мария');
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledWith(roomId, roundId, { name: 'Мария' });
  });

  it('re-queues and retries after a network failure', async () => {
    const save = vi
      .fn<SaveAnswersFn>()
      .mockRejectedValueOnce(new RoomError('network'))
      .mockResolvedValue(undefined);
    const { result } = setup(save);
    act(() => {
      result.current.setValue('plant', 'Мак');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('retrying');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(roomId, roundId, { plant: 'Мак' });
    expect(result.current.status).toBe('saved');
  });

  it('stops saving once the server says the round is closed', async () => {
    const save = vi.fn<SaveAnswersFn>().mockRejectedValue(new RoomError('round_over'));
    const { result } = setup(save);
    act(() => {
      result.current.setValue('object', 'Маса');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('closed');
    act(() => {
      result.current.setValue('object', 'Молив');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.values.object).toBe('Маса');
  });
});
