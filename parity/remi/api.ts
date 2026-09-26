// The harness's own calls to the Remi API (from the test process, never the page): fixture
// resets, settings, the AI stub, and reads for behaviour assertions. Mutations carry the
// backend's own Origin and X-Remi-Client: 1, as the mutation guard requires (docs/api.md).

import type { ClaudeStub } from '../drivers/types.ts';
import { API_URL, fakeAiUrl, type FixtureName } from './env.ts';
import { FAKE_MODEL } from './fake-ai.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what}: HTTP ${String(status)} ${body.slice(0, 400)}`);
  }
}

export async function api<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${route}`, {
    method,
    headers: {
      'X-Remi-Client': '1',
      Origin: API_URL,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text, `${method} /api${route}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const loadFixture = (fixture: FixtureName) => api('POST', '/dev/fixtures', { fixture });

export interface SettingsLite {
  aiProvider: 'none' | 'anthropic' | 'ollama';
  ollamaBaseUrl: string;
  aiModel: string | null;
  [key: string]: unknown;
}

export const getSettings = () => api<SettingsLite>('GET', '/settings');
export const patchSettings = (patch: Record<string, unknown>) => api('PATCH', '/settings', patch);

/**
 * Point Tell Remi at the right provider for a state (the prototype's window.claude stub):
 * `none` is the default provider (the simple reading); `fixture`, `error` and `pending` use
 * the fake Ollama server (remi/fake-ai.ts) in that mode, with recent notes sent, as the
 * prototype's reader does (its Notes copy says notes go along with every update).
 *
 * Settings are global. Only the states that name a stub call this (drivers/remi.ts boot), and
 * the parity spec runs them one after another in one worker, apart from nothing else that
 * reads the AI setting; the behaviour and egress suites run in one worker throughout.
 */
export async function useAiStub(stub: ClaudeStub | undefined): Promise<void> {
  const current = await getSettings();
  if (!stub || stub === 'none') {
    if (current.aiProvider !== 'none') await patchSettings({ aiProvider: 'none' });
    return;
  }
  const url = fakeAiUrl();
  if (!url) throw new Error('the fake AI server is not running (REMI_PARITY_FAKE_AI_URL is unset; globalSetup starts it)');
  const res = await fetch(`${url}/__parity/mode`, { method: 'POST', body: JSON.stringify({ mode: stub }) });
  if (!res.ok) throw new Error(`fake AI mode ${stub}: HTTP ${String(res.status)}`);
  if (current.aiProvider !== 'ollama' || current.ollamaBaseUrl !== url || current.aiModel !== FAKE_MODEL || current.aiSendRecentNotes !== true) {
    await patchSettings({ aiProvider: 'ollama', ollamaBaseUrl: url, aiModel: FAKE_MODEL, aiSendRecentNotes: true });
  }
}

// ------------------------------------------------------------------ reads for assertions
export interface ProjectLite {
  id: string;
  name: string;
  short: string;
  targetDate: string | null;
  forecastDate: string | null;
  rate: number;
  confidence: number | null;
  blocker: string | null;
  derived: { status: string; deltaBd: number | null; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PlanLite {
  revision: number;
  projects: ProjectLite[];
  routines: { id: string; name: string; rule: { kind: string; bd: number | null; weekday: number | null }; [key: string]: unknown }[];
  verdict: { state: string; bufferBd: number | null; [key: string]: unknown };
  move: { date: string; countdownBd: number; [key: string]: unknown };
  loads: Record<string, { total: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

export const getPlan = () => api<PlanLite>('GET', '/plan');

export async function getProject(id: string): Promise<ProjectLite | undefined> {
  return (await getPlan()).projects.find((p) => p.id === id);
}
