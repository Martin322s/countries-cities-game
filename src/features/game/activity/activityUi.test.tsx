import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROUND_DURATION_MS,
  type AwayInterval,
  type PlayerId,
  type RoomId,
  type RoundId,
  type RoundParticipant,
} from '@/domain';
import { roomKeys } from '@/features/rooms/api/queryKeys';
import { renderWithProviders, TEST_PLAYER_ID } from '@/test/renderWithProviders';

import * as activityApi from '../api/activity';
import * as gameApi from '../api/gameApi';
import type { GameRound } from '../api/gameState';
import { recordClockSample, resetServerClock } from '../clock/serverClock';
import { PlayingScreen } from '../components/PlayingScreen';
import { RoundActivitySummary } from './components/ActivityPanel';

vi.mock('../api/gameApi', () => ({
  fetchOwnAnswers: vi.fn(),
  saveAnswers: vi.fn(),
  lockAnswers: vi.fn(),
}));
vi.mock('../api/activity', () => ({
  fetchRoundActivity: vi.fn(),
  reportVisibility: vi.fn(),
}));
vi.mock('@/shared/lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'token-1' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  }),
}));

const roomId = 'room-1' as RoomId;
const roundId = 'round-1' as RoundId;
const DESI = 'player-desi' as PlayerId;
const KALOYAN = 'player-kaloyan' as PlayerId;

function participant(id: PlayerId, name: string, overrides: Partial<RoundParticipant> = {}) {
  return {
    playerId: id,
    displayName: name,
    joinedAt: '2026-01-01T11:00:00Z',
    lastSeenAt: new Date().toISOString(),
    left: false,
    roundReady: true,
    answersLockedAt: null,
    answersLockReason: null,
    resultsReady: false,
    ...overrides,
  } satisfies RoundParticipant;
}

let nextId = 1;
function interval(playerId: PlayerId, awayAgoMs: number, returnedAgoMs: number | null = null) {
  const now = Date.now();
  return {
    id: nextId++,
    playerId,
    source: 'visibility',
    awayAt: now - awayAgoMs,
    returnedAt: returnedAgoMs === null ? null : now - returnedAgoMs,
    endedBy: returnedAgoMs === null ? null : 'returned',
    capAt: now + 60_000,
  } satisfies AwayInterval;
}

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  sessionStorage.clear();
  resetServerClock();
  const local = Date.now();
  recordClockSample({ serverMs: local, requestStart: local, requestEnd: local });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  vi.mocked(gameApi.fetchOwnAnswers).mockResolvedValue({});
  vi.mocked(activityApi.reportVisibility).mockResolvedValue(undefined);
  vi.mocked(activityApi.fetchRoundActivity).mockResolvedValue({ roundId, intervals: [] });
});
afterEach(() => {
  vi.clearAllMocks();
});

function renderPlaying(me: Partial<RoundParticipant> = {}) {
  const startedAt = Date.now() - 10_000;
  const round: GameRound & { timeline: { startedAt: number; endsAt: number } } = {
    id: roundId,
    number: 3,
    letter: 'М',
    timeline: {
      countdownAt: startedAt - 3_000,
      startedAt,
      endsAt: startedAt + ROUND_DURATION_MS,
      lockedAt: null,
      revealAt: null,
    },
    lockReason: null,
  };
  return renderWithProviders(
    <PlayingScreen
      roomId={roomId}
      playerId={TEST_PLAYER_ID}
      hostPlayerId={TEST_PLAYER_ID}
      round={round}
      participants={[
        participant(TEST_PLAYER_ID, 'Стоян', me),
        participant(DESI, 'Деси'),
        participant(KALOYAN, 'Калоян'),
      ]}
      onlinePlayerIds={new Set([DESI, KALOYAN])}
      timeUp={false}
    />,
  );
}

const reports = () =>
  vi
    .mocked(activityApi.reportVisibility)
    .mock.calls.map(([input]) => (input.visible ? 'return' : 'away'));

describe('visibility reporting during PLAYING', () => {
  it('locks on tab exit, sends one snapshot and stays locked on return', async () => {
    renderPlaying();
    await screen.findByLabelText('Държава');
    fireEvent.change(screen.getByLabelText('Държава'), { target: { value: 'Малта' } });
    expect(reports()).toEqual([]);
    act(() => {
      setVisibility('hidden');
    });
    act(() => {
      setVisibility('visible');
    });
    await vi.waitFor(() => {
      expect(reports()).toEqual(['away']);
    });
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAttribute('readonly');
    expect(screen.getByText(/Полетата ви са заключени до края на този рунд/)).toBeVisible();
    expect(vi.mocked(activityApi.reportVisibility).mock.calls[0]?.[0]).toMatchObject({
      roomId,
      roundId,
      visible: false,
      unloading: false,
      accessToken: 'token-1',
    });
    expect(vi.mocked(activityApi.reportVisibility).mock.calls[0]?.[0].answers?.country).toBe(
      'Малта',
    );
    expect(gameApi.saveAnswers).not.toHaveBeenCalled();
  });

  it('stops monitoring once the player locked their answers (READY)', async () => {
    renderPlaying({ answersLockedAt: new Date().toISOString(), answersLockReason: 'ready' });
    await screen.findByLabelText('Държава');
    act(() => {
      setVisibility('hidden');
    });
    act(() => {
      setVisibility('visible');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(activityApi.reportVisibility).not.toHaveBeenCalled();
  });

  it('locks on blur immediately and ignores duplicate blur/visibility/focus events', async () => {
    renderPlaying();
    await screen.findByLabelText('Държава');
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('blur'));
      setVisibility('hidden');
      setVisibility('visible');
      window.dispatchEvent(new Event('focus'));
    });
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAttribute('readonly');
    await vi.waitFor(() => {
      expect(reports()).toEqual(['away']);
    });
    expect(gameApi.saveAnswers).not.toHaveBeenCalled();
  });

  it('retries a failed lock with the original snapshot', async () => {
    vi.mocked(activityApi.reportVisibility).mockRejectedValueOnce(new Error('offline'));
    renderPlaying();
    await screen.findByLabelText('Държава');
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await vi.waitFor(() => {
      expect(activityApi.reportVisibility).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(
      () => {
        expect(activityApi.reportVisibility).toHaveBeenCalledTimes(2);
      },
      {
        timeout: 3_000,
      },
    );
    const calls = vi.mocked(activityApi.reportVisibility).mock.calls;
    expect(calls[1]?.[0].answers).toEqual(calls[0]?.[0].answers);
    expect(screen.getByLabelText('Държава')).toHaveAttribute('readonly');
  });

  it('preserves the locked snapshot after remounting the same round', async () => {
    const view = renderPlaying();
    const input = await screen.findByLabelText('Държава');
    fireEvent.change(input, { target: { value: 'Малта' } });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await vi.waitFor(() => {
      expect(activityApi.reportVisibility).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    renderPlaying();
    const restored = await screen.findByLabelText('Държава');
    expect(restored).toHaveValue('Малта');
    expect(restored).toHaveAttribute('readonly');
  });

  it('locks even while persisted answers are still loading, without overwriting them', async () => {
    let resolveAnswers: (answers: { country: string }) => void = () => undefined;
    vi.mocked(gameApi.fetchOwnAnswers).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAnswers = resolve;
      }),
    );
    renderPlaying();
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await vi.waitFor(() => {
      expect(activityApi.reportVisibility).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(activityApi.reportVisibility).mock.calls[0]?.[0].answers).toBeUndefined();
    await act(async () => {
      resolveAnswers({ country: 'Мароко' });
      await Promise.resolve();
    });
    const restored = await screen.findByLabelText('Държава');
    expect(restored).toHaveValue('Мароко');
    expect(restored).toHaveAttribute('readonly');
  });
});

describe('live activity for the other players', () => {
  it('marks a player who is away past the threshold, with the elapsed server time', async () => {
    vi.mocked(activityApi.fetchRoundActivity).mockResolvedValue({
      roundId,
      intervals: [interval(DESI, 8_200), interval(KALOYAN, 1_000)],
    });
    renderPlaying();
    const list = await screen.findByRole('list', { name: 'Кой е готов' });
    const desi = within(list).getByText('Деси').closest('li')!;
    expect(await within(desi).findByText(/извън играта · 8 сек\./)).toBeInTheDocument();
    // 1 s away is below the threshold: nothing shown yet.
    expect(within(list).getByText('Калоян').closest('li')).not.toHaveTextContent('извън играта');
  });

  it('summarizes meaningful absences in the АКТИВНОСТ panel', async () => {
    vi.mocked(activityApi.fetchRoundActivity).mockResolvedValue({
      roundId,
      intervals: [
        interval(DESI, 40_000, 34_000), // 6 s
        interval(DESI, 20_000, 15_000), // 5 s
        interval(DESI, 9_000, 7_900), // 1.1 s — not meaningful
        interval(KALOYAN, 8_000), // away right now
      ],
    });
    renderPlaying();
    const panel = (await screen.findByText('Активност')).closest('details')!;
    expect(await within(panel).findByText(/2 излизания · общо 11 сек\./)).toBeInTheDocument();
    expect(within(panel).getByText(/извън играта сега · 8 сек\./)).toBeInTheDocument();
    expect(within(panel).getByText(/не и причината/)).toBeInTheDocument();
  });

  it('says so when nobody left the game', async () => {
    renderPlaying();
    const panel = (await screen.findByText('Активност')).closest('details')!;
    expect(
      await within(panel).findByText('Няма отчетени излизания в този рунд.'),
    ).toBeInTheDocument();
  });
});

describe('activity notifications', () => {
  it('announces a meaningful return, ignores a blip, and never replays history', async () => {
    vi.mocked(activityApi.fetchRoundActivity).mockResolvedValue({
      roundId,
      intervals: [interval(KALOYAN, 50_000, 40_000)], // before this screen: not replayed
    });
    const { queryClient } = renderPlaying();
    await screen.findByLabelText('Държава');
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(roomKeys.activity(roomId, roundId))).toBeDefined();
    });
    const header = () => screen.getByText(/Рунд 3/).closest<HTMLElement>('.relative')!;
    expect(header()).not.toHaveTextContent('Калоян');

    const update = (intervals: AwayInterval[]) => {
      act(() => {
        queryClient.setQueryData(roomKeys.activity(roomId, roundId), { roundId, intervals });
      });
    };
    const base = queryClient.getQueryData<{ intervals: AwayInterval[] }>(
      roomKeys.activity(roomId, roundId),
    )!.intervals;

    update([...base, interval(DESI, 1_500, 0)]); // 1.5 s blip
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(header()).not.toHaveTextContent('Деси');

    update([...base, interval(DESI, 6_400, 0)]);
    expect(await within(header()).findByText('Деси се върна след 6 сек.')).toBeInTheDocument();
    expect(
      within(header()).getByText('Деси се върна след 6 сек.').closest('[aria-live]'),
    ).toHaveAttribute('aria-live', 'polite');
  });

  it('tells the returning player only a neutral note about themselves', async () => {
    const { queryClient } = renderPlaying();
    // The first (empty) snapshot has loaded: it is the baseline, not news.
    expect(await screen.findByText('Няма отчетени излизания в този рунд.')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(roomKeys.activity(roomId, roundId), {
        roundId,
        intervals: [interval(TEST_PLAYER_ID, 6_100, 0)],
      });
    });
    expect(await screen.findByText('Отсъства 6 сек.')).toBeInTheDocument();
  });
});

describe('RoundActivitySummary (results)', () => {
  it('lists every participant, with or without absences', async () => {
    vi.mocked(activityApi.fetchRoundActivity).mockResolvedValue({
      roundId,
      intervals: [
        interval(DESI, 60_000, 54_000),
        interval(DESI, 30_000, 25_000),
        // Still away when the round ended: capped at the end of the answering window.
        // (cap derived from the interval's own start: one clock reading, no drift)
        ((away) => ({ ...away, capAt: away.awayAt + 3_000 }))(interval(KALOYAN, 10_000)),
      ],
    });
    renderWithProviders(
      <RoundActivitySummary
        roomId={roomId}
        roundId={roundId}
        immutable
        players={[
          { playerId: TEST_PLAYER_ID, displayName: 'Стоян' },
          { playerId: DESI, displayName: 'Деси' },
          { playerId: KALOYAN, displayName: 'Калоян' },
        ]}
      />,
    );
    expect(screen.getByText('Активност през рунда')).toBeInTheDocument();
    const row = async (name: string) => (await screen.findByText(name)).closest('li')!;
    expect(await row('Деси')).toHaveTextContent('2 излизания · 11 сек. общо');
    expect(await row('Стоян')).toHaveTextContent('няма отчетени излизания');
    expect(await row('Калоян')).toHaveTextContent('1 излизане · 3 сек. общо');
  });
});
