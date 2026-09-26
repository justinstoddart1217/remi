// Drivers for the production app (backend + frontend started by remi/global-setup.ts with
// REMI_ENV=test REMI_TODAY=2026-10-05 and the design fixture), with the same interfaces as
// drivers/prototype.ts so states.ts replays unchanged.
//
// Remi reaches states through deep links rather than fiber walks (C1-platform §4):
//   /                          Home              /textbook/:pageId?        Textbook
//   /app/today/:day?           Today (+ the day preview)
//   /app/{notes,timeline,projects,projects/:id,transition}
//   /app/calendar/<YYYY-MM>?day=<iso>          the Calendar day panel
//   /app/routines?focus=<id>   a routine row, highlighted
//   ?drawer=<projectId|new>    the check-in drawer, open (read once, on shell mount)
//   ?palette=<query>           the command palette, open
//   ?frame=1920x1080           the scaled canvas, as the prototype's frame prop (read on load)
//   /dev/foundations           Foundations (dev server only)
//   /setup, /settings          the first-run wizard and Settings (Remi only)
//
// Interactions a URL cannot express use the prototype's own titles and copy where it has them
// (button[title="Change the target date"], button[title="Full screen"], "Use a simple
// reading") and otherwise `data-parity` anchors that the screens carry for the harness
// (parity/README.md "Remi driver contract"):
//   timeline-bar:<projectId>   timeline-row:<projectId>   timeline-rotation
//   timeline-rotation-segment  home-card:plan             home-card:textbook
// and the check-in drawer content exposes its phase as data-phase on an element inside
// [data-screen-label="Check-in drawer"].
//
// Readiness: no request in flight for 300ms (tracked from Playwright's request events, so the
// 150ms debounced previews count), then the shared wait (fonts, finite animations, two frames).

import type { Frame, Locator, Page, Request } from '@playwright/test';

import { remiBaseUrl } from '../remi/env.ts';
import { useAiStub } from '../remi/api.ts';
import { nextFrames, pinClock, waitReady, type ReadyOptions } from './common.ts';
import type {
  AppDriver,
  BootOptions,
  ClaudeStub,
  Drivers,
  FoundationsDriver,
  HomeDriver,
  Screen,
  SettingsDriver,
  SetupDriver,
  TextbookDriver,
} from './types.ts';

export const APP_FRAME = '1920x1080';
const DRAWER = '[data-screen-label="Check-in drawer"]';
const PALETTE_INPUT = 'input[placeholder^="Jump to a screen or project"]';

const SCREEN_PATHS: Record<Exclude<Screen, 'workspace'>, string> = {
  today: '/app/today',
  notes: '/app/notes',
  timeline: '/app/timeline',
  calendar: '/app/calendar',
  projects: '/app/projects',
  routines: '/app/routines',
  transition: '/app/transition',
};

/**
 * Requests in flight on a page, from Playwright's events (all frames).
 *
 * A request that a navigation abandons (a fetch the old document started, a chart frame that
 * was torn down) gets no requestfinished or requestfailed event, so it would keep the page
 * "busy" until quiet() gave up. Each request is therefore tagged with the number of the
 * document that made it:
 *   - a navigation request (a new document on its way) takes the next number, as that frame's
 *     newest requested document;
 *   - any other request takes the frame's COMMITTED document. Between a navigation request and
 *     its commit only the old document can make requests (the new one has no script, parser or
 *     preload scanner yet), so a fetch the old document fires in that window (the Home screen's
 *     GET /api/textbook/home after a '2' keypress, while page.goto is already on its way) stays
 *     with the old document instead of passing as the new one.
 * When the frame commits a new document (framenavigated after a navigation request; a
 * same-document route change has none and drops nothing), every request of its earlier
 * documents is dropped, and so is anything whose frame has been detached.
 *
 * quiet() records each time it gives up (see quietTimeouts), so the egress and behaviour runs
 * can fail on a readiness wait that silently ran into its limit.
 */
class NetTracker {
  private readonly inflight = new Map<Request, { frame: Frame | null; doc: number }>();
  /** Per frame: the number of the newest document requested, and of the one committed. */
  private readonly requested = new WeakMap<Frame, number>();
  private readonly committed = new WeakMap<Frame, number>();
  private lastChange = Date.now();
  /** URLs that may stay open (the pending AI parse in the thinking state). */
  ignore: RegExp[] = [];
  /** One line per quiet() that ran into its limit, with the requests it was still waiting on. */
  readonly timeouts: string[] = [];

  constructor(page: Page) {
    page.on('request', (r) => {
      const frame = frameOf(r);
      let doc = 0;
      if (frame && r.isNavigationRequest()) {
        doc = (this.requested.get(frame) ?? 0) + 1;
        this.requested.set(frame, doc);
      } else if (frame) {
        doc = this.committed.get(frame) ?? 0;
      }
      this.inflight.set(r, { frame, doc });
      this.lastChange = Date.now();
    });
    const done = (r: Request) => {
      if (this.inflight.delete(r)) this.lastChange = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    page.on('framenavigated', (frame) => {
      const doc = this.requested.get(frame) ?? 0;
      if (doc <= (this.committed.get(frame) ?? 0)) return; // same-document (history API) navigation
      this.committed.set(frame, doc);
      for (const [r, tag] of this.inflight) if (tag.frame === frame && tag.doc < doc) this.inflight.delete(r);
      this.lastChange = Date.now();
    });
    page.on('framedetached', () => this.dropDetached());
  }

  private dropDetached(): void {
    for (const [r, tag] of this.inflight) if (tag.frame?.isDetached()) this.inflight.delete(r);
  }

  private pending(): Request[] {
    this.dropDetached();
    return [...this.inflight.keys()].filter((r) => !this.ignore.some((re) => re.test(r.url())));
  }

  /**
   * Resolves once nothing (not ignored) has been in flight for `quietMs`. Gives up after
   * `timeoutMs`, says which requests were still open (so a slow state is visible in the log)
   * and records it in `timeouts`.
   */
  async quiet(quietMs = 300, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.pending().length && Date.now() - this.lastChange >= quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const open = this.pending().map((r) => `${r.method()} ${r.url()}`);
    const line = `still waiting on ${String(open.length)} request(s) after ${String(timeoutMs / 1000)}s: ${open.slice(0, 5).join(', ')}`;
    this.timeouts.push(line);
    console.warn(`[drivers/remi.ts] ${line}; carrying on`);
  }
}

/** The frame a request came from (null for a service worker's own requests). */
function frameOf(r: Request): Frame | null {
  try {
    return r.frame();
  } catch {
    return null;
  }
}

const trackers = new WeakMap<Page, NetTracker>();
function tracker(page: Page): NetTracker {
  let t = trackers.get(page);
  if (!t) {
    t = new NetTracker(page);
    trackers.set(page, t);
  }
  return t;
}

/**
 * The readiness waits on this page that ran into their 20s limit (empty when none did, or when
 * no Remi driver has touched the page). The egress and behaviour specs fail on any.
 */
export function quietTimeouts(page: Page): string[] {
  return [...(trackers.get(page)?.timeouts ?? [])];
}

function driverError(what: string, detail: string): Error {
  return new Error(`drivers/remi.ts: ${what}: ${detail}`);
}

/** Interactions are bounded, so a missing control fails the state quickly and it is still captured. */
const ACTION_TIMEOUT = 10_000;

async function clickOr(loc: Locator, what: string, detail: string, opts: { force?: boolean } = {}): Promise<void> {
  await loc.click({ timeout: ACTION_TIMEOUT, ...opts }).catch(() => {
    throw driverError(what, detail);
  });
}

/** Shared by the three surfaces: absolute URLs from the run's base URL, plus readiness. */
class RemiSurface {
  protected readonly net: NetTracker;

  constructor(
    readonly page: Page,
    protected readonly base: string,
  ) {
    this.net = tracker(page);
  }

  protected url(route: string, params: Record<string, string> = {}, frame = false): string {
    const u = new URL(route, this.base);
    if (frame) u.searchParams.set('frame', APP_FRAME);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  protected async open(route: string, params: Record<string, string> = {}, frame = false): Promise<void> {
    await this.page.goto(this.url(route, params, frame), { waitUntil: 'load' });
    await this.page.waitForFunction(() => document.querySelector('#root')?.childElementCount !== 0, undefined, { timeout: 30_000 });
  }

  async ready(opts?: ReadyOptions): Promise<void> {
    await this.net.quiet();
    await waitReady(this.page, opts);
  }

  /** Centre of a visible [data-parity] anchor. */
  protected async anchorCentre(name: string, within?: string): Promise<{ x: number; y: number }> {
    const loc = this.page.locator(`${within ? within + ' ' : ''}[data-parity="${name}"]`).first();
    await loc.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
      throw driverError(name, `no visible [data-parity="${name}"] anchor${within ? ` in ${within}` : ''}`);
    });
    const r = await loc.boundingBox();
    if (!r) throw driverError(name, 'the anchor has no box');
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }

  /** A real pointer hover (tooltips follow the pointer), approached from the left as the prototype driver does. */
  protected async hoverAt(point: { x: number; y: number }): Promise<void> {
    await this.page.mouse.move(point.x - 40, point.y);
    await this.page.mouse.move(point.x, point.y, { steps: 5 });
    await nextFrames(this.page);
    await this.ready();
  }
}

export class RemiApp extends RemiSurface implements AppDriver {
  private claude: ClaudeStub = 'none';

  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  /** The app path the page is on (without the query), for deep links that keep the screen. */
  private currentPath(): string {
    const here = this.page.url();
    return here.startsWith('http') ? new URL(here).pathname : SCREEN_PATHS.today;
  }

  private async go(route: string, params: Record<string, string> = {}, opts?: ReadyOptions): Promise<void> {
    await this.open(route, params, true);
    await this.page
      .locator('[data-screen-label="Remi app"]')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => {
        throw driverError('boot', `no [data-screen-label="Remi app"] at ${route} (setup gate or a crashed shell?)`);
      });
    await this.ready(opts);
  }

  async boot(opts: BootOptions = {}): Promise<void> {
    await pinClock(this.page);
    this.claude = opts.claude ?? 'none';
    // The thinking state holds its parse request open; readiness must not wait for it.
    this.net.ignore = this.claude === 'pending' ? [/\/api\/checkins\/parse/] : [];
    // Settings are global: only a state that names its AI stub changes them (those states run
    // one after another), so parallel states never flip the provider under a drawer state.
    if (opts.claude !== undefined) await useAiStub(opts.claude);
    await this.go(SCREEN_PATHS.today);
  }

  async setScreen(screen: Screen, extra: { ws?: string } = {}): Promise<void> {
    const route = screen === 'workspace' ? `/app/projects/${encodeURIComponent(extra.ws ?? 'ret')}` : SCREEN_PATHS[screen];
    await this.go(route);
  }

  async openProject(id: string): Promise<void> {
    await this.setScreen('workspace', { ws: id });
  }

  async previewDay(iso: string): Promise<void> {
    await this.go(`${SCREEN_PATHS.today}/${iso}`);
  }

  async openRoutine(id: string): Promise<void> {
    // The row stays highlighted for 1.6s: capture inside that window, as the prototype driver does.
    await this.go(SCREEN_PATHS.routines, { focus: id }, { animationTimeout: 600 });
  }

  async openCheckIn(pid: string | null): Promise<void> {
    await this.go(this.currentPath(), { drawer: pid ?? 'new' });
    await this.page
      .waitForFunction(
        (sel) => {
          const d = document.querySelector(sel);
          return !!d && d.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        },
        DRAWER,
        { timeout: 10_000 },
      )
      .catch(() => {
        throw driverError('openCheckIn', 'the check-in drawer did not open from ?drawer=');
      });
    // The composer focuses its textarea 380ms after it opens.
    await this.page
      .waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', undefined, { timeout: 5_000 })
      .catch(() => {
        throw driverError('openCheckIn', 'the drawer textarea never took focus');
      });
    await this.ready();
  }

  private drawerTextarea() {
    return this.page.locator(`${DRAWER} textarea`).first();
  }

  private async waitPhase(phases: string[], what: string): Promise<void> {
    await this.page
      .waitForFunction(
        ({ sel, want }) => {
          const phase = document.querySelector(sel)?.querySelector('[data-phase]')?.getAttribute('data-phase');
          return !!phase && want.includes(phase);
        },
        { sel: DRAWER, want: phases },
        { timeout: 20_000 },
      )
      .catch(() => {
        throw driverError(what, `the drawer never reached data-phase ${phases.join('|')}`);
      });
    await this.ready();
  }

  async typeCheckIn(text: string): Promise<void> {
    await this.drawerTextarea()
      .fill(text, { timeout: ACTION_TIMEOUT })
      .catch(() => {
        throw driverError('typeCheckIn', 'no textarea in the drawer');
      });
    await this.ready();
  }

  async sendCheckIn(): Promise<void> {
    await this.drawerTextarea()
      .press('ControlOrMeta+Enter', { timeout: ACTION_TIMEOUT })
      .catch(() => {
        throw driverError('sendCheckIn', 'no textarea in the drawer');
      });
    await this.waitPhase(['thinking', 'review', 'error'], 'sendCheckIn');
    if (this.claude !== 'pending') await this.waitPhase(['review', 'error'], 'sendCheckIn');
  }

  async simpleReading(): Promise<void> {
    await clickOr(this.page.locator(DRAWER).getByRole('button', { name: 'Use a simple reading' }), 'simpleReading', 'no "Use a simple reading" button in the drawer');
    await this.waitPhase(['review'], 'simpleReading');
  }

  async openPalette(): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+K');
    await this.page
      .waitForFunction((sel) => document.activeElement?.matches(sel) === true, PALETTE_INPUT, { timeout: 5_000 })
      .catch(() => {
        throw driverError('openPalette', '⌘K did not focus the palette input');
      });
    await this.ready();
  }

  async typePalette(query: string): Promise<void> {
    await this.page
      .locator(PALETTE_INPUT)
      .fill(query, { timeout: ACTION_TIMEOUT })
      .catch(() => {
        throw driverError('typePalette', 'no palette input');
      });
    await this.ready();
  }

  async hoverTimelineProject(pid: string): Promise<void> {
    await this.hoverAt(await this.anchorCentre(`timeline-bar:${pid}`, '[data-screen-label="Timeline"]'));
  }

  async hoverTimelineRotation(): Promise<void> {
    // As the prototype driver: the first segment wider than 8px that lies inside the lane,
    // hovered at min(half its width, 40px) from its left edge.
    const point = await this.page.evaluate(() => {
      const section = document.querySelector('[data-screen-label="Timeline"]');
      const lane = section?.querySelector('[data-parity="timeline-rotation"]');
      if (!lane) return null;
      const lr = lane.getBoundingClientRect();
      const seg = [...lane.querySelectorAll('[data-parity="timeline-rotation-segment"]')]
        .map((s) => s.getBoundingClientRect())
        .find((r) => r.width > 8 && r.x >= lr.x && r.x + r.width <= lr.x + lr.width);
      const r = seg ?? lr;
      return { x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + r.height / 2) };
    });
    if (!point) throw driverError('hoverTimelineRotation', 'no [data-parity="timeline-rotation"] lane in the Timeline');
    await this.hoverAt(point);
  }

  async openTimelinePanel(pid: string): Promise<void> {
    const row = this.page.locator(`[data-screen-label="Timeline"] [data-parity="timeline-row:${pid}"]`).first();
    const target = (await row.count()) ? row : this.page.locator(`[data-screen-label="Timeline"] [data-parity="timeline-bar:${pid}"]`).first();
    if (!(await target.count())) throw driverError('openTimelinePanel', `no timeline-row:${pid} or timeline-bar:${pid} anchor`);
    await clickOr(target, 'openTimelinePanel', `the timeline-row:${pid} anchor is not clickable`);
    // The prototype opens the panel with no pointer over the lanes (tip: null): park the pointer
    // on the rail's empty foot so no tooltip shows.
    await this.page.mouse.move(40, 1070);
    await this.ready();
  }

  async openCalendarDay(iso: string): Promise<void> {
    await this.go(`/app/calendar/${iso.slice(0, 7)}`, { day: iso });
  }

  async openDatePicker(field: 'start' | 'target'): Promise<void> {
    await clickOr(
      this.page.locator(`[data-screen-label="Project workspace"] button[title="Change the ${field} date"]`).first(),
      'openDatePicker',
      `no button[title="Change the ${field} date"] in the workspace`,
    );
    // The BusinessDayDatePicker: a dialog whose day buttons carry aria-pressed.
    await this.page
      .locator('[role="dialog"]:has(button[aria-pressed])')
      .first()
      .waitFor({ state: 'visible', timeout: ACTION_TIMEOUT })
      .catch(() => {
        throw driverError('openDatePicker', 'no date picker dialog opened');
      });
    await this.ready();
  }
}

export class RemiHome extends RemiSurface implements HomeDriver {
  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  async boot(): Promise<void> {
    await pinClock(this.page);
    await this.open('/');
    await this.page
      .locator('[data-screen-label="Remi home"]')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => {
        throw driverError('home boot', 'no [data-screen-label="Remi home"] at /');
      });
    await this.ready();
  }

  async hoverCard(card: 'plan' | 'textbook'): Promise<void> {
    const point = await this.anchorCentre(`home-card:${card}`, '[data-screen-label="Remi home"]');
    await this.page.mouse.move(point.x, point.y, { steps: 5 });
    await nextFrames(this.page);
    await this.ready();
  }
}

export class RemiTextbook extends RemiSurface implements TextbookDriver {
  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  async boot(): Promise<void> {
    await pinClock(this.page);
    await this.open('/textbook');
    await this.waitTextbook();
    await this.ready();
  }

  override ready(opts?: ReadyOptions): Promise<void> {
    return super.ready({ frames: true, ...opts });
  }

  private async waitTextbook(): Promise<void> {
    await this.page
      .locator('[data-screen-label="Textbook"]')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => {
        throw driverError('textbook', 'no [data-screen-label="Textbook"]');
      });
  }

  async openPage(pageId: string): Promise<void> {
    await this.open(`/textbook/${encodeURIComponent(pageId)}`);
    await this.waitTextbook();
    await this.net.quiet();
    // KaTeX is lazy-loaded with the Textbook chunk; formulas render once it arrives.
    await this.page
      .waitForFunction(() => !document.querySelector('[data-screen-label="Textbook"] [data-block-type="formula"]:not(:has(.katex))'), undefined, {
        timeout: 10_000,
      })
      .catch(() => undefined);
    await this.settleCharts();
    await this.ready();
  }

  async fullscreenChart(): Promise<void> {
    const button = this.page.locator('[data-screen-label="Textbook"] button[title="Full screen"]').first();
    if (!(await button.count())) throw driverError('fullscreenChart', 'no button[title="Full screen"] on the page (no chart block?)');
    await clickOr(button, 'fullscreenChart', 'the Full screen button is not clickable', { force: true });
    await this.settleCharts();
    await this.ready();
  }

  /** Live charts draw their curve over 1.4s after load, as in the prototype driver. */
  private async settleCharts(): Promise<void> {
    await this.page.waitForTimeout(1_600);
  }
}

export class RemiFoundations extends RemiSurface implements FoundationsDriver {
  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  async boot(): Promise<void> {
    await pinClock(this.page);
    await this.open('/dev/foundations');
    await this.ready();
  }
}

/** The first-run wizard: a fresh install (the `empty` fixture) is sent to /setup by the SetupGate. */
export class RemiSetup extends RemiSurface implements SetupDriver {
  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  async boot(): Promise<void> {
    await pinClock(this.page);
    await this.open('/');
    await this.page.waitForURL(/\/setup(\?|$)/, { timeout: 30_000 }).catch(() => {
      throw driverError('setup boot', `a fresh install did not land on /setup (at ${this.page.url()})`);
    });
    await this.ready();
  }
}

/** Settings (ADR-0010): after setup, every section of the saved setup on one page. */
export class RemiSettings extends RemiSurface implements SettingsDriver {
  constructor(page: Page, base = remiBaseUrl()) {
    super(page, base);
  }

  async boot(): Promise<void> {
    await pinClock(this.page);
    await this.open('/settings');
    // While the settings load, the page is an empty [data-screen-label="Settings"]; the last
    // section (Appearance) is there once they have.
    await this.page
      .locator('[data-screen-label="Settings"] section#appearance')
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => {
        throw driverError('settings boot', `no Settings sections at /settings (at ${this.page.url()}; setup not done?)`);
      });
    await this.ready();
  }
}

export function remiDrivers(page: Page, base = remiBaseUrl()): Drivers {
  return {
    kind: 'remi',
    app: new RemiApp(page, base),
    home: new RemiHome(page, base),
    textbook: new RemiTextbook(page, base),
    foundations: new RemiFoundations(page, base),
    setup: new RemiSetup(page, base),
    settings: new RemiSettings(page, base),
  };
}
