// Where the production app runs for the Remi projects (parity, behaviour, egress), and how a
// run is selected. Everything binds to 127.0.0.1. The ports are this harness's own
// (REMI_PARITY_API_PORT / REMI_PARITY_WEB_PORT override them), so it can run beside `make dev`
// and other local pairs. A run's scratch (pids, logs, build, Playwright output) lives under its
// port pair, so runs on different ports do not touch each other's servers; only one parity run
// at a time may write the shared report (servers.ts takes a lock for it).
//
// A Playwright invocation is a "Remi run" when PARITY_TARGET=remi (the Make targets set it) or
// when it selects a remi project on the command line (--project=remi, behaviour, egress).
// A Remi run gets the backend + frontend globalSetup; a prototype run gets the design folder's
// http.server instead.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARITY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(PARITY_DIR, '..');
export const BACKEND_DIR = path.join(REPO_DIR, 'backend');
export const FRONTEND_DIR = path.join(REPO_DIR, 'frontend');
export const HOST = '127.0.0.1';
export const API_PORT = Number(process.env.REMI_PARITY_API_PORT ?? 8804);
export const WEB_PORT = Number(process.env.REMI_PARITY_WEB_PORT ?? 5304);
/** "8804-5304": names this run's scratch and Playwright output directories. */
export const PORT_PAIR = `${String(API_PORT)}-${String(WEB_PORT)}`;

/** Scratch for all runs; ignored by git (parity/.gitignore). */
export const RUN_ROOT = path.join(PARITY_DIR, '.remi-run');
/** Scratch for runs on this port pair: pids, logs, the temporary build. */
export const RUN_DIR = path.join(RUN_ROOT, PORT_PAIR);
export const API_URL = `http://${HOST}:${String(API_PORT)}`;
export const WEB_URL = `http://${HOST}:${String(WEB_PORT)}`;

/** The day the fixture plan is built around (REMI_TODAY). */
export const REMI_TODAY = '2026-10-05';
/** The server's frozen clock (REMI_NOW): the browser's pinned instant (drivers/common.ts FIXED_NOW). */
export const REMI_NOW = '2026-10-05T09:30:00+01:00';
/** The business timezone of every run: the browser's, and the server's default (REMI_DEFAULT_TIMEZONE). */
export const TIMEZONE = 'Europe/London';

/** Playwright projects that drive the production app. */
export const REMI_PROJECTS = ['remi', 'behaviour', 'egress'] as const;

/**
 * How the frontend is served:
 *   vite     the Vite dev server on WEB_PORT, proxying /api to the backend (default)
 *   build    a fresh `vite build` of the current tree: served by the backend when it serves the
 *            SPA (P4 `make serve`), else by `vite preview` on WEB_PORT; falls back to `vite`
 *            when the build fails. The egress suite uses this.
 */
export type ServeMode = 'vite' | 'build';

/** The fixture the run starts from: `design` (the prototype's sample plan) or `empty`. */
export type FixtureName = 'design' | 'empty';

function argvSelectsRemi(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const value = a.startsWith('--project=') ? a.slice('--project='.length) : a === '--project' ? (argv[i + 1] ?? '') : null;
    if (value !== null && (REMI_PROJECTS as readonly string[]).includes(value)) return true;
  }
  return false;
}

/** The Remi projects a command line selects (all of them when it names none). */
export function selectedRemiProjects(argv: readonly string[] = process.argv): string[] {
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const value = a.startsWith('--project=') ? a.slice('--project='.length) : a === '--project' ? (argv[i + 1] ?? '') : null;
    if (value !== null) picked.push(value);
  }
  const remi = picked.filter((p) => (REMI_PROJECTS as readonly string[]).includes(p));
  return picked.length ? remi : [...REMI_PROJECTS];
}

/** Called by playwright.config.ts in the runner; the answer is exported to workers via env. */
export function isRemiRun(): boolean {
  if (process.env.PARITY_TARGET === 'remi') return true;
  if (process.env.PARITY_TARGET === 'prototype') return false;
  if (argvSelectsRemi(process.argv)) {
    process.env.PARITY_TARGET = 'remi';
    return true;
  }
  return false;
}

export function serveMode(): ServeMode {
  return process.env.PARITY_SERVE === 'build' ? 'build' : 'vite';
}

export function fixtureName(): FixtureName {
  return process.env.PARITY_FIXTURE === 'empty' ? 'empty' : 'design';
}

/** The URL the browser opens: set by globalSetup (backend-served build or WEB_URL). */
export function remiBaseUrl(): string {
  return process.env.REMI_PARITY_BASE_URL ?? WEB_URL;
}

/** The fake AI server (see fake-ai.ts), when globalSetup started one. */
export function fakeAiUrl(): string | null {
  return process.env.REMI_PARITY_FAKE_AI_URL ?? null;
}
