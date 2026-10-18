import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CATEGORY_IDS,
  DISPLAY_NAME_MAX_LENGTH,
  MAX_PLAYERS,
  rankLeaderboard,
  type GameProgress,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { motionDuration, MOTION_MS } from '@/shared/motion/motion';
import { renderWithProviders, TEST_PLAYER_ID } from '@/test/renderWithProviders';

import * as summaryApi from '../api/gameSummary';
import type { PlayerResult } from '../api/roundResults';
import { claimCelebration, resetCelebrations } from '../celebration';
import { Confetti } from './Confetti';
import { FinishedScreen } from './FinishedScreen';
import { Leaderboard } from './results/Leaderboard';
import { ResultsTable } from './results/ResultsTable';
import { ScreenTransition } from './ScreenTransition';

vi.mock('../api/gameSummary', () => ({ fetchGameSummary: vi.fn() }));
vi.mock('../api/roundResults', () => ({
  fetchRoundResults: vi.fn(() => new Promise(() => undefined)),
  setAnswerInvalidated: vi.fn(),
}));

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  setReducedMotion(false);
  resetCelebrations();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('motion system', () => {
  it('has four named durations, and reduced motion makes them instant', () => {
    expect(Object.keys(MOTION_MS)).toEqual(['instant', 'fast', 'normal', 'dramatic']);
    expect(motionDuration('normal', false)).toBe(MOTION_MS.normal);
    expect(motionDuration('dramatic', true)).toBe(0);
  });
});

describe('ScreenTransition', () => {
  it('enters once per screen change, never on a re-render', () => {
    const { container, rerender } = render(
      <ScreenTransition screenKey="playing:r1">
        <p>a</p>
      </ScreenTransition>,
    );
    const first = container.querySelector('[data-screen]');
    expect(first).toHaveClass('animate-screen-in');
    rerender(
      <ScreenTransition screenKey="playing:r1">
        <p>b</p>
      </ScreenTransition>,
    );
    expect(container.querySelector('[data-screen]')).toBe(first);
    rerender(
      <ScreenTransition screenKey="results-ready:r1">
        <p>c</p>
      </ScreenTransition>,
    );
    expect(container.querySelector('[data-screen]')).not.toBe(first);
  });
});

describe('confetti', () => {
  it('celebrates once per game per session', () => {
    expect(claimCelebration('room-1')).toBe(true);
    expect(claimCelebration('room-1')).toBe(false);
    resetCelebrations(); // a refresh: memory is gone, sessionStorage remembers
    expect(claimCelebration('room-1')).toBe(false);
    expect(claimCelebration('room-2')).toBe(true);
  });

  it('ends by itself after a few seconds', () => {
    vi.useFakeTimers();
    render(<Confetti gameKey="room-3" />);
    expect(screen.getByTestId('confetti')).toBeInTheDocument();
    expect(screen.getByTestId('confetti').children.length).toBeLessThanOrEqual(30);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByTestId('confetti')).not.toBeInTheDocument();
  });

  it('is absent with reduced motion', () => {
    setReducedMotion(true);
    render(<Confetti gameKey="room-4" />);
    expect(screen.queryByTestId('confetti')).not.toBeInTheDocument();
  });
});

const PROGRESS: GameProgress = {
  totalRounds: 28,
  lettersUsed: 28,
  roundsCompleted: 28,
  isFinalRound: true,
  eligiblePlayers: 3,
};

function standing(id: string, name: string, order: number, totalPoints: number, roundsPlayed = 28) {
  return {
    playerId: id as PlayerId,
    displayName: name,
    left: false,
    order,
    totalPoints,
    roundsPlayed,
  };
}

function renderFinished(standings: ReturnType<typeof standing>[]) {
  vi.mocked(summaryApi.fetchGameSummary).mockResolvedValue({
    code: 'K7M4Q',
    finishedAt: null,
    totalRounds: 28,
    roundsCompleted: 28,
    standings,
  });
  return renderWithProviders(
    <FinishedScreen
      roomId={'room-9' as RoomId}
      roomCode="K7M4Q"
      lastRoundId={'round-28' as RoundId}
      playerId={TEST_PLAYER_ID}
      hostPlayerId={TEST_PLAYER_ID}
      progress={PROGRESS}
      revealedRounds={[]}
    />,
  );
}

describe('final winner treatment', () => {
  it('emphasizes a single winner with their points', async () => {
    renderFinished([standing('a', 'Стоян', 0, 142), standing('b', 'Деси', 1, 137)]);
    expect(await screen.findByText('Победител: Стоян')).toBeInTheDocument();
    expect(screen.getByText('142 точки')).toBeInTheDocument();
  });

  it('gives tied winners exactly equal emphasis — no tie-breaker', async () => {
    renderFinished([
      standing('a', 'Стоян', 0, 142),
      standing('b', 'Деси', 1, 142),
      standing('c', 'Калоян', 2, 99, 1),
    ]);
    expect(await screen.findByText('Победители: Стоян и Деси')).toBeInTheDocument();
    expect(screen.getByText('142 точки всеки')).toBeInTheDocument();
    const rows = within(
      screen.getByRole('heading', { name: 'КРАЙНО КЛАСИРАНЕ' }).closest('section')!,
    ).getAllByRole('listitem');
    // Same rank, same styling for both winners.
    expect(rows[0]!.className).toBe(rows[1]!.className);
    expect(rows[2]).toHaveTextContent('1 рунд');
    expect(rows[2]).not.toHaveTextContent('1 рунда');
  });
});

function result(index: number, name: string): PlayerResult {
  return {
    playerId: `p${String(index)}` as PlayerId,
    displayName: name,
    left: index % 7 === 3,
    order: index,
    roundPoints: index % 8,
    totalPoints: 10 + index,
    cells: CATEGORY_IDS.map((category) => ({
      category,
      answer:
        'Много дълъг отговор, който е допустим и трябва да се пренесе на нов ред без да чупи таблицата'.slice(
          0,
          100,
        ),
      state: index % 2 === 0 ? 'unique' : 'duplicate',
      points: index % 2 === 0 ? 1 : 0,
      duplicateCount: index % 2 === 0 ? 1 : 2,
    })),
  };
}

describe('15 players and long text', () => {
  const longName = 'Я'.repeat(DISPLAY_NAME_MAX_LENGTH);
  const players = Array.from({ length: MAX_PLAYERS }, (_, i) =>
    result(i, i === 0 ? longName : `Играч ${String(i + 1)}`),
  );

  it('renders a full results table, truncating long names instead of stretching', () => {
    render(
      <ResultsTable
        players={players}
        currentPlayerId={'p0' as PlayerId}
        revealedCategories={7}
        scoresRevealed
        live={false}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(MAX_PLAYERS + 1);
    expect(screen.getByText(longName)).toHaveClass('truncate');
  });

  it('shows settled (non-live) totals immediately — history never counts up', () => {
    render(
      <ResultsTable
        players={players.slice(0, 2)}
        currentPlayerId={'p0' as PlayerId}
        revealedCategories={7}
        scoresRevealed
        live={false}
      />,
    );
    const points = screen.getAllByRole('row')[2]!.querySelector('td:last-child [aria-hidden]');
    expect(points).toHaveTextContent('1');
  });

  it('ranks a 15-player leaderboard with stable, shared ranks', () => {
    const entries = rankLeaderboard(
      players.map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        totalPoints: p.order < 3 ? 50 : p.totalPoints,
        roundPoints: p.roundPoints,
        order: p.order,
        left: p.left,
      })),
    );
    render(<Leaderboard entries={entries} currentPlayerId={'p0' as PlayerId} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(MAX_PLAYERS);
    expect(items.slice(0, 3).map((li) => li.textContent.slice(0, 2))).toEqual(['1.', '1.', '1.']);
    expect(screen.getAllByText('напусна').length).toBeGreaterThan(0);
  });
});
