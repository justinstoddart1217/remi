import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';

import { Providers } from '../app/providers';
import { routes } from '../app/router';

/** Stubs GET /api/setup (501: not implemented yet, so setup counts as not required). */
export function stubSetupApi(status = 501, body: unknown = null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        body === null
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      ),
    ),
  );
}

/** Renders the real route table in a memory router at `path`. */
export function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router, client };
}
