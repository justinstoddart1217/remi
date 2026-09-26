/**
 * msw handlers that behave like the Remi API for unit tests:
 * - `GET /api/plan` answers the fixture plan with `ETag: "<revision>"`, 304 for a matching
 *   `If-None-Match`, and 409 `SETUP_REQUIRED` while `state.plan` is null;
 * - `GET /api/setup`, `/settings`, `/ai/status`, `/home` and `/health` answer fixtures;
 * - anything else under `/api` answers 501 `NOT_IMPLEMENTED`, like a route whose service is
 *   not built yet. Tests add their own handlers with `server.use(...)`.
 *
 * Every request is logged in `state.requests` (method, path, headers), so tests can assert what
 * was sent.
 */

import { http, HttpResponse } from 'msw';
import type { HttpHandler } from 'msw';

import type { AiStatusOut, HomeOut, PlanOut, SettingsOut, SetupStatusOut } from '../../api/types';
import { fixtureAiStatus, fixtureHome, fixturePlan, fixtureSettings, fixtureSetupStatus } from './fixtures';

/** The backend's error envelope. */
export function errorResponse(status: number, code: string, message = code, field: string | null = null) {
  return HttpResponse.json({ error: { code, message, field } }, { status });
}

export interface LoggedRequest {
  method: string;
  /** Path and query, e.g. `/api/plan`. */
  path: string;
  headers: Headers;
}

export interface MockApiState {
  /** The plan `GET /api/plan` serves; null means setup has not run (409 SETUP_REQUIRED). */
  plan: PlanOut | null;
  settings: SettingsOut;
  ai: AiStatusOut;
  home: HomeOut;
  setup: SetupStatusOut;
  requests: LoggedRequest[];
}

export interface MockApi {
  state: MockApiState;
  handlers: HttpHandler[];
  /** Requests to a path (exact, without the query string), optionally one method. */
  requestsTo: (path: string, method?: string) => LoggedRequest[];
}

export function createMockApi(initial: Partial<Omit<MockApiState, 'requests'>> = {}): MockApi {
  const state: MockApiState = {
    plan: initial.plan === undefined ? fixturePlan() : initial.plan,
    settings: initial.settings ?? fixtureSettings(),
    ai: initial.ai ?? fixtureAiStatus(),
    home: initial.home ?? fixtureHome(),
    setup: initial.setup ?? fixtureSetupStatus(),
    requests: [],
  };

  const log = http.all('*/api/*', ({ request }) => {
    const url = new URL(request.url);
    state.requests.push({ method: request.method, path: `${url.pathname}${url.search}`, headers: request.headers });
    // Fall through to the next matching handler.
    return undefined;
  });

  const handlers: HttpHandler[] = [
    log,
    http.get('*/api/plan', ({ request }) => {
      const plan = state.plan;
      if (!plan) return errorResponse(409, 'SETUP_REQUIRED', 'Setup is not complete.');
      const etag = `"${String(plan.revision)}"`;
      if (request.headers.get('If-None-Match') === etag) {
        return new HttpResponse(null, { status: 304, headers: { ETag: etag } });
      }
      return HttpResponse.json(plan, { headers: { ETag: etag } });
    }),
    http.get('*/api/setup', () =>
      HttpResponse.json({ ...state.setup, needsSetup: state.plan === null, missing: state.plan ? [] : ['moveDate'] }),
    ),
    http.get('*/api/settings', () => HttpResponse.json(state.settings)),
    http.get('*/api/ai/status', () => HttpResponse.json(state.ai)),
    http.get('*/api/home', () => HttpResponse.json({ ...state.home, needsSetup: state.plan === null })),
    http.get('*/api/health', () => HttpResponse.json({ app: 'remi', version: '0.1.0' })),
    http.all('*/api/*', () => errorResponse(501, 'NOT_IMPLEMENTED', 'Not implemented yet.')),
  ];

  return {
    state,
    handlers,
    requestsTo: (path, method) =>
      state.requests.filter((r) => r.path.split('?')[0] === path && (method === undefined || r.method === method)),
  };
}
