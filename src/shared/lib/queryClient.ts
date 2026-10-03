import { QueryClient } from '@tanstack/react-query';

/**
 * Server state cache. Realtime subscriptions will push updates into this cache
 * (via `queryClient.setQueryData` / invalidation) rather than into a separate store,
 * so components read room/round data through one consistent mechanism.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime keeps data fresh; avoid refetch storms when players switch tabs.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 2,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
