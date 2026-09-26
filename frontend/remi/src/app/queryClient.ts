import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient for the app. The API is local, so retries are short and windows refocusing
 * refetch (the day may have rolled over). Structural sharing stays on: stable object
 * identities keep the CSS transitions animating from their old values.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
