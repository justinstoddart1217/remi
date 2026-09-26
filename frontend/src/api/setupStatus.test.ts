import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import {
  fetchSetupStatus,
  parseSetupStatus,
  retrySetupStatus,
  SETUP_STATUS_RETRIES,
  setupStatusKey,
  useSetupStatus,
} from '../app/useSetupStatus';
import { errorResponse, fixtureSetupStatus, renderWithClient, server, setupMockApi } from '../test/msw';
import { RemiApiError } from './client';

const mock = setupMockApi();

const FALLBACK = { required: false, source: 'fallback', data: null };

describe('useSetupStatus (GET /api/setup)', () => {
  it('reads needsSetup and keeps the full answer for the wizard', async () => {
    mock.api.state.plan = null;
    const { result, client } = renderWithClient(() => useSetupStatus());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toMatchObject({ required: true, source: 'api' });
    expect(result.current.data?.data?.regions.map((r) => r.code)).toEqual(['GB-ENG', 'ZA']);
    expect(result.current.data?.data?.missing).toEqual(['moveDate']);
    // A real answer holds until the wizard invalidates it.
    expect(client.getQueryCache().find({ queryKey: setupStatusKey })?.isStale()).toBe(false);
  });

  it('lets the app through once setup is complete', async () => {
    await expect(fetchSetupStatus()).resolves.toMatchObject({ required: false, source: 'api' });
  });

  it('falls back to "not required" only when the route does not exist (404/501)', async () => {
    server.use(http.get('*/api/setup', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    await expect(fetchSetupStatus()).resolves.toEqual(FALLBACK);
    server.use(http.get('*/api/setup', () => new HttpResponse(null, { status: 404 })));
    await expect(fetchSetupStatus()).resolves.toEqual(FALLBACK);
  });

  it('treats every other failure as an error, never as "not required"', async () => {
    const cases: [() => Response, number, string][] = [
      [() => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong.'), 500, 'INTERNAL_ERROR'],
      [() => errorResponse(403, 'FORBIDDEN_ORIGIN'), 403, 'FORBIDDEN_ORIGIN'],
      [() => new HttpResponse('Bad Gateway', { status: 502 }), 502, 'HTTP_ERROR'],
      [() => new HttpResponse(null, { status: 504 }), 504, 'HTTP_ERROR'],
      [() => HttpResponse.error(), 0, 'NETWORK_ERROR'],
      [() => HttpResponse.json({ hello: 'world' }), 200, 'BAD_RESPONSE'],
    ];
    for (const [answer, status, code] of cases) {
      server.use(http.get('*/api/setup', answer));
      const error = await fetchSetupStatus().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RemiApiError);
      expect(error).toMatchObject({ status, code });
    }
  });

  it('retries a missing answer or a server error, never a 4xx or a bad shape', () => {
    const err = (status: number, code = 'X') => new RemiApiError({ status, code, message: '' });
    expect(retrySetupStatus(0, err(0, 'NETWORK_ERROR'))).toBe(true);
    expect(retrySetupStatus(0, err(500, 'INTERNAL_ERROR'))).toBe(true);
    expect(retrySetupStatus(1, err(502, 'HTTP_ERROR'))).toBe(true);
    expect(retrySetupStatus(SETUP_STATUS_RETRIES, err(500))).toBe(false);
    expect(retrySetupStatus(0, err(403, 'FORBIDDEN_ORIGIN'))).toBe(false);
    expect(retrySetupStatus(0, err(200, 'BAD_RESPONSE'))).toBe(false);
    expect(retrySetupStatus(0, new Error('boom'))).toBe(false);
  });

  it('never caches the fallback: it is stale at once, so the next mount asks again', async () => {
    server.use(http.get('*/api/setup', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    const { result, client } = renderWithClient(() => useSetupStatus());
    await waitFor(() => {
      expect(result.current.data).toEqual(FALLBACK);
    });
    expect(client.getQueryCache().find({ queryKey: setupStatusKey })?.isStale()).toBe(true);
  });

  it('a transient 500 is retried and the real answer wins', async () => {
    mock.api.state.plan = null;
    let failures = 0;
    server.use(
      http.get(
        '*/api/setup',
        () => {
          failures += 1;
          return errorResponse(500, 'INTERNAL_ERROR');
        },
        { once: true },
      ),
    );
    const { result } = renderWithClient(() => useSetupStatus());
    expect(result.current.isPending).toBe(true);
    await waitFor(
      () => {
        expect(result.current.data).toMatchObject({ required: true, source: 'api' });
      },
      { timeout: 4_000 },
    );
    expect(failures).toBe(1);
    expect(mock.api.requestsTo('/api/setup')).toHaveLength(1);
  });

  it('understands the older {required} and {setupComplete} shapes', () => {
    expect(parseSetupStatus({ required: true })).toEqual({ required: true, source: 'api', data: null });
    expect(parseSetupStatus({ setupComplete: true })).toEqual({ required: false, source: 'api', data: null });
    expect(parseSetupStatus('nope')).toBeNull();
    expect(parseSetupStatus({ hello: 'world' })).toBeNull();
    const full = fixtureSetupStatus({ needsSetup: true });
    expect(parseSetupStatus(full)).toEqual({ required: true, source: 'api', data: full });
  });
});
