/**
 * The msw server for unit tests (Node interceptors; no service worker).
 *
 *   const mock = setupMockApi();          // at file level or in a describe block
 *   mock.api.state.plan = fixturePlan();  // per test
 *   server.use(http.post('*\/api/notes', …));
 *
 * `setupMockApi` registers the lifecycle hooks: listen before all tests (unhandled requests
 * fail the test), a fresh `createMockApi()` before each test, handlers reset after each, and
 * close after all.
 */

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { createMockApi } from './handlers';
import type { MockApi } from './handlers';

export const server = setupServer();

export interface MockApiHandle {
  /** The current test's mock API (replaced before each test). */
  readonly api: MockApi;
}

export function setupMockApi(initial?: Parameters<typeof createMockApi>[0]): MockApiHandle {
  let current = createMockApi(initial);
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });
  beforeEach(() => {
    current = createMockApi(initial);
    server.use(...current.handlers);
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
  return {
    get api() {
      return current;
    },
  };
}
