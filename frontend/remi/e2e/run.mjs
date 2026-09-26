#!/usr/bin/env node
// Remi's browser checks without Playwright (docs/apex/INTEGRATION_REQUIREMENTS.md R-63).
//
// Plain Node (22+, for its built-in WebSocket) drives Chrome or Edge over the DevTools protocol,
// the way APEX checks its own UI. It runs three flows against a running Remi:
//
//   first run    the wizard at /setup, then Home
//   check-in     Tell Remi -> a simple reading -> apply; the project records the check-in
//   deep links   a reload on /app/timeline and /textbook/fi-rates returns to the same page
//
// Every request a page makes must stay under the base URL, and none may fail (>= 400).
//
// Usage:
//   node e2e/run.mjs --base http://localhost:8011/remi [--browser <path>] [--headful]
//
// The base is where Remi's pages are (mounted in APEX: http://localhost:8011/remi on the dev
// server). The flows reset Remi's data with POST <base>/api/dev/fixtures, so the server must run
// with REMI_ENV=dev or test: a dev server, never the host. `make e2e` starts one (the stand-in
// APEX of backend/remi/tests/mount) and runs this against it. The browser is --browser,
// REMI_E2E_BROWSER, or the first Chrome or Edge found in the usual places.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 20_000;
const CHECK_IN_TEXT = 'Pipeline: engine now reconciles 11 of 12 funds.\nPlaybook: outline drafted.\nReturns are done for today.';

// ------------------------------------------------------------------ arguments and browser
function parseArgs(argv) {
  const out = { base: 'http://localhost:8011/remi', browser: process.env.REMI_E2E_BROWSER ?? '', headful: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i] ?? out.base;
    else if (a === '--browser') out.browser = argv[++i] ?? out.browser;
    else if (a === '--headful') out.headful = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node e2e/run.mjs --base <url of Remi, e.g. http://localhost:8011/remi> [--browser <path>] [--headful]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  out.base = out.base.replace(/\/+$/, '');
  return out;
}

function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('no Chrome or Edge found: pass --browser <path> or set REMI_E2E_BROWSER');
  return found;
}

// ------------------------------------------------------------------ the DevTools protocol
class Browser {
  static async launch(binary, headful) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'remi-e2e-'));
    const flags = [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1000',
      'about:blank',
    ];
    if (!headful) flags.unshift('--headless=new');
    const proc = spawn(binary, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error(`the browser did not start: ${buffer.slice(-400)}`)), TIMEOUT_MS);
      proc.stderr.on('data', (chunk) => {
        buffer += String(chunk);
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.once('exit', (code) => reject(new Error(`the browser exited (${String(code)}): ${buffer.slice(-400)}`)));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true });
    });
    return new Browser(proc, ws, profile);
  }

  constructor(proc, ws, profile) {
    this.proc = proc;
    this.ws = ws;
    this.profile = profile;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== undefined) {
        const waiter = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!waiter) return;
        if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
        else waiter.resolve(msg.result);
        return;
      }
      for (const listener of this.listeners) listener(msg);
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(message));
    });
  }

  async newPage(base) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId, base);
    await page.init();
    return page;
  }

  async close() {
    try {
      await this.send('Browser.close');
    } catch {
      this.proc.kill();
    }
    await new Promise((resolve) => {
      if (this.proc.exitCode !== null) resolve();
      else this.proc.once('exit', resolve);
    });
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}

class Page {
  constructor(browser, sessionId, targetId, base) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.base = new URL(`${base}/`);
    this.problems = [];
    this.loadWaiters = [];
    browser.listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Page.loadEventFired') this.loadWaiters.splice(0).forEach((resolve) => resolve());
      if (msg.method === 'Network.requestWillBeSent') this.checkRequest(msg.params.request.url);
      if (msg.method === 'Network.responseReceived') {
        const { status, url } = msg.params.response;
        if (status >= 400) this.problems.push(`${String(status)} ${url}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') this.problems.push(`page error: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    });
  }

  checkRequest(raw) {
    const url = new URL(raw);
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return;
    const prefix = this.base.pathname.replace(/\/$/, '');
    const under = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
    if (url.origin !== this.base.origin || !under) this.problems.push(`request outside ${this.base.href}: ${raw}`);
  }

  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }

  async init() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  }

  url(route) {
    return new URL(route.replace(/^\//, ''), this.base).href;
  }

  async goto(route) {
    const loaded = new Promise((resolve) => this.loadWaiters.push(resolve));
    await this.send('Page.navigate', { url: this.url(route) });
    await withTimeout(loaded, `load ${route}`);
  }

  async reload() {
    const loaded = new Promise((resolve) => this.loadWaiters.push(resolve));
    await this.send('Page.reload');
    await withTimeout(loaded, 'reload');
  }

  /** Runs `fn(...args)` in the page and returns its (JSON) result. */
  async evaluate(fn, ...args) {
    const expression = `(${String(fn)})(...${JSON.stringify(args)})`;
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`in the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  }

  async waitFor(what, fn, ...args) {
    const deadline = Date.now() + TIMEOUT_MS;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(fn, ...args);
        if (last) return last;
      } catch (error) {
        last = error;
      }
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
  }

  /**
   * Clicks, with real mouse events at its centre, the first visible and enabled button (or link)
   * whose accessible name matches `pattern`, once it has stopped moving (arrival animations).
   */
  async clickNamed(pattern, within = 'body') {
    const deadline = Date.now() + TIMEOUT_MS;
    let previous = null;
    while (Date.now() < deadline) {
      const at = await this.evaluate(locateControl, pattern.source, pattern.flags, within).catch(() => null);
      if (at && previous && Math.abs(previous.x - at.x) < 0.5 && Math.abs(previous.y - at.y) < 0.5) {
        await this.mouseClick(at.x, at.y);
        return;
      }
      previous = at;
      await sleep(100);
    }
    throw new Error(`timed out waiting for a control named ${String(pattern)}`);
  }

  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async focus(selector) {
    await this.waitFor(`${selector} to take focus`, (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    }, selector);
  }

  async typeInto(selector, text) {
    await this.focus(selector);
    await this.send('Input.insertText', { text });
  }

  /** ⌘↵ / Ctrl+↵, the drawer's send and apply shortcut. */
  async pressSubmit() {
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }

  async close() {
    await this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out: ${what}`)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Remi's API from the runner, as its own pages call it (its origin and X-Remi-Client). */
async function api(base, method, route, body) {
  const res = await fetch(`${base}/api${route}`, {
    method,
    headers: { 'X-Remi-Client': '1', Origin: new URL(base).origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: ${String(res.status)} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** In the page: the screen region labelled `name` is on screen. */
const regionVisible = (name) => {
  const el = document.querySelector(`[data-screen-label="${name}"]`);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
};

/**
 * In the page: the centre of the first visible, enabled button or link inside `scope` whose
 * accessible name matches the pattern (its aria-label, else its text without the parts hidden
 * from assistive technology, such as icon ligatures), scrolled into view; or null.
 */
function locateControl(source, flags, scope) {
  const re = new RegExp(source, flags);
  const root = document.querySelector(scope);
  if (!root) return null;
  const text = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE || node.getAttribute('aria-hidden') === 'true') return '';
    return [...node.childNodes].map(text).join('');
  };
  const name = (el) => (el.getAttribute('aria-label') ?? text(el)).replace(/\s+/g, ' ').trim();
  const hit = [...root.querySelectorAll('button, a[href], [role="button"]')].find(
    (el) => re.test(name(el)) && el.getClientRects().length > 0 && !el.disabled,
  );
  if (!hit) return null;
  hit.scrollIntoView({ block: 'center', inline: 'center' });
  const box = hit.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// ------------------------------------------------------------------ the flows
async function firstRun(page, base) {
  await api(base, 'POST', '/dev/fixtures', { fixture: 'empty' });
  await page.goto('/');
  const prefix = new URL(`${base}/`).pathname;
  await page.waitFor('the wizard at /setup', (p) => location.pathname === `${p}setup` && document.body.innerText.includes('Set up your plan'), prefix);
  await page.clickNamed(/move|date/i);
  await page.waitFor('the date picker', () => !!document.querySelector('[role="dialog"]'));
  for (let i = 0; i < 12; i++) {
    const shown = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
    if (shown.includes('January 2027')) break;
    await page.clickNamed(/^Next month$/, '[role="dialog"]');
    await sleep(150);
  }
  await page.clickNamed(/^Mon 4 Jan$/, '[role="dialog"]');
  await page.waitFor('the countdown', () => document.body.innerText.includes('business days to Fixed Income'));
  await page.clickNamed(/^Start with an empty plan/);
  await page.waitFor('Home after the wizard', (p) => location.pathname === p, prefix);
  const setup = await api(base, 'GET', '/setup');
  if (setup.needsSetup) throw new Error('setup is still needed after the wizard');
}

async function checkIn(page, base) {
  await api(base, 'POST', '/dev/fixtures', { fixture: 'design' });
  const lastCheckIn = async () => (await api(base, 'GET', '/plan')).projects.find((p) => p.id === 'ret')?.lastCheckinDate ?? null;
  const before = await lastCheckIn();
  await page.goto('/app/today');
  await page.waitFor('Today', regionVisible, 'Today');
  await page.clickNamed(/^Tell Remi$/);
  const drawer = '[data-screen-label="Check-in drawer"]';
  await page.waitFor('the check-in drawer', (sel) => document.querySelector(sel)?.getAttribute('aria-modal') === 'true', drawer);
  await page.typeInto(`${drawer} textarea`, CHECK_IN_TEXT);
  await page.pressSubmit();
  await page.waitFor('the simple reading', (sel) => /Apply \d+ change/.test(document.querySelector(sel)?.textContent ?? ''), drawer);
  await page.focus(`${drawer} textarea`);
  await page.pressSubmit(); // in review, the same shortcut applies
  await page.waitFor('the drawer to close', (sel) => document.querySelector(sel)?.getAttribute('aria-modal') !== 'true', drawer);
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const after = await lastCheckIn();
    if (after && after !== before) return;
    if (Date.now() > deadline) throw new Error(`the check-in was not recorded (lastCheckinDate ${String(after)})`);
    await sleep(200);
  }
}

async function deepLinks(page, base) {
  await api(base, 'POST', '/dev/fixtures', { fixture: 'design' });
  for (const [route, label] of [
    ['/app/timeline', 'Timeline'],
    ['/textbook/fi-rates', 'Textbook'],
  ]) {
    await page.goto(route);
    await page.waitFor(label, regionVisible, label);
    await page.reload();
    await page.waitFor(`${label} after a reload`, regionVisible, label);
    const path = await page.evaluate(() => location.pathname);
    if (!path.endsWith(route)) throw new Error(`the reload of ${route} landed on ${path}`);
  }
  await page.waitFor('KaTeX in the Textbook', () => document.querySelectorAll('.katex').length > 0);
}

// ------------------------------------------------------------------ main
async function main() {
  const args = parseArgs(process.argv);
  if (typeof WebSocket === 'undefined') throw new Error('this needs Node 22 or newer (the built-in WebSocket)');
  const health = await api(args.base, 'GET', '/health').catch((error) => {
    throw new Error(`Remi does not answer at ${args.base}/api/health (${error.message})`);
  });
  const binary = args.browser || findBrowser();
  console.log(`Remi ${String(health.version)} at ${args.base}/  |  ${path.basename(binary)}`);
  const browser = await Browser.launch(binary, args.headful);
  let failed = 0;
  try {
    for (const [name, flow] of [
      ['first run: the wizard, then Home', firstRun],
      ['check-in: a simple reading, applied', checkIn],
      ['deep links: a reload returns to the same page', deepLinks],
    ]) {
      const page = await browser.newPage(args.base);
      const started = Date.now();
      try {
        await flow(page, args.base);
        if (page.problems.length) throw new Error(page.problems.join('\n    '));
        console.log(`  ✓ ${name} (${String(Date.now() - started)} ms)`);
      } catch (error) {
        failed += 1;
        console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${String(failed)} failed` : 'all passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
