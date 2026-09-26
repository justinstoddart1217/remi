// Starts and stops the production app for a Remi run (globalSetup / globalTeardown):
//
//   backend   cd backend && uv run python -m remi.main --no-browser --port API_PORT
//             REMI_ENV=test REMI_TODAY=2026-10-05 REMI_NOW=2026-10-05T09:30:00+01:00
//             REMI_DEFAULT_TIMEZONE=Europe/London REMI_DATA_DIR=<fresh temp dir> REMI_WEB_PORT=WEB_PORT
//             then POST /api/dev/fixtures {fixture}
//   frontend  vite     node frontend/node_modules/vite/bin/vite.js (REMI_API_PORT/REMI_WEB_PORT)
//             build    vite build into .remi-run/dist; served by the backend when it serves the
//                      SPA (REMI_FRONTEND_DIST), else by `vite preview` on WEB_PORT (which proxies
//                      /api like the dev server); falls back to vite when the build fails
//   fake AI   remi/fake-ai.ts on an OS-assigned loopback port (check-in drawer states)
//
// Child processes are detached into their own process groups and recorded in
// .remi-run/<api>-<web>/state.json with the runner that owns them, so teardown (or the next run
// on the same ports, after a crash) kills the whole group. A run refuses to start while the
// runner that owns that state is still alive, and never kills a process that is not a backend
// or Vite on its own ports. A parity run also holds report/.parity.lock while it writes
// baselines/remi, report/ and docs/parity-report.md, which all parity runs share.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

import {
  API_PORT,
  API_URL,
  BACKEND_DIR,
  FRONTEND_DIR,
  HOST,
  PARITY_DIR,
  PORT_PAIR,
  REMI_NOW,
  REMI_TODAY,
  RUN_DIR,
  TIMEZONE,
  WEB_PORT,
  WEB_URL,
  type FixtureName,
  type ServeMode,
} from './env.ts';
import { startFakeAi, type FakeAi } from './fake-ai.ts';

const STATE_FILE = path.join(RUN_DIR, 'state.json');
const LOG_DIR = path.join(RUN_DIR, 'logs');
const BUILD_DIR = path.join(RUN_DIR, 'dist');
const VITE_BIN = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');

export type ServedBy = 'vite' | 'preview' | 'backend';

interface RunState {
  /** The Playwright runner that started these (a live owner means a run is in progress). */
  owner?: number;
  procs: { name: string; pid: number; port?: number }[];
  dataDir: string | null;
}

const PARITY_LOCK = path.join(PARITY_DIR, 'report', '.parity.lock');

export interface RemiRun {
  baseURL: string;
  servedBy: ServedBy;
  fakeAiUrl: string;
  buildError: string | null;
}

// The fake AI server lives in the runner process; teardown finds it here.
const G = globalThis as unknown as { __remiParityFakeAi?: FakeAi };

function readState(): RunState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as RunState;
  } catch {
    return { procs: [], dataDir: null };
  }
}

function writeState(state: RunState): void {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killGroup(pid: number): Promise<void> {
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* already gone */
      }
    }
  };
  signal('SIGTERM');
  for (let i = 0; i < 80 && alive(pid); i++) await sleep(100);
  if (alive(pid)) signal('SIGKILL');
}

async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * The environment a child inherits. The backend's leaves out every REMI_* setting and API key of
 * the shell the run started from (a developer's REMI_DATA_DIR, REMI_PORT or ANTHROPIC_API_KEY),
 * so a run depends only on what startBackend sets: a key in the environment would, for example,
 * add the key row to the settings capture.
 */
export function inheritedEnv(name: string, from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (name !== 'backend') return { ...from };
  return Object.fromEntries(Object.entries(from).filter(([k]) => !/^REMI_/.test(k) && !/(^|_)API_KEY$/.test(k)));
}

function spawnLogged(name: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, port: number): number {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(command, args, { cwd, env: { ...inheritedEnv(name), ...env }, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  if (child.pid === undefined) throw new Error(`could not start ${name}: ${command} ${args.join(' ')}`);
  child.unref();
  const state = readState();
  state.procs.push({ name, pid: child.pid, port });
  writeState(state);
  return child.pid;
}

function logTail(name: string, lines = 30): string {
  try {
    return fs.readFileSync(path.join(LOG_DIR, `${name}.log`), 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

async function waitHttp(url: string, what: string, pid: number, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) throw new Error(`${what} exited during startup:\n${logTail(what)}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`${what} did not answer ${url} within ${String(timeoutMs / 1000)}s:\n${logTail(what)}`);
}

/** POST /api/dev/fixtures from the harness (the backend's own origin passes the mutation guard). */
export async function loadFixture(fixture: FixtureName): Promise<void> {
  const res = await fetch(`${API_URL}/api/dev/fixtures`, {
    method: 'POST',
    headers: { 'X-Remi-Client': '1', Origin: API_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ fixture }),
  });
  if (!res.ok) throw new Error(`POST /api/dev/fixtures ${fixture}: ${String(res.status)} ${await res.text()}`);
}

function commandOf(pid: number): string {
  const res = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return res.stdout ?? '';
}

/**
 * True when `pid` is still a backend or Vite this harness started on `port` (pids are reused;
 * never kill a stranger's process group, or another run's servers on other ports).
 */
function isOurs(pid: number, port: number | undefined): boolean {
  const cmd = commandOf(pid);
  if (!/remi\.main|vite\.js/.test(cmd)) return false;
  return port === undefined || new RegExp(`--port[ =]${String(port)}\\b`).test(cmd);
}

/** A live Playwright runner (not this one) that owns `state`. */
function liveOwner(state: RunState): number | null {
  const owner = state.owner;
  if (!owner || owner === process.pid || !alive(owner)) return null;
  return /playwright|node/.test(commandOf(owner)) ? owner : null;
}

/**
 * Refuse while another run on these ports is in progress; otherwise kill what a crashed earlier
 * run left behind, then insist the ports are free.
 */
async function cleanStale(): Promise<void> {
  const state = readState();
  const owner = liveOwner(state);
  if (owner !== null) {
    throw new Error(
      `another Remi run (Playwright pid ${String(owner)}) is using ports ${PORT_PAIR}. Wait for it, or run on other ports ` +
        '(REMI_PARITY_API_PORT / REMI_PARITY_WEB_PORT).',
    );
  }
  for (const p of state.procs) if (alive(p.pid) && isOurs(p.pid, p.port)) await killGroup(p.pid);
  if (state.dataDir) fs.rmSync(state.dataDir, { recursive: true, force: true });
  writeState({ owner: process.pid, procs: [], dataDir: null });
  for (const port of [API_PORT, WEB_PORT]) {
    if (await portInUse(port)) {
      throw new Error(
        `port ${String(port)} on ${HOST} is already in use. The parity harness owns ${String(API_PORT)} (api) and ` +
          `${String(WEB_PORT)} (web); stop whatever is there, or set REMI_PARITY_API_PORT / REMI_PARITY_WEB_PORT.`,
      );
    }
  }
}

function startBackend(dataDir: string, frontendDist: string | null): number {
  const uv = process.env.UV ?? 'uv';
  return spawnLogged(
    'backend',
    uv,
    ['run', 'python', '-m', 'remi.main', '--no-browser', '--port', String(API_PORT)],
    BACKEND_DIR,
    {
      REMI_ENV: 'test',
      REMI_TODAY,
      // The server's clock stands still at the browser's pinned instant, so a note jotted in a
      // run is stamped 09:30 like the page's clock (dev/test only; it must fall on REMI_TODAY).
      REMI_NOW,
      // The zone the first-run wizard pre-fills, instead of this machine's /etc/localtime, so
      // the setup-wizard capture is the same on every machine.
      REMI_DEFAULT_TIMEZONE: TIMEZONE,
      REMI_DATA_DIR: dataDir,
      REMI_WEB_PORT: String(WEB_PORT),
      TZ: TIMEZONE,
      ...(frontendDist ? { REMI_FRONTEND_DIST: frontendDist } : {}),
    },
    API_PORT,
  );
}

function frontendEnv(): NodeJS.ProcessEnv {
  return { REMI_API_PORT: String(API_PORT), REMI_WEB_PORT: String(WEB_PORT) };
}

function startVite(): number {
  return spawnLogged('vite', process.execPath, [VITE_BIN, '--host', HOST, '--port', String(WEB_PORT), '--strictPort'], FRONTEND_DIR, frontendEnv(), WEB_PORT);
}

function startPreview(): number {
  return spawnLogged(
    'preview',
    process.execPath,
    [VITE_BIN, 'preview', '--outDir', BUILD_DIR, '--host', HOST, '--port', String(WEB_PORT), '--strictPort'],
    FRONTEND_DIR,
    frontendEnv(),
    WEB_PORT,
  );
}

/** `vite build` of the current tree into .remi-run/dist (no tsc: type errors elsewhere must not block egress). */
async function buildFrontend(): Promise<string | null> {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = path.join(LOG_DIR, 'build.log');
  const code = await new Promise<number>((resolve) => {
    const out = fs.openSync(log, 'w');
    const child = spawn(process.execPath, [VITE_BIN, 'build', '--outDir', BUILD_DIR, '--emptyOutDir'], {
      cwd: FRONTEND_DIR,
      env: { ...process.env, ...frontendEnv() },
      stdio: ['ignore', out, out],
    });
    child.on('exit', (c) => {
      fs.closeSync(out);
      resolve(c ?? 1);
    });
  });
  if (code === 0 && fs.existsSync(path.join(BUILD_DIR, 'index.html'))) return null;
  return fs.readFileSync(log, 'utf8').split('\n').slice(-25).join('\n');
}

/** True when the backend serves the SPA itself (P4 `make serve`). */
async function backendServesSpa(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/app/today`, { signal: AbortSignal.timeout(3_000) });
    const body = await res.text();
    return res.ok && (res.headers.get('content-type') ?? '').includes('text/html') && body.includes('id="root"');
  } catch {
    return false;
  }
}

/** Visit each surface once so Vite finishes dependency optimisation before the tests start. */
async function warmUp(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const route of ['/app/today', '/textbook', '/']) {
      await page.goto(baseURL + route, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(500);
    await page.goto(baseURL + '/app/today', { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  } finally {
    await browser.close();
  }
}

export async function startRemi(opts: { serve: ServeMode; fixture: FixtureName }): Promise<RemiRun> {
  await cleanStale();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remi-parity-'));
  writeState({ ...readState(), dataDir });

  let buildError: string | null = null;
  if (opts.serve === 'build') buildError = await buildFrontend();
  const built = opts.serve === 'build' && buildError === null;

  const backend = startBackend(dataDir, built ? BUILD_DIR : null);
  await waitHttp(`${API_URL}/api/health`, 'backend', backend);
  await loadFixture(opts.fixture);

  let servedBy: ServedBy = 'vite';
  let baseURL = WEB_URL;
  if (built && (await backendServesSpa())) {
    servedBy = 'backend';
    baseURL = API_URL;
  } else if (built) {
    servedBy = 'preview';
    await waitHttp(`${WEB_URL}/`, 'preview', startPreview());
  } else {
    await waitHttp(`${WEB_URL}/`, 'vite', startVite());
    await warmUp(WEB_URL);
  }

  const fake = await startFakeAi();
  G.__remiParityFakeAi = fake;
  return { baseURL, servedBy, fakeAiUrl: fake.url, buildError };
}

export async function stopRemi(): Promise<void> {
  await G.__remiParityFakeAi?.close();
  G.__remiParityFakeAi = undefined;
  const state = readState();
  if (liveOwner(state) !== null) return; // another run's servers: never ours to stop
  for (const p of [...state.procs].reverse()) if (alive(p.pid) && isOurs(p.pid, p.port)) await killGroup(p.pid);
  if (state.dataDir) fs.rmSync(state.dataDir, { recursive: true, force: true });
  writeState({ procs: [], dataDir: null });
}

interface ParityLock {
  pid: number;
  ports: string;
  since: string;
}

/**
 * Take the parity output lock (baselines/remi, report/, docs/parity-report.md are shared by
 * every parity run, whatever its ports). A lock whose runner is gone is taken over.
 */
export function lockParityOutputs(): void {
  fs.mkdirSync(path.dirname(PARITY_LOCK), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(PARITY_LOCK, JSON.stringify({ pid: process.pid, ports: PORT_PAIR, since: new Date().toISOString() } satisfies ParityLock), { flag: 'wx' });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let held: ParityLock | null = null;
    try {
      held = JSON.parse(fs.readFileSync(PARITY_LOCK, 'utf8')) as ParityLock;
    } catch {
      /* half-written: treat as stale */
    }
    if (held && held.pid !== process.pid && alive(held.pid) && /playwright|node/.test(commandOf(held.pid))) {
      throw new Error(
        `another parity run (Playwright pid ${String(held.pid)}, ports ${held.ports}, since ${held.since}) is writing ` +
          'parity/report and docs/parity-report.md. Only one parity run at a time; behaviour and egress runs on other ports are fine.',
      );
    }
    fs.rmSync(PARITY_LOCK, { force: true });
  }
  throw new Error(`could not take ${PARITY_LOCK}`);
}

export function unlockParityOutputs(): void {
  try {
    const held = JSON.parse(fs.readFileSync(PARITY_LOCK, 'utf8')) as ParityLock;
    if (held.pid === process.pid) fs.rmSync(PARITY_LOCK, { force: true });
  } catch {
    /* not held */
  }
}

export { BUILD_DIR };
