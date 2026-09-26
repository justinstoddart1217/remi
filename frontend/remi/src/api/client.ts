/**
 * The typed API client over the generated contract (`make openapi` → `schema.d.ts`).
 *
 * - `baseUrl` is `/api` and paths are written without it: `api.GET('/plan')`. The generated
 *   `paths` carry the prefix, so `ApiPaths` strips it at the type level.
 * - Every request sends `X-Remi-Client: 1`, which the backend requires on mutations.
 * - Failures become a typed `RemiApiError {status, code, message, field}` parsed from the
 *   backend's envelope `{"error": {code, message, field}}` (docs/api.md, "Error codes").
 *
 * `fetch` and `Request` are looked up per request (not captured at import), so msw and test
 * stubs installed after this module loads still see every call. Relative URLs are resolved
 * against the document, as a browser would; Node's `Request` (tests) needs an absolute URL.
 */

import createClient from 'openapi-fetch';

import { basePath } from '../lib/basePath';

import type { components, paths } from './schema';

/** The generated `paths` without their `/api` prefix (the client's `baseUrl`). */
export type ApiPaths = {
  [K in keyof paths as K extends `/api${infer Rest}` ? Rest : never]: paths[K];
};

/** Component schemas: `Schemas['PlanOut']`. */
export type Schemas = components['schemas'];

/** `/api` under the page's base path: `/api` on the laptop, `/remi/api` behind the proxy. */
export const API_BASE_URL = `${basePath()}/api`;

export const CLIENT_HEADER = 'X-Remi-Client';

/** Resolves a relative URL against the document, as `fetch` does in a browser. */
export function resolveUrl(url: string): string {
  if (typeof document === 'undefined') return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

/** A `Request` that accepts relative URLs everywhere (Node's needs an absolute one). */
class SameOriginRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? resolveUrl(input) : input, init);
  }
}

export const api = createClient<ApiPaths>({
  baseUrl: API_BASE_URL,
  headers: { [CLIENT_HEADER]: '1' },
  Request: SameOriginRequest,
  fetch: (request) => globalThis.fetch(request),
});

export type ApiClient = typeof api;

// ---------------------------------------------------------------------------------------------
// Errors

/** Error codes from the backend catalogue (app/schemas/errors.py), plus the client's own. */
export type ServerErrorCode =
  | 'VALIDATION_ERROR'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_IMPLEMENTED'
  | 'SETUP_REQUIRED'
  | 'SETUP_ALREADY_DONE'
  | 'CONFLICT'
  | 'DOMAIN_ERROR'
  | 'VERSION_CONFLICT'
  | 'SECTION_NOT_EMPTY'
  | 'LAST_SECTION'
  | 'NOT_AN_OCCURRENCE'
  | 'RUN_NOT_EDITABLE'
  | 'OUT_OF_RANGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'AI_NOT_CONFIGURED'
  | 'AI_AUTH'
  | 'AI_BAD_REPLY'
  | 'AI_UNAVAILABLE'
  | 'AI_RATE_LIMITED'
  | 'AI_TIMEOUT'
  | 'PARSE_CANCELLED'
  | 'FORBIDDEN_ORIGIN'
  | 'CLIENT_HEADER_REQUIRED'
  | 'INTERNAL_ERROR';

/**
 * Client-side codes:
 * - `NETWORK_ERROR`: the request never got an HTTP answer (status 0);
 * - `HTTP_ERROR`: an HTTP failure without the JSON envelope (e.g. the plain-text 400
 *   "Invalid host header");
 * - `BAD_RESPONSE`: a 2xx whose body is not what the contract promises.
 */
export type ClientErrorCode = 'NETWORK_ERROR' | 'HTTP_ERROR' | 'BAD_RESPONSE';

/** Any code; unknown server codes pass through as strings. */
export type ApiErrorCode = ServerErrorCode | ClientErrorCode | (string & {});

export interface ApiErrorInit {
  status: number;
  code: ApiErrorCode;
  message: string;
  field?: string | null;
}

/** A failed API call: the backend's error envelope, or a client-side stand-in. */
export class RemiApiError extends Error {
  override readonly name = 'RemiApiError';
  /** HTTP status; 0 when there was no HTTP answer. */
  readonly status: number;
  readonly code: ApiErrorCode;
  /** The camelCase request field at fault, or null. */
  readonly field: string | null;

  constructor({ status, code, message, field = null }: ApiErrorInit) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }

  /** True for the given code(s). */
  is(...codes: ApiErrorCode[]): boolean {
    return codes.includes(this.code);
  }
}

export function isRemiApiError(error: unknown, ...codes: ApiErrorCode[]): error is RemiApiError {
  return error instanceof RemiApiError && (codes.length === 0 || codes.includes(error.code));
}

/** True for an aborted request (AbortController, query cancellation, unmount). */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error.name === 'AbortError' || error.name === 'CancelledError')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The backend envelope `{error: {code, message, field}}`, or null for anything else. */
export function readErrorEnvelope(body: unknown): Schemas['ErrorBody'] | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, message, field } = body.error;
  if (typeof code !== 'string' || code === '') return null;
  return {
    code,
    message: typeof message === 'string' ? message : '',
    field: typeof field === 'string' ? field : null,
  };
}

/**
 * Builds the error for a failed response. `body` is what openapi-fetch parsed: the JSON
 * envelope, a plain-text string, or undefined for an empty body.
 */
export function parseApiError(status: number, body: unknown, statusText = ''): RemiApiError {
  const envelope = readErrorEnvelope(body);
  if (envelope) return new RemiApiError({ status, ...envelope });
  const text = typeof body === 'string' ? body.trim() : '';
  const message = text !== '' ? text : statusText !== '' ? statusText : `Request failed with status ${String(status)}`;
  return new RemiApiError({ status, code: 'HTTP_ERROR', message });
}

/** Wraps a thrown `fetch` failure (network down, CORS, …). Abort errors pass through. */
export function toNetworkError(error: unknown): unknown {
  if (isAbortError(error) || error instanceof RemiApiError) return error;
  const message = error instanceof Error && error.message !== '' ? error.message : 'The Remi server could not be reached.';
  return new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message });
}

/** What every openapi-fetch call resolves to. */
export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Awaits an openapi-fetch call and returns its data, or throws `RemiApiError`.
 * Aborts rethrow as they are, so TanStack Query treats them as cancellations.
 */
export async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call;
  } catch (error) {
    throw toNetworkError(error);
  }
  const { response } = result;
  if (!response.ok) throw parseApiError(response.status, result.error, response.statusText);
  return result.data as T;
}

/**
 * Retry policy for queries: once, and only when a retry can help (no HTTP answer, or the AI
 * gateway statuses). Contract errors (4xx, 501) never retry.
 */
export function retryApi(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (!(error instanceof RemiApiError)) return false;
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
}

/** A fresh id for a check-in parse session (`ParseRequest.parseId`, a UUID). */
export function newParseId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The iframe `src` for an uploaded chart (`GET /api/charts/{assetId}`, strict sandbox CSP). */
export function chartUrl(assetId: string): string {
  return `${API_BASE_URL}/charts/${encodeURIComponent(assetId)}`;
}
