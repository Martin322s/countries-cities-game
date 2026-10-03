import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('starts keyboard focus in the first field, not on the close button', () => {
    render(
      <Dialog open onClose={() => undefined} title="Нова стая">
        <label htmlFor="name">Твоето име</label>
        <input id="name" />
        <button type="submit">Създай стая</button>
      </Dialog>,
    );
    expect(screen.getByLabelText('Твоето име')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Затвори' })).toBeInTheDocument();
  });
});
