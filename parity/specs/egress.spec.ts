// Stay local (`make egress`, ADR-0003, arch-delivery-parity §6): crawl every parity state and
// the key flows of the production app and fail on ANY request that is not 127.0.0.1, data:,
// blob: or about:, from any page or frame (the sandboxed chart iframes included), and on any
// websocket that is not loopback.
//
// globalSetup (PARITY_SERVE=build) builds the current tree with `vite build` and serves it (from
// the backend when it serves the SPA, else `vite preview`); if the build fails the crawl runs on
// Vite and the "production bundle" test fails with the build error.
//
// Every request goes through a context route: allowed ones continue, anything else is recorded
// and aborted, so nothing leaves the machine even when the test is about to fail. The request
// and websocket events are the second net: they see requests a route cannot (for example
// redirects and websocket upgrades). The third net is the page's own Content-Security-Policy:
// when the backend serves the build, CSP blocks an external fetch before any request exists,
// so every frame reports its securitypolicyviolation events for non-loopback URLs too (an
// attempt to leave is a failure even when CSP stopped it).

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { quietTimeouts, remiDrivers } from '../drivers/remi.ts';
import { api } from '../remi/api.ts';
import { FRONTEND_DIR, RUN_DIR } from '../remi/env.ts';
import { reachState, SIMPLE_REVIEW_TEXT, STATES } from '../states.ts';

// One worker, in order: the last flows reset the fixture.
test.describe.configure({ mode: 'default' });

export function isAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true;
  if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.hostname === '127.0.0.1';
  return false;
}

interface Guard {
  violations: string[];
  seen: number;
  /** A crawl ran (the bundle test opens no page). */
  crawled: boolean;
}

async function guard(context: BrowserContext, page: Page): Promise<Guard> {
  const g: Guard = { violations: [], seen: 0, crawled: false };
  const flag = (kind: string, url: string, where: string) => {
    const line = `${kind} ${url} (${where})`;
    if (!g.violations.includes(line)) g.violations.push(line);
  };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (isAllowed(url)) return route.continue();
    flag('blocked', url, route.request().frame().url() || 'no frame');
    return route.abort('blockedbyclient');
  });
  context.on('request', (r) => {
    g.seen += 1;
    if (!isAllowed(r.url())) {
      let where = 'service worker or unknown frame';
      try {
        where = r.frame().url() || 'about:blank';
      } catch {
        /* no frame */
      }
      flag(`request[${r.resourceType()}]`, r.url(), where);
    }
  });
  // Attempts the page's CSP stopped before they became requests (every frame, via an init script).
  await context.exposeBinding('__remiEgressCsp', ({ frame }, uri: unknown, directive: unknown) => {
    const blocked = String(uri);
    if (/^(https?|wss?):/i.test(blocked) && !isAllowed(blocked)) flag(`csp[${String(directive)}]`, blocked, frame.url() || 'about:blank');
  });
  await context.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (e) => {
        const report = (window as unknown as { __remiEgressCsp?: (uri: string, directive: string) => void }).__remiEgressCsp;
        report?.(e.blockedURI, e.effectiveDirective);
      },
      true,
    );
  });
  // Non-loopback websockets are never connected (no connectToServer), only recorded.
  await context.routeWebSocket(
    (url) => !isAllowed(url.toString()),
    (ws) => {
      flag('websocket', ws.url(), 'routeWebSocket');
      void ws.close({ code: 1008, reason: 'stay local' });
    },
  );
  const watchSockets = (p: Page) =>
    p.on('websocket', (ws) => {
      if (!isAllowed(ws.url())) flag('websocket', ws.url(), p.url());
    });
  watchSockets(page);
  context.on('page', watchSockets);
  return g;
}

let current: Guard | null = null;

test.beforeEach(async ({ context, page }) => {
  current = await guard(context, page);
});

test.afterEach(async ({ page }) => {
  const g = current;
  current = null;
  expect(g?.violations ?? [], 'requests that are not 127.0.0.1, data:, blob: or about:').toEqual([]);
  if (g?.crawled) expect(g.seen, 'the crawl made requests at all').toBeGreaterThan(0);
  // A readiness wait that ran into its 20s limit is a harness or app regression (a request that
  // never settles), not a pass that happened slowly.
  expect(quietTimeouts(page), 'readiness waits that ran into their 20s limit').toEqual([]);
});

/**
 * Runs one crawl. A step that fails (a control that is gone, a screen that does not open)
 * fails the test: a crawl that stopped half way proves nothing about the screens it never
 * reached. Late requests (lazy chunks, chart frames, debounced previews) still get 500ms inside
 * the test first, so the egress nets see them either way.
 */
async function crawl(page: Page, run: () => Promise<void>): Promise<void> {
  if (current) current.crawled = true;
  let failure: unknown = null;
  try {
    await run();
  } catch (e) {
    failure = e;
  }
  await page.waitForTimeout(500);
  if (failure) throw failure;
}

test('production bundle references no external URL', () => {
  test.skip(process.env.PARITY_SERVE !== 'build', 'not a build run (PARITY_SERVE=build, as make egress sets)');
  const buildError = process.env.REMI_PARITY_BUILD_ERROR;
  expect(buildError ?? null, `vite build of the current tree (see ${path.relative(path.resolve(FRONTEND_DIR, '..'), path.join(RUN_DIR, 'logs', 'build.log'))})`).toBeNull();
  const res = spawnSync(process.execPath, [path.join(FRONTEND_DIR, 'scripts', 'check-dist-urls.mjs'), path.join(RUN_DIR, 'dist')], { encoding: 'utf8' });
  expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
});

test('self-test: the guard catches requests and websockets that leave 127.0.0.1', async ({ page }) => {
  // On the real page: when the backend serves the build its CSP (connect-src 'self') stops these
  // before they are requests, so this also proves the CSP net reports them.
  await remiDrivers(page).home.boot().catch(() => undefined);
  // 192.0.2.0/24 is TEST-NET-1 (never routed), and both are stopped before they are sent anyway.
  await page.evaluate(() => {
    void fetch('http://192.0.2.1/egress-self-test').catch(() => undefined);
    const ws = new WebSocket('ws://192.0.2.1/egress-self-test');
    ws.onerror = () => undefined;
    const frame = document.createElement('iframe');
    frame.srcdoc = '<img src="http://192.0.2.1/egress-self-test-frame.png">';
    document.body.appendChild(frame);
  });
  await expect.poll(() => current?.violations.length ?? 0).toBeGreaterThanOrEqual(3);
  const caught = current!.violations.join('\n');
  expect(caught).toContain('http://192.0.2.1/egress-self-test');
  expect(caught).toContain('ws://192.0.2.1/egress-self-test');
  expect(caught).toContain('egress-self-test-frame.png');
  // The backend serves the build with its CSP, which stops these before they are requests: the
  // CSP net must be what caught them.
  if (process.env.REMI_PARITY_SERVED_BY === 'backend') expect(caught).toContain('csp[');
  current!.violations = [];
});

test('self-test: the guard catches the same attempts on a page without CSP', async ({ page }) => {
  // about:blank has no policy, so here the route and request nets must catch all three.
  await page.goto('about:blank');
  await page.evaluate(() => {
    void fetch('http://192.0.2.1/egress-self-test-nocsp').catch(() => undefined);
    const ws = new WebSocket('ws://192.0.2.1/egress-self-test-nocsp');
    ws.onerror = () => undefined;
    const frame = document.createElement('iframe');
    frame.srcdoc = '<img src="http://192.0.2.1/egress-self-test-nocsp-frame.png">';
    document.body.appendChild(frame);
  });
  await expect.poll(() => current?.violations.length ?? 0).toBeGreaterThanOrEqual(3);
  const caught = current!.violations.join('\n');
  expect(caught).toContain('http://192.0.2.1/egress-self-test-nocsp');
  expect(caught).toContain('ws://192.0.2.1/egress-self-test-nocsp');
  expect(caught).toContain('egress-self-test-nocsp-frame.png');
  expect(caught).not.toContain('csp[');
  current!.violations = [];
});

for (const state of STATES.filter((s) => !s.remiOnly)) {
  test(`state ${state.id}`, async ({ page }) => {
    await crawl(page, () => reachState(remiDrivers(page), state));
  });
}

test('flow: palette quick add, check-in review and apply', async ({ page }) => {
  const d = remiDrivers(page);
  await crawl(page, async () => {
    await d.app.setScreen('timeline');
    await d.app.openPalette();
    await d.app.typePalette('+6h returns');
    await page.keyboard.press('Enter');
    await page.locator('[data-screen-label="Check-in drawer"] textarea').first().press('ControlOrMeta+Enter');
    await page.waitForTimeout(1_000);
    await page.locator('[data-screen-label="Check-in drawer"] textarea').first().press('ControlOrMeta+Enter');
    await d.app.ready();
  });
});

test('flow: simple reading, then the error phase via the fake provider', async ({ page }) => {
  const d = remiDrivers(page);
  await crawl(page, async () => {
    await d.app.boot({ claude: 'error' });
    await d.app.openCheckIn('ret');
    await d.app.typeCheckIn(SIMPLE_REVIEW_TEXT);
    await d.app.sendCheckIn();
    await d.app.simpleReading();
  });
  await api('PATCH', '/settings', { aiProvider: 'none' }).catch(() => undefined);
});

test('flow: notes, today ticks and navigation', async ({ page }) => {
  const d = remiDrivers(page);
  await crawl(page, async () => {
    await d.app.setScreen('notes');
    const composer = page.locator('[data-screen-label="Notes"]').getByRole('textbox', { name: 'New note' });
    await composer.fill('Checked the returns pipeline with Finance.');
    await composer.press('Enter');
    await d.app.setScreen('today');
    await page.locator('[data-screen-label="Today"] [role="checkbox"], [data-screen-label="Today"] input[type="checkbox"]').first().click();
    // The NavRail's items are buttons (Remi.dc.html <nav>), not links: click each and check the
    // screen it opens, so the crawl really covers them.
    const rail = page.getByRole('navigation', { name: 'Screens' });
    for (const name of ['Timeline', 'Calendar', 'Projects', 'Routines', 'Transition']) {
      const item = rail.getByRole('button', { name, exact: true });
      await item.click();
      await expect(page).toHaveURL(new RegExp(`/app/${name.toLowerCase()}(/|\\?|$)`));
      await expect(item).toHaveAttribute('aria-current', 'page');
      await expect(page.locator(`[data-screen-label="${name}"]`)).toBeVisible();
      await d.app.ready();
    }
  });
});

test('flow: home keys and the textbook chart', async ({ page }) => {
  const d = remiDrivers(page);
  await crawl(page, async () => {
    await d.home.boot();
    await page.keyboard.press('2');
    await page.waitForURL(/\/textbook/, { timeout: 10_000 });
    await d.textbook.openPage('fi-rates');
    await d.textbook.fullscreenChart();
  });
});

test('flow: first run on an empty install', async ({ page }) => {
  await api('POST', '/dev/fixtures', { fixture: 'empty' });
  try {
    const d = remiDrivers(page);
    await crawl(page, async () => {
      await d.setup!.boot();
      await api('POST', '/setup', { moveDate: '2027-01-04', timezone: 'Europe/London', holidayRegion: 'GB-ENG' });
      for (const screen of ['today', 'notes', 'timeline', 'calendar', 'projects', 'routines', 'transition'] as const) await d.app.setScreen(screen);
    });
  } finally {
    await api('POST', '/dev/fixtures', { fixture: 'design' });
  }
});
