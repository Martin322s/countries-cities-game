import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameProgress, PlayerId, RoomId, RoundId } from '@/domain';
import { renderWithProviders, TEST_PLAYER_ID } from '@/test/renderWithProviders';

import * as summaryApi from '../api/gameSummary';
import { FinishedScreen } from './FinishedScreen';

vi.mock('../api/gameSummary', () => ({ fetchGameSummary: vi.fn() }));
vi.mock('../api/roundResults', () => ({
  fetchRoundResults: vi.fn(() => new Promise(() => undefined)),
  setAnswerInvalidated: vi.fn(),
}));

const roomId = 'room-1' as RoomId;
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

function renderFinished() {
  return renderWithProviders(
    <FinishedScreen
      roomId={roomId}
      roomCode="K7M4Q"
      lastRoundId={'round-28' as RoundId}
      playerId={TEST_PLAYER_ID}
      hostPlayerId={TEST_PLAYER_ID}
      progress={PROGRESS}
      revealedRounds={[{ id: 'round-28' as RoundId, number: 28, letter: 'Я' }]}
    />,
  );
}

beforeEach(() => {
  vi.mocked(summaryApi.fetchGameSummary).mockReset();
});

describe('FinishedScreen', () => {
  it('names joint winners and keeps their shared rank', async () => {
    vi.mocked(summaryApi.fetchGameSummary).mockResolvedValue({
      code: 'K7M4Q',
      finishedAt: null,
      totalRounds: 28,
      roundsCompleted: 28,
      standings: [
        standing('a', 'Стоян', 0, 142),
        standing('b', 'Деси', 1, 142),
        standing('c', 'Калоян', 2, 131, 27),
      ],
    });
    renderFinished();

    expect(screen.getByRole('heading', { name: 'КРАЙ НА ИГРАТА' })).toBeInTheDocument();
    expect(await screen.findByText('Победители: Стоян и Деси')).toBeInTheDocument();
    expect(screen.getByText(/28 \/ 28 букви/)).toBeInTheDocument();

    const list = screen.getByRole('heading', { name: 'КРАЙНО КЛАСИРАНЕ' }).closest('section')!;
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent.slice(0, 2))).toEqual(['1.', '1.', '3.']);
    expect(rows[0]).toHaveTextContent(/победител \(поделено първо място\)/);
    expect(rows[2]).toHaveTextContent('27 рунда');
    expect(rows[2]).toHaveTextContent('131');
    expect(screen.getByRole('link', { name: 'КЪМ НАЧАЛОТО' })).toHaveAttribute('href', '/');
  });

  it('names a single winner', async () => {
    vi.mocked(summaryApi.fetchGameSummary).mockResolvedValue({
      code: 'K7M4Q',
      finishedAt: null,
      totalRounds: 28,
      roundsCompleted: 28,
      standings: [standing('a', 'Стоян', 0, 142), standing('b', 'Деси', 1, 137)],
    });
    renderFinished();
    expect(await screen.findByText('Победител: Стоян')).toBeInTheDocument();
  });
});
