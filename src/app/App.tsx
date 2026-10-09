import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { GameAudioProvider } from '@/features/audio/GameAudioProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { createQueryClient } from '@/shared/lib/queryClient';

import { routes } from './routes';

const router = createBrowserRouter(routes);

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GameAudioProvider>
          <RouterProvider router={router} />
        </GameAudioProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
