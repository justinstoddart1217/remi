import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { errorResponse, server, setupMockApi } from '../test/msw';
import {
  api,
  chartUrl,
  isAbortError,
  isRemiApiError,
  newParseId,
  parseApiError,
  readErrorEnvelope,
  RemiApiError,
  retryApi,
  unwrap,
} from './client';

describe('error envelope parsing', () => {
  it('reads {error: {code, message, field}}', () => {
    const error = parseApiError(422, { error: { code: 'VALIDATION_ERROR', message: 'Too long', field: 'name' } });
    expect(error).toBeInstanceOf(RemiApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Too long', field: 'name' });
    expect(error.name).toBe('RemiApiError');
    expect(error.is('VALIDATION_ERROR', 'VALIDATION_FAILED')).toBe(true);
  });

  it('defaults field to null and tolerates a missing message', () => {
    expect(parseApiError(409, { error: { code: 'SETUP_REQUIRED' } })).toMatchObject({
      status: 409,
      code: 'SETUP_REQUIRED',
      message: '',
      field: null,
    });
  });

  it('falls back to HTTP_ERROR for bodies that are not the envelope', () => {
    expect(parseApiError(400, 'Invalid host header')).toMatchObject({
      status: 400,
      code: 'HTTP_ERROR',
      message: 'Invalid host header',
      field: null,
    });
    expect(parseApiError(502, undefined, 'Bad Gateway')).toMatchObject({ code: 'HTTP_ERROR', message: 'Bad Gateway' });
    expect(parseApiError(500, '')).toMatchObject({ message: 'Request failed with status 500' });
    expect(parseApiError(404, { detail: 'Not Found' })).toMatchObject({ code: 'HTTP_ERROR', status: 404 });
  });

  it('rejects malformed envelopes', () => {
    expect(readErrorEnvelope({ error: 'nope' })).toBeNull();
    expect(readErrorEnvelope({ error: { code: '' } })).toBeNull();
    expect(readErrorEnvelope(null)).toBeNull();
    expect(readErrorEnvelope({ error: { code: 'CONFLICT', message: 'x', field: 3 } })).toEqual({
      code: 'CONFLICT',
      message: 'x',
      field: null,
    });
  });

  it('narrows with isRemiApiError and retries only when a retry can help', () => {
    const conflict = new RemiApiError({ status: 409, code: 'VERSION_CONFLICT', message: '' });
    expect(isRemiApiError(conflict)).toBe(true);
    expect(isRemiApiError(conflict, 'VERSION_CONFLICT')).toBe(true);
    expect(isRemiApiError(conflict, 'CONFLICT')).toBe(false);
    expect(isRemiApiError(new Error('x'))).toBe(false);

    expect(retryApi(0, conflict)).toBe(false);
    expect(retryApi(0, new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: '' }))).toBe(true);
    expect(retryApi(0, new RemiApiError({ status: 504, code: 'AI_TIMEOUT', message: '' }))).toBe(true);
    expect(retryApi(1, new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: '' }))).toBe(false);
    expect(retryApi(0, new RemiApiError({ status: 501, code: 'NOT_IMPLEMENTED', message: '' }))).toBe(false);
  });

  it('makes UUID parse ids and chart URLs', () => {
    expect(newParseId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newParseId()).not.toBe(newParseId());
    expect(chartUrl('a b')).toBe('/api/charts/a%20b');
  });
});

describe('api client', () => {
  const mock = setupMockApi();

  it('sends X-Remi-Client: 1 to /api paths written without the prefix', async () => {
    const settings = await unwrap(api.GET('/settings'));
    expect(settings.setupComplete).toBe(true);
    const [sent] = mock.api.requestsTo('/api/settings');
    expect(sent?.headers.get('X-Remi-Client')).toBe('1');
  });

  it('throws the server envelope as RemiApiError', async () => {
    mock.api.state.plan = null;
    const error: unknown = await unwrap(api.GET('/plan')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemiApiError);
    expect(error).toMatchObject({ status: 409, code: 'SETUP_REQUIRED', field: null });
  });

  it('keeps the offending field from a 422', async () => {
    server.use(http.post('*/api/notes', () => errorResponse(422, 'VALIDATION_ERROR', 'Text is required.', 'text')));
    const error: unknown = await unwrap(api.POST('/notes', { body: { day: '2026-10-05', text: '' } })).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', message: 'Text is required.', field: 'text' });
  });

  it('turns a plain-text failure into HTTP_ERROR', async () => {
    server.use(http.get('*/api/home', () => new HttpResponse('Invalid host header', { status: 400 })));
    await expect(unwrap(api.GET('/home'))).rejects.toMatchObject({
      status: 400,
      code: 'HTTP_ERROR',
      message: 'Invalid host header',
    });
  });

  it('turns a network failure into NETWORK_ERROR with status 0', async () => {
    server.use(http.get('*/api/home', () => HttpResponse.error()));
    await expect(unwrap(api.GET('/home'))).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('lets aborts through untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const error: unknown = await unwrap(api.GET('/home', { signal: controller.signal })).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(RemiApiError);
  });

  it('answers 501 NOT_IMPLEMENTED for routes the mock does not serve', async () => {
    await expect(unwrap(api.GET('/feed'))).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });
  });
});
