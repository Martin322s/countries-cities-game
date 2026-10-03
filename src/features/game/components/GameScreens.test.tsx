import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyAnswers,
  ROUND_DURATION_MS,
  type PlayerId,
  type RoomId,
  type RoundId,
  type RoundParticipant,
} from '@/domain';
import { renderWithProviders, TEST_PLAYER_ID } from '@/test/renderWithProviders';

import * as gameApi from '../api/gameApi';
import type { GameRound } from '../api/gameState';
import { recordClockSample, resetServerClock } from '../clock/serverClock';
import { AnswerForm } from './AnswerForm';
import { CountdownScreen } from './CountdownScreen';
import { PlayingScreen } from './PlayingScreen';
import { PostRoundScreen } from './PostRoundScreen';
import { RoundTimer } from './RoundTimer';
import { RoundWaitingScreen } from './RoundWaitingScreen';

vi.mock('../api/gameApi', () => ({
  fetchGameState: vi.fn(),
  fetchOwnAnswers: vi.fn(),
  saveAnswers: vi.fn(),
  lockAnswers: vi.fn(),
  setRoundReady: vi.fn(),
  setResultsReady: vi.fn(),
  startGame: vi.fn(),
}));

const roomId = 'room-1' as RoomId;
const other = 'player-other' as PlayerId;
const NOW = Date.parse('2026-01-01T12:00:00Z');

function participant(id: PlayerId, name: string, overrides: Partial<RoundParticipant> = {}) {
  return {
    playerId: id,
    displayName: name,
    joinedAt: '2026-01-01T11:00:00Z',
    lastSeenAt: new Date(NOW - 1_000).toISOString(),
    left: false,
    roundReady: false,
    answersLockedAt: null,
    answersLockReason: null,
    resultsReady: false,
    ...overrides,
  } satisfies RoundParticipant;
}

function playingRound(
  startedAt: number,
): GameRound & { timeline: { startedAt: number; endsAt: number } } {
  return {
    id: 'round-1' as RoundId,
    number: 1,
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
}

beforeEach(() => {
  resetServerClock();
  vi.mocked(gameApi.saveAnswers).mockResolvedValue(undefined);
  vi.mocked(gameApi.lockAnswers).mockResolvedValue(undefined);
  vi.mocked(gameApi.setRoundReady).mockResolvedValue(undefined);
  vi.mocked(gameApi.setResultsReady).mockResolvedValue(undefined);
  vi.mocked(gameApi.fetchOwnAnswers).mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Pins the estimated server clock: server time = NOW + elapsed local time. */
function pinServerClock(serverMs = NOW) {
  const local = Date.now();
  recordClockSample({ serverMs, requestStart: local, requestEnd: local });
}

describe('RoundWaitingScreen', () => {
  it("shows the round, everyone's readiness and sends READY for the caller only", async () => {
    pinServerClock(Date.now());
    const user = userEvent.setup();
    renderWithProviders(
      <RoundWaitingScreen
        roomId={roomId}
        playerId={TEST_PLAYER_ID}
        hostPlayerId={other}
        roundNumber={1}
        participants={[
          participant(TEST_PLAYER_ID, 'Стоян', { lastSeenAt: new Date().toISOString() }),
          participant(other, 'Деси', { roundReady: true, lastSeenAt: new Date().toISOString() }),
        ]}
        onlinePlayerIds={new Set([other])}
      />,
    );

    expect(screen.getByText('Рунд 1')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Готови ли сте?' })).toBeVisible();
    const list = screen.getByRole('list', { name: 'Готовност на играчите' });
    expect(within(list).getByText('Деси').closest('li')).toHaveTextContent('Готов');
    expect(within(list).getByText('Стоян').closest('li')).toHaveTextContent('Не е готов');
    expect(screen.getByText('1')).toBeVisible();
    // No letter exists yet.
    expect(screen.queryByText(/^Буква:/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ГОТОВ' }));
    expect(gameApi.setRoundReady).toHaveBeenCalledWith(roomId);
  });

  it('shows the waiting state after pressing READY (e.g. after a refresh)', () => {
    renderWithProviders(
      <RoundWaitingScreen
        roomId={roomId}
        playerId={TEST_PLAYER_ID}
        hostPlayerId={other}
        roundNumber={1}
        participants={[participant(TEST_PLAYER_ID, 'Стоян', { roundReady: true })]}
        onlinePlayerIds={new Set()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('ГОТОВ СИ');
    expect(screen.getByRole('status')).toHaveTextContent('Изчакваме останалите...');
    expect(screen.queryByRole('button', { name: 'ГОТОВ' })).not.toBeInTheDocument();
  });
});

describe('CountdownScreen', () => {
  it('derives 3 · 2 · 1 from the authoritative start time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    pinServerClock();
    renderWithProviders(
      <CountdownScreen roundId={'round-1' as RoundId} startedAt={NOW + 3_000} roundNumber={1} />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.getByText('2')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('reconstructs the right number after a refresh mid-countdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    pinServerClock(NOW + 2_200);
    renderWithProviders(
      <CountdownScreen roundId={'round-1' as RoundId} startedAt={NOW + 3_000} roundNumber={1} />,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('RoundTimer', () => {
  it('shows remaining server time, with urgency announced only at key marks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    pinServerClock();
    renderWithProviders(
      <RoundTimer roundId={'round-1' as RoundId} endsAt={NOW + 30_400} answersLocked={false} />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('0:31');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('0:30');
    expect(screen.getByText('Остават 30 секунди')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText('Остават 30 секунди')).not.toBeInTheDocument();
  });
});

describe('AnswerForm keyboard', () => {
  function renderForm(readOnly = false, values = emptyAnswers()) {
    const readyRef = createRef<HTMLButtonElement>();
    const onChange = vi.fn();
    renderWithProviders(
      <>
        <AnswerForm
          values={values}
          onChange={onChange}
          readOnly={readOnly}
          nextFocusRef={readyRef}
          autoFocusFirst={false}
          letter="Ю"
        />
        <button ref={readyRef} type="button">
          ГОТОВ
        </button>
      </>,
    );
    return { onChange };
  }

  it('labels all seven categories in order', () => {
    renderForm();
    expect(screen.getAllByRole('textbox').map((input) => input.getAttribute('id'))).toEqual([
      'answer-country',
      'answer-city',
      'answer-village',
      'answer-animal',
      'answer-plant',
      'answer-object',
      'answer-name',
    ]);
    expect(screen.getByLabelText('Държава')).toBeInTheDocument();
    expect(screen.getByLabelText('Име')).toBeInTheDocument();
  });

  it('moves to the next field on Enter and to READY after the last field', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText('Държава'));
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Град')).toHaveFocus();

    await user.click(screen.getByLabelText('Име'));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'ГОТОВ' })).toHaveFocus();
  });

  it('leaves Enter alone while an IME composition is active', () => {
    renderForm();
    const country = screen.getByLabelText('Държава');
    country.focus();
    fireEvent.compositionStart(country);
    fireEvent.keyDown(country, { key: 'Enter' });
    expect(country).toHaveFocus();
  });

  it('is read-only when locked', () => {
    renderForm(true);
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAttribute('readonly');
  });

  it('warns while typing when an answer does not start with the round letter', () => {
    renderForm(false, { ...emptyAnswers(), country: 'Югославия', name: 'Кристина' });
    expect(screen.getByLabelText('Държава')).not.toHaveAttribute('aria-invalid');
    const name = screen.getByLabelText('Име');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Трябва да започва с „Ю“ — иначе носи 0 точки.');
    expect(screen.getAllByText(/Трябва да започва с/)).toHaveLength(1);
  });
});

describe('PlayingScreen', () => {
  function renderPlaying(overrides: { me?: Partial<RoundParticipant>; timeUp?: boolean } = {}) {
    const startedAt = Date.now() - 10_000;
    return renderWithProviders(
      <PlayingScreen
        roomId={roomId}
        playerId={TEST_PLAYER_ID}
        hostPlayerId={TEST_PLAYER_ID}
        round={playingRound(startedAt)}
        participants={[
          participant(TEST_PLAYER_ID, 'Стоян', overrides.me),
          participant(other, 'Деси', {
            answersLockedAt: '2026-01-01T12:00:30Z',
            answersLockReason: 'ready',
          }),
        ]}
        onlinePlayerIds={new Set([other])}
        timeUp={overrides.timeUp ?? false}
      />,
    );
  }

  it('restores persisted answers after a reconnect and keeps the letter and timer visible', async () => {
    pinServerClock(Date.now());
    vi.mocked(gameApi.fetchOwnAnswers).mockResolvedValue({ country: 'Мароко', name: 'Мира' });
    renderPlaying();
    expect(await screen.findByLabelText('Държава')).toHaveValue('Мароко');
    expect(screen.getByLabelText('Име')).toHaveValue('Мира');
    expect(screen.getByText('Буква:', { exact: false }).parentElement).toHaveTextContent('М');
    expect(screen.getByRole('timer')).toBeInTheDocument();
    // Others' statuses are visible, their answers are not.
    const list = screen.getByRole('list', { name: 'Кой е готов' });
    expect(within(list).getByText('Деси').closest('li')).toHaveTextContent('Готов');
  });

  it('flushes pending edits, then locks with READY', async () => {
    pinServerClock(Date.now());
    const user = userEvent.setup();
    renderPlaying();
    const country = await screen.findByLabelText('Държава');
    await user.type(country, 'Малта');
    await user.click(screen.getByRole('button', { name: 'ГОТОВ — ЗАКЛЮЧИ ОТГОВОРИТЕ' }));

    await vi.waitFor(() => {
      expect(gameApi.lockAnswers).toHaveBeenCalledWith(roomId, 'round-1');
    });
    const saveOrder = vi.mocked(gameApi.saveAnswers).mock.invocationCallOrder.at(-1)!;
    const lockOrder = vi.mocked(gameApi.lockAnswers).mock.invocationCallOrder[0]!;
    expect(vi.mocked(gameApi.saveAnswers)).toHaveBeenLastCalledWith(roomId, 'round-1', {
      country: 'Малта',
    });
    expect(saveOrder).toBeLessThan(lockOrder);
  });

  it('shows the locked, waiting state after personal READY (also after refresh)', async () => {
    pinServerClock(Date.now());
    vi.mocked(gameApi.fetchOwnAnswers).mockResolvedValue({ city: 'Монтана' });
    renderPlaying({ me: { answersLockedAt: '2026-01-01T12:00:40Z', answersLockReason: 'ready' } });
    const city = await screen.findByLabelText('Град');
    expect(city).toHaveValue('Монтана');
    expect(city).toHaveAttribute('readonly');
    expect(screen.getByText('ГОТОВ СИ')).toBeVisible();
    expect(screen.getByText(/Изчакваме останалите/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'ГОТОВ — ЗАКЛЮЧИ ОТГОВОРИТЕ' }),
    ).not.toBeInTheDocument();
  });

  it('locks every input the moment time is up', async () => {
    pinServerClock(Date.now());
    renderPlaying({ timeUp: true });
    expect(await screen.findByText('Времето изтече — отговорите са заключени.')).toBeVisible();
    for (const input of screen.getAllByRole('textbox')) expect(input).toHaveAttribute('readonly');
  });
});

describe('PostRoundScreen', () => {
  const lockedRound: GameRound = {
    ...playingRound(NOW),
    timeline: {
      countdownAt: NOW - 3_000,
      startedAt: NOW,
      endsAt: NOW + 120_000,
      lockedAt: NOW + 120_000,
      revealAt: null,
    },
    lockReason: 'timeout',
  };

  it('explains why the round ended and collects results-ready', async () => {
    pinServerClock(Date.now());
    const user = userEvent.setup();
    renderWithProviders(
      <PostRoundScreen
        roomId={roomId}
        playerId={TEST_PLAYER_ID}
        hostPlayerId={other}
        round={lockedRound}
        participants={[
          participant(TEST_PLAYER_ID, 'Стоян', {
            lastSeenAt: new Date().toISOString(),
            roundReady: true,
          }),
          participant(other, 'Деси', { lastSeenAt: new Date().toISOString(), resultsReady: true }),
        ]}
        onlinePlayerIds={new Set([other])}
      />,
    );
    expect(screen.getByRole('heading', { name: 'ВРЕМЕТО ИЗТЕЧЕ' })).toBeVisible();
    expect(screen.getByText(/^Отговорите са заключени./)).toBeVisible();
    // Pre-round readiness does not leak into the results stage.
    const list = screen.getByRole('list', { name: 'Готовност за резултатите' });
    expect(within(list).getByText('Стоян').closest('li')).toHaveTextContent('Не е готов');
    await user.click(screen.getByRole('button', { name: 'ГОТОВ ЗА РЕЗУЛТАТИТЕ' }));
    expect(gameApi.setResultsReady).toHaveBeenCalledWith(roomId);
  });

  it('names an early finish when everyone was ready', () => {
    renderWithProviders(
      <PostRoundScreen
        roomId={roomId}
        playerId={TEST_PLAYER_ID}
        hostPlayerId={other}
        round={{ ...lockedRound, lockReason: 'all_ready' }}
        participants={[participant(TEST_PLAYER_ID, 'Стоян', { resultsReady: true })]}
        onlinePlayerIds={new Set()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'ВСИЧКИ СА ГОТОВИ' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('ГОТОВ СИ');
    expect(screen.getByRole('status')).toHaveTextContent('Изчакваме останалите...');
  });
});
