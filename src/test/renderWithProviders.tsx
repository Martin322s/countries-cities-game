import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import type { PlayerId } from '@/domain';
import { AuthContext, type AuthState } from '@/features/auth/authContext';

interface Options {
  auth?: AuthState;
  path?: string;
  initialEntry?: string;
  /** Extra routes, e.g. a stub for the navigation target. */
  routes?: RouteObject[];
}

export const TEST_PLAYER_ID = 'player-test' as PlayerId;

/** Renders `ui` with the same providers as the app (query cache, auth identity, router). */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const {
    auth = { status: 'ready', playerId: TEST_PLAYER_ID },
    path = '/',
    initialEntry = path,
    routes = [],
  } = options;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path, element: ui }, ...routes], {
    initialEntries: [initialEntry],
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext value={{ state: auth, slow: false, retry: () => undefined }}>
        <RouterProvider router={router} />
      </AuthContext>
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}
