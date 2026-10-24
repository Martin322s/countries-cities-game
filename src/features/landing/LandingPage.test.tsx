import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomError } from '@/features/rooms/api/roomErrors';
import * as roomsApi from '@/features/rooms/api/roomsApi';
import { renderWithProviders } from '@/test/renderWithProviders';

import { LandingPage } from './LandingPage';

vi.mock('@/features/rooms/api/roomsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof roomsApi>()),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
}));

const createRoom = vi.mocked(roomsApi.createRoom);
const joinRoom = vi.mocked(roomsApi.joinRoom);

function setup(options: Parameters<typeof renderWithProviders>[1] = {}) {
  const user = userEvent.setup();
  const rendered = renderWithProviders(<LandingPage />, {
    routes: [{ path: '/room/:code', element: <p>room page</p> }],
    ...options,
  });
  return { user, ...rendered };
}

beforeEach(() => {
  window.localStorage.clear();
  createRoom.mockReset();
  joinRoom.mockReset();
});

describe('LandingPage', () => {
  it('shows the title, player range and both primary actions', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: /Държави\s*и градове/ })).toBeVisible();
    expect(screen.getByText('От 2 до 20 играчи')).toBeVisible();
    expect(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'ВЛЕЗ В СТАЯ' })).toBeVisible();
  });

  it('lists every category from the domain', () => {
    setup();
    const list = screen.getByRole('list', { name: 'Категории' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Държава', 'Град', 'Село', 'Животно', 'Растение', 'Предмет', 'Име']);
  });

  it('opens and closes the create-room dialog', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));

    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });
    expect(dialog).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Затвори' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validates the display name locally without calling the server', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });

    await user.click(within(dialog).getByRole('button', { name: 'Създай стая' }));
    expect(within(dialog).getByLabelText('Твоето име')).toHaveAccessibleDescription(/Въведи име/);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('creates a room and navigates to its canonical code', async () => {
    createRoom.mockResolvedValue('K7M4Q');
    const { user, router } = setup();
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });

    await user.type(within(dialog).getByLabelText('Твоето име'), '  Стоян ');
    await user.click(within(dialog).getByRole('button', { name: 'Създай стая' }));

    expect(await screen.findByText('room page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/room/K7M4Q');
    expect(createRoom.mock.calls[0]?.[0]).toEqual({ displayName: '  Стоян ', capacity: 8 });
  });

  it('shows a Bulgarian message when room creation fails', async () => {
    createRoom.mockRejectedValue(new RoomError('network'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });

    await user.type(within(dialog).getByLabelText('Твоето име'), 'Стоян');
    await user.click(within(dialog).getByRole('button', { name: 'Създай стая' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Връзката със сървъра беше прекъсната',
    );
  });

  it('keeps room actions disabled until the anonymous identity is ready', async () => {
    const { user } = setup({ auth: { status: 'loading' } });
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });
    expect(within(dialog).getByRole('button', { name: 'Свързване...' })).toBeDisabled();
  });

  it('keeps room capacity within 2–20', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'СЪЗДАЙ СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Нова стая' });
    const increase = within(dialog).getByRole('button', { name: 'Увеличи броя играчи' });

    for (let i = 0; i < 20; i++) {
      if (increase.hasAttribute('disabled')) break;
      await user.click(increase);
    }
    expect(within(dialog).getByRole('slider')).toHaveValue('20');
    expect(increase).toBeDisabled();
  });

  it('normalizes the join code as the player types', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'ВЛЕЗ В СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Влез в стая' });
    const codeInput = within(dialog).getByLabelText('Код на стаята');

    await user.type(codeInput, 'ab-c d7xyz');
    expect(codeInput).toHaveValue('ABCD7');
  });

  it('shows a duplicate-name rejection under the name field', async () => {
    joinRoom.mockRejectedValue(new RoomError('display_name_taken'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'ВЛЕЗ В СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Влез в стая' });

    await user.type(within(dialog).getByLabelText('Код на стаята'), 'K7M4Q');
    await user.type(within(dialog).getByLabelText('Твоето име'), 'Деси');
    await user.click(within(dialog).getByRole('button', { name: 'Влез' }));

    await expect
      .poll(() => within(dialog).getByLabelText('Твоето име').getAttribute('aria-invalid'))
      .toBe('true');
    expect(within(dialog).getByLabelText('Твоето име')).toHaveAccessibleDescription(
      /Това име вече се използва/,
    );
  });

  it('shows "room full" as a form-level error', async () => {
    joinRoom.mockRejectedValue(new RoomError('room_full'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'ВЛЕЗ В СТАЯ' }));
    const dialog = screen.getByRole('dialog', { name: 'Влез в стая' });

    await user.type(within(dialog).getByLabelText('Код на стаята'), 'K7M4Q');
    await user.type(within(dialog).getByLabelText('Твоето име'), 'Деси');
    await user.click(within(dialog).getByRole('button', { name: 'Влез' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Стаята е пълна.');
  });
});
