/**
 * First-run status for SetupGate: `GET /api/setup` (`SetupStatusOut.needsSetup`).
 *
 * SetupGate's semantics: while the status loads it renders nothing; `required` sends every
 * route to /setup. The full answer (defaults, regions, AI status) is kept in `data` for the
 * wizard. `required` and `setupComplete` are also understood, for older stubs.
 *
 * Only a route that does not exist yet (404, or 501 from a stub) counts as "setup not
 * required" (C1-platform.md §3), so the dev shell still renders. That fallback is never cached
 * as settled: it is stale at once, so the next mount or focus asks again. Every other failure
 * (500, 403, a proxy's 502/504, no answer at all, a 2xx in an unknown shape) is an error, not an
 * answer: transient ones are retried, and an error keeps no data, so it is asked again too.
 */

import { useQuery } from '@tanstack/react-query';
import type { Query } from '@tanstack/react-query';

import { api, isAbortError, parseApiError, RemiApiError, toNetworkError } from '../api/client';
import type { ApiResult } from '../api/client';
import { keys } from '../api/keys';
import type { SetupStatusOut } from '../api/types';

export interface SetupStatus {
  required: boolean;
  /** 'api' when the backend answered, 'fallback' when the route does not exist (404/501). */
  source: 'api' | 'fallback';
  /** The backend's answer when it is a full `SetupStatusOut`, else null. */
  data: SetupStatusOut | null;
}

export const setupStatusKey = keys.setup.status;

const FALLBACK: SetupStatus = { required: false, source: 'fallback', data: null };

/** The statuses that mean "this backend has no setup route yet". */
const NO_ROUTE_STATUSES: ReadonlySet<number> = new Set([404, 501]);

/** How many times a transient failure (no answer, 5xx) is retried before it shows as an error. */
export const SETUP_STATUS_RETRIES = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSetupStatusOut(body: Record<string, unknown>): boolean {
  return (
    typeof body.needsSetup === 'boolean' &&
    typeof body.today === 'string' &&
    Array.isArray(body.missing) &&
    Array.isArray(body.regions) &&
    isRecord(body.defaults) &&
    isRecord(body.ai)
  );
}

/** Reads a 2xx body; null when it is not a setup status in any known shape. */
export function parseSetupStatus(body: unknown): SetupStatus | null {
  if (!isRecord(body)) return null;
  const data = isSetupStatusOut(body) ? (body as unknown as SetupStatusOut) : null;
  for (const key of ['needsSetup', 'required', 'setupRequired']) {
    const value = body[key];
    if (typeof value === 'boolean') return { required: value, source: 'api', data };
  }
  const complete = body.setupComplete;
  if (typeof complete === 'boolean') return { required: !complete, source: 'api', data };
  return null;
}

/**
 * Asks the backend. Resolves to the answer, or to the "not required" fallback for 404/501.
 * Throws `RemiApiError` for anything else (aborts rethrow as they are).
 */
export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  let result: ApiResult<SetupStatusOut>;
  try {
    result = await api.GET('/setup', { signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw toNetworkError(error);
  }
  const { response } = result;
  if (NO_ROUTE_STATUSES.has(response.status)) return FALLBACK;
  if (!response.ok) throw parseApiError(response.status, result.error, response.statusText);
  const status = parseSetupStatus(result.data);
  if (status === null) {
    throw new RemiApiError({
      status: response.status,
      code: 'BAD_RESPONSE',
      message: 'The setup status came back in an unexpected shape.',
    });
  }
  return status;
}

/** Retries a missing answer or a server error (not 4xx, not a bad shape). */
export function retrySetupStatus(failureCount: number, error: unknown): boolean {
  if (failureCount >= SETUP_STATUS_RETRIES) return false;
  if (!(error instanceof RemiApiError)) return false;
  return error.status === 0 || error.status >= 500;
}

/** A real answer holds until something invalidates it (the wizard); the fallback never does. */
function setupStaleTime(query: Query<SetupStatus, RemiApiError, SetupStatus, typeof setupStatusKey>): number {
  return query.state.data?.source === 'api' ? Infinity : 0;
}

export function useSetupStatus() {
  return useQuery<SetupStatus, RemiApiError, SetupStatus, typeof setupStatusKey>({
    queryKey: setupStatusKey,
    queryFn: ({ signal }) => fetchSetupStatus(signal),
    staleTime: setupStaleTime,
    retry: retrySetupStatus,
  });
}
