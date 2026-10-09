import type { RouteObject } from 'react-router';

import { LandingPage } from '@/features/landing/LandingPage';
import { RoomPage } from '@/features/lobby/RoomPage';

import { AppLayout } from './layout/AppLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';

/**
 * Route table.
 *   /            → landing (create / join)
 *   /room/:code  → the room; the screen is driven by membership and the server phase
 *   /privacy     → privacy notice;  /about → what the game is, fair-play notice
 */
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'room/:code', element: <RoomPage /> },
      // Text pages load on demand (not part of the game bundle).
      {
        path: 'privacy',
        lazy: async () => ({ Component: (await import('./pages/PrivacyPage')).PrivacyPage }),
      },
      {
        path: 'about',
        lazy: async () => ({ Component: (await import('./pages/AboutPage')).AboutPage }),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
