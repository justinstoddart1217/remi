// Behind a path-stripping proxy (ADR-0013). On the APEX server, IIS serves Remi at
// https://apex.ny1.ninetyone.com/remi/ and forwards to 127.0.0.1:8765 with the /remi prefix
// removed; Remi learns its prefix from REMI_PUBLIC_URL and writes it into the page's
// <base href>. This runs the same production build that way on loopback:
//
//   browser ─▶ proxy 127.0.0.1:<API_PORT+3>  /remi/x ─▶ backend 127.0.0.1:<API_PORT+2>  /x
//              (/remi redirects to /remi/, as the IIS rule does; anything else is a 404)
//
// The backend is a second one, started here with REMI_PUBLIC_URL=http://127.0.0.1:<proxy>/remi
// on the build globalSetup made for the egress run (PARITY_SERVE=build). The flows cover what
// ADR-0013 promises: deep links and reloads, every screen, saving, the Textbook's lazy chunk,
// KaTeX and a chart upload, Settings and the first-run wizard. Every request the page makes
// must stay under /remi/ on the proxy, and nothing Remi answers may redirect (the proxy, like
// IIS, would not rewrite a Location).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { pinClock, waitReady } from '../drivers/common.ts';
import { inheritedEnv, BUILD_DIR } from '../remi/servers.ts';
import { API_PORT, BACKEND_DIR, HOST, REMI_NOW, REMI_TODAY, TIMEZONE } from '../remi/env.ts';

test.describe.configure({ mode: 'serial' });

const BACKEND_PORT = API_PORT + 2;
const PROXY_PORT = API_PORT + 3;
const BACKEND_URL = `http://${HOST}:${String(BACKEND_PORT)}`;
const PROXY_URL = `http://${HOST}:${String(PROXY_PORT)}`;
const PREFIX = '/remi';
const PUBLIC_URL = `${PROXY_URL}${PREFIX}`;

interface Proxy {
  server: http.Server;
  /** Requests that arrived outside /remi/ (they escaped the prefix). */
  escaped: string[];
  /** Responses from Remi that carried a Location header. */
  redirects: string[];
}

let backend: ReturnType<typeof spawn> | null = null;
let proxy: Proxy | null = null;
let dataDir = '';

function startProxy(): Promise<Proxy> {
  const escaped: string[] = [];
  const redirects: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === PREFIX || url.startsWith(`${PREFIX}?`)) {
      res.writeHead(302, { Location: `${PREFIX}/${url.slice(PREFIX.length)}` });
      res.end();
      return;
    }
    if (!url.startsWith(`${PREFIX}/`)) {
      escaped.push(`${req.method ?? '?'} ${url}`);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('outside /remi/');
      return;
    }
    const upstream = http.request(
      {
        host: HOST,
        port: BACKEND_PORT,
        method: req.method,
        path: url.slice(PREFIX.length),
        // IIS's default: the backend's own Host; the browser's Origin passes through untouched.
        headers: { ...req.headers, host: `${HOST}:${String(BACKEND_PORT)}` },
      },
      (up) => {
        if (up.headers.location) redirects.push(`${req.method ?? '?'} ${url} -> ${up.headers.location}`);
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(String(e));
    });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROXY_PORT, HOST, () => resolve({ server, escaped, redirects }));
  });
}

async function waitHealthy(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the proxied backend did not start on ${BACKEND_URL}`);
}

/** Straight to the backend, as the harness does elsewhere (its own origin passes the guard). */
async function backendApi<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${route}`, {
    method,
    headers: { 'X-Remi-Client': '1', Origin: BACKEND_URL, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} /api${route}: ${String(res.status)} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Every request the page (and its frames) makes must go to the proxy under /remi/. */
function watch(page: Page): { outside: string[]; failed: string[] } {
  const outside: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return;
    // `/remi` itself is only ever the test's own entry URL, which the proxy sends to `/remi/`.
    const under = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
    if (url.origin !== PROXY_URL || !under) outside.push(`${r.method()} ${r.url()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${String(r.status())} ${r.request().method()} ${r.url()}`);
  });
  return { outside, failed };
}

const region = (page: Page, label: string) => page.locator(`[data-screen-label="${label}"]`);

test.beforeAll(async () => {
  test.skip(process.env.REMI_PARITY_SERVED_BY !== 'backend', 'needs the production build that the egress run makes (PARITY_SERVE=build)');
  test.setTimeout(120_000);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remi-proxy-'));
  backend = spawn(process.env.UV ?? 'uv', ['run', 'python', '-m', 'app.main', '--no-browser', '--port', String(BACKEND_PORT)], {
    cwd: BACKEND_DIR,
    env: {
      ...inheritedEnv('backend'),
      REMI_ENV: 'test',
      REMI_TODAY,
      REMI_NOW,
      REMI_DEFAULT_TIMEZONE: TIMEZONE,
      REMI_DATA_DIR: dataDir,
      REMI_FRONTEND_DIST: BUILD_DIR,
      REMI_PUBLIC_URL: PUBLIC_URL,
      TZ: TIMEZONE,
    },
    stdio: 'ignore',
    // Its own process group, so teardown stops uv and the Python it started together.
    detached: true,
  });
  proxy = await startProxy();
  await waitHealthy();
});

test.afterAll(async () => {
  if (backend?.pid) {
    try {
      process.kill(-backend.pid, 'SIGTERM');
    } catch {
      backend.kill('SIGTERM');
    }
  }
  await new Promise<void>((resolve) => {
    if (!proxy) resolve();
    else proxy.server.close(() => resolve());
  });
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test.afterEach(() => {
  expect(proxy?.escaped ?? [], 'requests that reached the proxy outside /remi/').toEqual([]);
  expect(proxy?.redirects ?? [], 'responses from Remi with a Location header').toEqual([]);
});

test('behind the proxy: the page is based at /remi/, deep links reload, and every screen stays under the prefix', async ({ page }) => {
  await backendApi('POST', '/dev/fixtures', { fixture: 'design' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(PUBLIC_URL); // the IIS rule's /remi -> /remi/
  await expect(page).toHaveURL(`${PUBLIC_URL}/`);
  expect(await page.evaluate(() => document.baseURI)).toBe(`${PUBLIC_URL}/`);

  await page.goto(`${PUBLIC_URL}/app/today`);
  await expect(region(page, 'Today')).toBeVisible();
  await waitReady(page);

  const tabs = page.locator('nav[aria-label="Screens"]');
  for (const [name, label] of [
    ['Notes', 'Notes'],
    ['Timeline', 'Timeline'],
    ['Calendar', 'Calendar'],
    ['Projects', 'Projects'],
    ['Routines', 'Routines'],
    ['Transition', 'Transition'],
    ['Today', 'Today'],
  ] as const) {
    await tabs.getByRole('button', { name, exact: true }).click();
    await expect(region(page, label)).toBeVisible();
    expect(new URL(page.url()).pathname.startsWith(`${PREFIX}/app/`), page.url()).toBe(true);
  }

  // A reload on a deep route: the server answers index.html with the base, not a 404.
  await page.goto(`${PUBLIC_URL}/app/projects/ret`);
  await expect(region(page, 'Project workspace')).toBeVisible();
  await page.reload();
  await expect(region(page, 'Project workspace')).toBeVisible();

  await page.goto(`${PUBLIC_URL}/settings`);
  await expect(region(page, 'Settings').locator('h1')).toBeVisible();

  expect(seen.outside, 'requests outside /remi/ on the proxy').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('behind the proxy: saving works from the public origin (a checklist tick and a note)', async ({ page }) => {
  await backendApi('POST', '/dev/fixtures', { fixture: 'design' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(`${PUBLIC_URL}/app/today`);
  const today = region(page, 'Today');
  await today.getByRole('checkbox', { name: 'Infrastructure Debt' }).first().click();
  await expect
    .poll(async () => {
      const day = await backendApi<{ bauRows: { routineId?: string; run?: { tickedItemIds: string[] } | null }[] }>('GET', '/day/2026-10-05');
      return day.bauRows.find((r) => r.routineId === 'r-ret')?.run?.tickedItemIds ?? [];
    })
    .toContain('r-ret-fund-06');

  await page.goto(`${PUBLIC_URL}/app/notes`);
  const composer = region(page, 'Notes').getByRole('textbox', { name: 'New note' });
  const NOTE = 'Written through the proxy.';
  await composer.fill(NOTE);
  await composer.press('Enter');
  await expect.poll(async () => JSON.stringify(await backendApi('GET', '/notes?day=2026-10-05'))).toContain(NOTE);
  await page.reload();
  await expect(region(page, 'Notes')).toContainText(NOTE);

  expect(seen.outside, 'requests outside /remi/ on the proxy').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('behind the proxy: the Textbook loads its chunk and KaTeX from a deep link, and a chart uploads and shows', async ({ page }) => {
  await backendApi('POST', '/dev/fixtures', { fixture: 'design' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(`${PUBLIC_URL}/textbook/fi-rates`);
  const tb = region(page, 'Textbook');
  await expect(tb).toBeVisible();
  await expect.poll(() => tb.locator('.katex').count()).toBeGreaterThan(0);

  await tb.getByRole('button', { name: 'Add a block' }).last().click();
  await page.keyboard.type('/chart');
  await page.keyboard.press('Enter');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remi-chart-')), 'bars.html');
  fs.writeFileSync(file, '<!doctype html><html><body><svg width="200" height="100"><rect width="80" height="60" fill="#009d80"/></svg></body></html>');
  await tb.locator('input[type="file"]').last().setInputFiles(file);
  const frame = tb.locator('iframe').last();
  await expect(frame).toHaveAttribute('src', new RegExp(`^${PREFIX}/api/charts/`));
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(tb).toContainText(/Saved/);
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(`${PUBLIC_URL}/api/charts/`))).toBe(true);

  expect(seen.outside, 'requests outside /remi/ on the proxy').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('behind the proxy: a first run goes through the wizard at /remi/setup and lands on /remi/', async ({ page }) => {
  await backendApi('POST', '/dev/fixtures', { fixture: 'empty' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(`${PUBLIC_URL}/`);
  await expect(page).toHaveURL(`${PUBLIC_URL}/setup`);
  await expect(page.getByRole('heading', { name: 'Set up your plan' })).toBeVisible();

  await page.getByRole('button', { name: /move|date/i }).first().click();
  const picker = page.getByRole('dialog');
  for (let i = 0; i < 6 && !(await picker.innerText()).includes('January 2027'); i++) await picker.getByRole('button', { name: 'Next month' }).click();
  await picker.getByRole('button', { name: 'Mon 4 Jan' }).click();
  await page.getByRole('button', { name: 'Start with an empty plan' }).click();
  await expect(page).toHaveURL(`${PUBLIC_URL}/`);
  expect((await backendApi<{ needsSetup: boolean }>('GET', '/setup')).needsSetup).toBe(false);

  expect(seen.outside, 'requests outside /remi/ on the proxy').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});
