import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CATEGORY_IDS,
  REVEAL_DURATION_MS,
  type CategoryId,
  type GameProgress,
  type PlayerId,
  type RoomId,
  type RoundId,
} from '@/domain';
import { renderWithProviders, TEST_PLAYER_ID } from '@/test/renderWithProviders';

import * as gameApi from '../../api/gameApi';
import type { RevealedRound } from '../../api/gameState';
import * as resultsApi from '../../api/roundResults';
import type { CellState, PlayerResult, RoundResults } from '../../api/roundResults';
import { recordClockSample, resetServerClock } from '../../clock/serverClock';
import { GameAudioContext, type GameAudio } from '@/features/audio/gameAudio';

import { ResultsScreen } from './ResultsScreen';

vi.mock('../../api/roundResults', () => ({
  fetchRoundResults: vi.fn(),
  setAnswerInvalidated: vi.fn(),
}));
vi.mock('../../api/gameApi', () => ({
  startNextRound: vi.fn(),
  finishGame: vi.fn(),
}));

const roomId = 'room-1' as RoomId;
const roundId = 'round-1' as RoundId;
const DESI = 'player-desi' as PlayerId;
const KALOYAN = 'player-kaloyan' as PlayerId;
const NOW = Date.parse('2026-01-01T12:00:00Z');

type CellSpec = [string, CellState, number?];

function player(
  id: PlayerId,
  name: string,
  order: number,
  cells: Partial<Record<CategoryId, CellSpec>>,
  totals: { round: number; total: number },
): PlayerResult {
  return {
    playerId: id,
    displayName: name,
    left: false,
    order,
    roundPoints: totals.round,
    totalPoints: totals.total,
    cells: CATEGORY_IDS.map((category) => {
      const [answer, state, duplicateCount] = cells[category] ?? ['', 'empty'];
      return {
        category,
        answer,
        state,
        points: state === 'unique' ? 1 : 0,
        duplicateCount: duplicateCount ?? (state === 'unique' ? 1 : 0),
      };
    }),
  };
}

function results(revealAt: number | null): RoundResults {
  return withStandings({
    serverNow: NOW,
    phase: revealAt === null ? 'RESULTS' : 'REVEAL',
    round: { id: roundId, number: 1, letter: 'М', revealAt, isCurrent: true },
    players: [
      player(
        TEST_PLAYER_ID,
        'Стоян',
        0,
        {
          country: ['Малта', 'unique'],
          city: ['Монтана', 'duplicate', 2],
          animal: ['Мечка', 'invalid'],
        },
        { round: 1, total: 1 },
      ),
      player(
        DESI,
        'Деси',
        1,
        {
          country: ['Мексико', 'unique'],
          city: ['Монтана', 'duplicate', 2],
          name: ['Кристина', 'wrong_letter'],
        },
        { round: 1, total: 1 },
      ),
      player(
        KALOYAN,
        'Калоян',
        2,
        { country: ['Мароко', 'unique'], plant: ['Мента', 'unique'] },
        { round: 2, total: 2 },
      ),
    ],
  });
}

function withStandings(data: Omit<RoundResults, 'standings'>): RoundResults {
  return {
    ...data,
    standings: data.players.map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      left: p.left,
      order: p.order,
      totalPoints: p.totalPoints,
      roundsPlayed: 1,
    })),
  };
}

function pinServerClock(serverMs: number) {
  const local = Date.now();
  recordClockSample({ serverMs, requestStart: local, requestEnd: local });
}

const PROGRESS: GameProgress = {
  totalRounds: 28,
  lettersUsed: 1,
  roundsCompleted: 1,
  isFinalRound: false,
  eligiblePlayers: 3,
};

function renderResults(
  hostPlayerId: PlayerId = TEST_PLAYER_ID,
  options: {
    progress?: GameProgress;
    revealedRounds?: RevealedRound[];
    currentRoundId?: RoundId;
    audio?: GameAudio;
  } = {},
) {
  const screenUi = (
    <ResultsScreen
      roomId={roomId}
      roundId={options.currentRoundId ?? roundId}
      playerId={TEST_PLAYER_ID}
      hostPlayerId={hostPlayerId}
      phase="RESULTS"
      progress={options.progress ?? PROGRESS}
      revealedRounds={options.revealedRounds ?? [{ id: roundId, number: 1, letter: 'М' }]}
    />
  );
  return renderWithProviders(
    options.audio ? (
      <GameAudioContext value={options.audio}>{screenUi}</GameAudioContext>
    ) : (
      screenUi
    ),
  );
}

/** Records the cues a screen sends (the decision itself is the engine's business). */
function audioSpy() {
  const cue = vi.fn<GameAudio['cue']>(() => 'play');
  return { enabled: true, setEnabled: () => undefined, cue } satisfies GameAudio;
}

beforeEach(() => {
  resetServerClock();
  vi.mocked(resultsApi.setAnswerInvalidated).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const table = () => screen.getByRole('table');
const row = (name: string) => within(table()).getByRole('row', { name: new RegExp(`^${name}`) });

describe('ResultsScreen reveal', () => {
  it('starts with the suspense screen at reveal_at', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    pinServerClock(NOW);
    vi.mocked(resultsApi.fetchRoundResults).mockResolvedValue(results(NOW));
    const audio = audioSpy();
    renderResults(TEST_PLAYER_ID, { audio });
    expect(await screen.findByText('РЕЗУЛТАТИТЕ СЕ РАЗКРИВАТ')).toBeInTheDocument();
    // The live reveal speaks once: one suspense cue for this round.
    await vi.waitFor(() => {
      expect(audio.cue).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'round:round-1:suspense', sound: 'suspense' }),
      );
    });
  });

  it('resumes mid-reveal after a refresh: earlier categories shown, later ones and totals hidden', async () => {
    // 4 s into the reveal: Държава (2.6 s) and Град (3.6 s) are revealed. Only Date is
    // frozen, so the clock cannot drift into the next category while the test runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    pinServerClock(NOW + 4_000);
    vi.mocked(resultsApi.fetchRoundResults).mockResolvedValue(results(NOW));
    renderResults();
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    expect(within(stoyan).getByText('Малта')).toBeInTheDocument();
    expect(within(stoyan).getAllByText('Монтана')).toHaveLength(1);
    // Animal (4th category) is still concealed, as are the totals.
    expect(within(stoyan).queryByText('Мечка')).not.toBeInTheDocument();
    expect(within(stoyan).getAllByText('скрит')).toHaveLength(5);
    expect(within(stoyan).getByText('скрито')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ОБЩО КЛАСИРАНЕ' })).not.toBeInTheDocument();
  });

  it('reveals the next category at the authoritative boundary', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW + 2_700);
    pinServerClock(NOW + 2_700);
    vi.mocked(resultsApi.fetchRoundResults).mockResolvedValue(results(NOW));
    renderResults();
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    expect(within(stoyan).getAllByText('скрит')).toHaveLength(6);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(within(row('Стоян')).getAllByText('скрит')).toHaveLength(5);
  });
});

describe('ResultsScreen final results', () => {
  beforeEach(() => {
    pinServerClock(NOW + REVEAL_DURATION_MS + 5_000);
    vi.mocked(resultsApi.fetchRoundResults).mockResolvedValue(results(NOW));
  });

  it('shows every cell with a text meaning, not only a colour', async () => {
    renderResults(DESI);
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    expect(within(stoyan).getByText(/Малта/).parentElement).toHaveTextContent(/уникален, 1 точка/);
    expect(
      within(stoyan).getByText(/повтарящ се, 0 точки\. Същият отговор имат 2 играчи/),
    ).toBeInTheDocument();
    expect(within(stoyan).getByText(/невалиден, 0 точки/)).toBeInTheDocument();
    expect(within(stoyan).getAllByText(/празен, 0 точки/).length).toBeGreaterThan(0);
    const desi = screen.getByRole('row', { name: /^Деси/ });
    expect(
      within(desi).getByText(/грешна буква, 0 точки. Не започва с буквата на рунда/),
    ).toBeInTheDocument();
  });

  it('keeps rows in participant order and ranks the leaderboard with shared places', async () => {
    renderResults(DESI);
    await screen.findByRole('heading', { name: 'ОБЩО КЛАСИРАНЕ' });
    const rowNames = within(table())
      .getAllByRole('rowheader')
      .map((header) => header.textContent);
    expect(rowNames.map((name) => name.replace(/ти$/, ''))).toEqual(['Стоян', 'Деси', 'Калоян']);

    const standings = within(
      screen.getByRole('heading', { name: 'ОБЩО КЛАСИРАНЕ' }).closest('section')!,
    ).getAllByRole('listitem');
    expect(standings.map((item) => item.textContent.slice(0, 2))).toEqual(['1.', '2.', '2.']);
    expect(standings[0]).toHaveTextContent('Калоян');
  });

  it('announces when the results are ready', async () => {
    renderResults(DESI);
    expect(
      await screen.findByText(/Резултатите са готови\. Имаш 1 точки в този рунд и 1 общо\./),
    ).toBeInTheDocument();
  });

  it('shows a map button for geographic answers and opens a Google Maps modal', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_EMBED_KEY', 'test-google-key');
    const user = userEvent.setup();
    renderResults(DESI);
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    const mapButton = within(stoyan).getByRole('button', { name: /Покажи Малта на картата/ });
    expect(mapButton).toBeInTheDocument();
    expect(
      within(stoyan).queryByRole('button', { name: /Покажи Мечка на картата/ }),
    ).not.toBeInTheDocument();

    await user.click(mapButton);
    const dialog = await screen.findByRole('dialog', { name: 'Малта' });
    const iframe = within(dialog).getByTitle('Google Maps for Малта');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('key=test-google-key'));
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringContaining(
        'q=%D0%9C%D0%B0%D0%BB%D1%82%D0%B0%20%D0%94%D1%8A%D1%80%D0%B6%D0%B0%D0%B2%D0%B0',
      ),
    );
    expect(iframe).not.toHaveClass('hidden');
    expect(within(dialog).getByText('Зареждане на картата...')).toBeInTheDocument();
    expect(iframe).toHaveAttribute('loading', 'eager');
    fireEvent.load(iframe);
    expect(within(dialog).queryByText('Зареждане на картата...')).not.toBeInTheDocument();
    await user.click(within(dialog).getAllByRole('button', { name: 'Затвори' })[0]!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the map button when the Google Maps key is missing', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_EMBED_KEY', '');
    renderResults(DESI);
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    expect(
      within(stoyan).queryByRole('button', { name: /Покажи Малта на картата/ }),
    ).not.toBeInTheDocument();
  });

  it('shows a fallback instead of an endless map loading indicator', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_EMBED_KEY', 'test-google-key');
    renderResults(DESI);
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    vi.useFakeTimers();
    fireEvent.click(within(stoyan).getByRole('button', { name: /Покажи Малта на картата/ }));
    const dialog = screen.getByRole('dialog', { name: 'Малта' });

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(
      within(dialog).getByText('Картата не се зареди. Отвори я чрез бутона отдолу.'),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('lets non-hosts read explanations without changing answers', async () => {
    const user = userEvent.setup();
    renderResults(DESI);
    await screen.findByRole('row', { name: /^Стоян/ });
    expect(
      within(table()).getByRole('button', { name: /Стоян, Животно: Мечка/ }),
    ).toBeInTheDocument();
    await user.click(within(table()).getByRole('button', { name: /Стоян, Животно: Мечка/ }));
    const dialog = screen.getByRole('dialog', { name: 'Стоян · Животно' });
    expect(within(dialog).getByRole('region', { name: 'Причина за анулиране' })).toHaveTextContent(
      'Конкретно обяснение не е записано',
    );
    expect(within(dialog).queryByRole('button', { name: 'ВЪЗСТАНОВИ ОТГОВОРА' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'ОТБЕЛЕЖИ КАТО НЕВАЛИДЕН' })).toBeNull();
    await user.click(within(dialog).getAllByRole('button', { name: 'Затвори' })[0]!);
    expect(resultsApi.setAnswerInvalidated).not.toHaveBeenCalled();
  });

  it('lets the host invalidate through a deliberate two-step action', async () => {
    const user = userEvent.setup();
    renderResults(TEST_PLAYER_ID);
    const desi = await screen.findByRole('row', { name: /^Деси/ });
    expect(within(desi).getByRole('button', { name: /Деси, Град: Монтана/ })).toBeInTheDocument();

    await user.click(within(desi).getByRole('button', { name: /Деси, Град: Монтана/ }));
    const dialog = screen.getByRole('dialog', { name: 'Деси · Град' });
    expect(resultsApi.setAnswerInvalidated).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'ОТБЕЛЕЖИ КАТО НЕВАЛИДЕН' }));

    expect(resultsApi.setAnswerInvalidated).toHaveBeenCalledWith({
      roomId,
      roundId,
      playerId: DESI,
      category: 'city',
      invalidated: true,
    });
  });

  it('offers restoring an answer that is already invalid', async () => {
    const user = userEvent.setup();
    renderResults(TEST_PLAYER_ID);
    const stoyan = await screen.findByRole('row', { name: /^Стоян/ });
    await user.click(within(stoyan).getByRole('button', { name: /Стоян, Животно: Мечка/ }));
    const dialog = screen.getByRole('dialog', { name: 'Стоян · Животно' });
    expect(within(dialog).getByRole('region', { name: 'Причина за анулиране' })).toHaveTextContent(
      'Конкретно обяснение не е записано',
    );
    await user.click(within(dialog).getByRole('button', { name: 'ВЪЗСТАНОВИ ОТГОВОРА' }));
    expect(resultsApi.setAnswerInvalidated).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: TEST_PLAYER_ID, category: 'animal', invalidated: false }),
    );
  });
});

describe('ResultsScreen next step', () => {
  beforeEach(() => {
    pinServerClock(NOW + REVEAL_DURATION_MS + 5_000);
    vi.mocked(resultsApi.fetchRoundResults).mockResolvedValue(results(NOW));
    vi.mocked(gameApi.startNextRound).mockResolvedValue(undefined);
    vi.mocked(gameApi.finishGame).mockResolvedValue(undefined);
  });

  it('gives the host "НОВ РУНД" with the letter progress', async () => {
    const user = userEvent.setup();
    renderResults(TEST_PLAYER_ID);
    expect(await screen.findByText('1 / 28')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'НОВ РУНД' }));
    expect(gameApi.startNextRound).toHaveBeenCalledWith(roomId);
  });

  it('tells other players to wait for the host', async () => {
    renderResults(DESI);
    expect(await screen.findByText('Изчакваме хоста за следващия рунд...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'НОВ РУНД' })).not.toBeInTheDocument();
  });

  it('replaces the next round with the final standings after round 28', async () => {
    const user = userEvent.setup();
    const final = { ...PROGRESS, lettersUsed: 28, roundsCompleted: 28, isFinalRound: true };
    renderResults(TEST_PLAYER_ID, { progress: final });
    await user.click(await screen.findByRole('button', { name: 'ВИЖ КРАЙНОТО КЛАСИРАНЕ' }));
    expect(gameApi.finishGame).toHaveBeenCalledWith(roomId);
    expect(screen.queryByRole('button', { name: 'НОВ РУНД' })).not.toBeInTheDocument();
  });

  it('asks non-hosts to wait for the host to finish the game', async () => {
    const final = { ...PROGRESS, lettersUsed: 28, roundsCompleted: 28, isFinalRound: true };
    renderResults(DESI, { progress: final });
    expect(await screen.findByText('Изчакваме хоста да завърши играта...')).toBeInTheDocument();
  });

  it('shows a friendly message when too few players are left', async () => {
    const { RoomError } = await import('@/features/rooms/api/roomErrors');
    vi.mocked(gameApi.startNextRound).mockRejectedValue(new RoomError('not_enough_players'));
    const user = userEvent.setup();
    renderResults(TEST_PLAYER_ID);
    await user.click(await screen.findByRole('button', { name: 'НОВ РУНД' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нужни са поне 2 свързани играчи');
  });
});

describe('ResultsScreen history', () => {
  const round2 = 'round-2' as RoundId;

  beforeEach(() => {
    pinServerClock(NOW + REVEAL_DURATION_MS + 5_000);
    vi.mocked(resultsApi.fetchRoundResults).mockImplementation((_room, id) => {
      const base = results(NOW);
      return Promise.resolve(
        id === round2
          ? { ...base, round: { ...base.round, id: round2, number: 2, letter: 'Б' } }
          : { ...base, round: { ...base.round, isCurrent: false } },
      );
    });
  });

  it('browses a previous round read-only, clearly labelled, without invalidation controls', async () => {
    const user = userEvent.setup();
    const audio = audioSpy();
    renderResults(TEST_PLAYER_ID, {
      audio,
      currentRoundId: round2,
      revealedRounds: [
        { id: roundId, number: 1, letter: 'М' },
        { id: round2, number: 2, letter: 'Б' },
      ],
      progress: { ...PROGRESS, lettersUsed: 2, roundsCompleted: 2 },
    });
    await screen.findByRole('heading', { name: 'РЕЗУЛТАТИ' });
    expect(screen.getByText('Текущ рунд')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('button').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Предишен рунд' }));
    expect(await screen.findByRole('heading', { name: 'ПРЕДИШЕН РУНД' })).toBeInTheDocument();
    expect(screen.getByText(/само за преглед/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).getByRole('button', { name: /Стоян, Животно: Мечка/ }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('table')).getByRole('button', { name: /Стоян, Животно: Мечка/ }),
    );
    const explanation = screen.getByRole('dialog', { name: 'Стоян · Животно' });
    expect(
      within(explanation).getByRole('region', { name: 'Причина за анулиране' }),
    ).toBeInTheDocument();
    expect(within(explanation).queryByRole('button', { name: 'ВЪЗСТАНОВИ ОТГОВОРА' })).toBeNull();
    await user.click(within(explanation).getAllByRole('button', { name: 'Затвори' })[0]!);
    expect(resultsApi.setAnswerInvalidated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'НОВ РУНД' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Към текущия рунд' }));
    expect(await screen.findByRole('heading', { name: 'РЕЗУЛТАТИ' })).toBeInTheDocument();
    // HISTORY = inspectable: no reveal, no category or score sounds — and a settled
    // current round does not replay its reveal either.
    expect(audio.cue).not.toHaveBeenCalled();
  });
});
