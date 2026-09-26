// Remi mounted inside APEX (ADR-0014). APEX will run Remi in its own waitress process: its
// server.py wraps the Flask app with remi.mount.mount(), which sends /remi/... to Remi with the
// prefix removed and redirects /remi to /remi/. This runs the same production build that way on
// loopback, through the stand-in APEX (backend/remi/tests/mount, what `make mounted` serves):
//
//   browser -> waitress 127.0.0.1:<API_PORT+3> -> remi.mount: /remi/x -> Remi at /x
//                                                           anything else -> the stand-in APEX
//
// It uses the build globalSetup made for the egress run (PARITY_SERVE=build). The flows cover what
// ADR-0013/0014 promise: deep links and reloads, every screen, saving, the Textbook's lazy chunk,
// KaTeX and a chart upload, Settings and the first-run wizard. Every request the page makes must
// stay under /remi/, and nothing Remi answers may redirect (a Location would leave /remi/).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { pinClock, waitReady } from '../drivers/common.ts';
import { inheritedEnv, BUILD_DIR } from '../remi/servers.ts';
import { API_PORT, BACKEND_DIR, HOST, REMI_NOW, REMI_TODAY, TIMEZONE } from '../remi/env.ts';

test.describe.configure({ mode: 'serial' });

const PORT = API_PORT + 3;
const ORIGIN = `http://${HOST}:${String(PORT)}`;
const PREFIX = '/remi';
const PUBLIC_URL = `${ORIGIN}${PREFIX}`;

let server: ReturnType<typeof spawn> | null = null;
let dataDir = '';

async function waitHealthy(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PUBLIC_URL}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the mounted Remi did not start on ${PUBLIC_URL}`);
}

/** Remi's API through the mount, as the page calls it (its public origin passes the guard). */
async function remiApi<T = unknown>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PUBLIC_URL}/api${route}`, {
    method,
    headers: { 'X-Remi-Client': '1', Origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} /remi/api${route}: ${String(res.status)} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Every request the page (and its frames) makes must stay under /remi/ on this origin, no
 * response from under /remi/ may redirect (except the test's own entry at /remi), and none may
 * fail.
 */
function watch(page: Page): { outside: string[]; redirects: string[]; failed: string[] } {
  const outside: string[] = [];
  const redirects: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return;
    // `/remi` itself is only ever the test's own entry URL, which the mount sends to `/remi/`.
    const under = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`);
    if (url.origin !== ORIGIN || !under) outside.push(`${r.method()} ${r.url()}`);
  });
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (r.status() >= 300 && r.status() < 400 && url.pathname !== PREFIX) redirects.push(`${String(r.status())} ${r.url()}`);
    if (r.status() >= 400) failed.push(`${String(r.status())} ${r.request().method()} ${r.url()}`);
  });
  return { outside, redirects, failed };
}

const region = (page: Page, label: string) => page.locator(`[data-screen-label="${label}"]`);

test.beforeAll(async () => {
  test.skip(process.env.REMI_PARITY_SERVED_BY !== 'backend', 'needs the production build that the egress run makes (PARITY_SERVE=build)');
  test.setTimeout(120_000);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remi-mounted-'));
  server = spawn(process.env.UV ?? 'uv', ['run', 'python', '-m', 'remi.tests.mount.serve', '--port', String(PORT)], {
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
  await waitHealthy();
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('mounted in APEX: the page is based at /remi/, deep links reload, and every screen stays under the prefix', async ({ page }) => {
  await remiApi('POST', '/dev/fixtures', { fixture: 'design' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(PUBLIC_URL); // the mount's /remi -> /remi/
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

  expect(seen.outside, 'requests outside /remi/').toEqual([]);
  expect(seen.redirects, 'redirects from under /remi/').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('mounted in APEX: saving works from the public origin (a checklist tick and a note)', async ({ page }) => {
  await remiApi('POST', '/dev/fixtures', { fixture: 'design' });
  await pinClock(page);
  const seen = watch(page);

  await page.goto(`${PUBLIC_URL}/app/today`);
  const today = region(page, 'Today');
  await today.getByRole('checkbox', { name: 'Infrastructure Debt' }).first().click();
  await expect
    .poll(async () => {
      const day = await remiApi<{ bauRows: { routineId?: string; run?: { tickedItemIds: string[] } | null }[] }>('GET', '/day/2026-10-05');
      return day.bauRows.find((r) => r.routineId === 'r-ret')?.run?.tickedItemIds ?? [];
    })
    .toContain('r-ret-fund-06');

  await page.goto(`${PUBLIC_URL}/app/notes`);
  const composer = region(page, 'Notes').getByRole('textbox', { name: 'New note' });
  const NOTE = 'Written through the APEX mount.';
  await composer.fill(NOTE);
  await composer.press('Enter');
  await expect.poll(async () => JSON.stringify(await remiApi('GET', '/notes?day=2026-10-05'))).toContain(NOTE);
  await page.reload();
  await expect(region(page, 'Notes')).toContainText(NOTE);

  expect(seen.outside, 'requests outside /remi/').toEqual([]);
  expect(seen.redirects, 'redirects from under /remi/').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('mounted in APEX: the Textbook loads its chunk and KaTeX from a deep link, and a chart uploads and shows', async ({ page }) => {
  await remiApi('POST', '/dev/fixtures', { fixture: 'design' });
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

  expect(seen.outside, 'requests outside /remi/').toEqual([]);
  expect(seen.redirects, 'redirects from under /remi/').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});

test('mounted in APEX: a first run goes through the wizard at /remi/setup and lands on /remi/', async ({ page }) => {
  await remiApi('POST', '/dev/fixtures', { fixture: 'empty' });
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
  expect((await remiApi<{ needsSetup: boolean }>('GET', '/setup')).needsSetup).toBe(false);

  expect(seen.outside, 'requests outside /remi/').toEqual([]);
  expect(seen.redirects, 'redirects from under /remi/').toEqual([]);
  expect(seen.failed, 'failed requests').toEqual([]);
});
