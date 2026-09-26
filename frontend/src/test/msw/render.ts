import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';

/** A QueryClient for tests: no retries, nothing garbage-collected mid-test. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithClientOptions<P> {
  client?: QueryClient;
  initialProps?: P;
}

/** `renderHook` inside a QueryClientProvider. Returns the client too. */
export function renderWithClient<T, P = undefined>(
  hook: (props: P) => T,
  { client = createTestQueryClient(), initialProps }: RenderWithClientOptions<P> = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(hook, { wrapper, initialProps }), client };
}
