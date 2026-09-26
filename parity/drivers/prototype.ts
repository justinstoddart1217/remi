// Drivers for the Claude Design prototype served from "Remi Dashboard Design Review/"
// (python3 -m http.server on 127.0.0.1:4800, see playwright.config.ts).
//
// The prototype has no routes, so states are reached through its own logic: after boot the
// shell's DCLogic instance is found by walking the React fiber up from the
// [data-screen-label="Remi app"] element to the stateNode whose logic has buildModel(), and is
// kept as window.__remi. Child design components (Today, Timeline, ...) are found the same way
// from their `.sc-host[data-sc-name]` wrapper. Callers must install the vendor routes on the
// context first (vendor-routes.ts), or the CDN scripts never load.

import type { Page } from '@playwright/test';

import { installClaudeStub, nextFrames, pinClock, waitReady, type ReadyOptions } from './common.ts';
import type {
  AppDriver,
  BootOptions,
  Drivers,
  FoundationsDriver,
  HomeDriver,
  Screen,
  TextbookDriver,
} from './types.ts';

/** Screens the shell imports; boot waits until every one is fetched and mounted. */
const SHELL_CHILDREN = ['Today', 'Notes', 'Timeline', 'Calendar', 'Projects', 'Workspace', 'Routines', 'Transition', 'CheckIn'];
/** Calendar.dc.html MONTHS: the four months the Calendar pages through. */
const CALENDAR_MONTHS: [number, number][] = [
  [2026, 9],
  [2026, 10],
  [2026, 11],
  [2027, 0],
];

// Minimal typing of what the page exposes; the prototype itself is untyped.
interface Logic {
  state: Record<string, unknown> & { data?: { cur: string; pages: { id: string; blocks: { id: string; type: string }[] }[] } };
  setState(patch: Record<string, unknown>, cb?: () => void): void;
  [method: string]: unknown;
}
interface Model {
  F: { dn(iso: string): number; iso(n: number): string };
  CAL: { days: Record<number, { y: number; m: number }> };
  P: { id: string; name: string }[];
  pmap: Record<string, { name: string }>;
  previewDay(n: number): void;
  openRoutine(id: string): void;
}
interface ShellLogic extends Logic {
  buildModel(): Model;
  openProject(id: string): void;
  openCheckIn(pid: string | null): void;
  openPalette(): void;
}
interface ParityWindow {
  __remi: ShellLogic;
  __tb: Logic & { openPage(id: string): void; page(): { blocks: { id: string; type: string }[] } };
  __parity: { dc(name: string): Logic | null; logicUp(el: Element | null, pred: (sn: { __name?: string; logic: Logic }) => boolean): Logic | null };
  __dcRootName?: () => string;
  __dcSetProps(name: string, props: Record<string, unknown>): void;
}
type W = Window & ParityWindow;

/** In-page helpers (fiber walks); installed with addInitScript so they exist from the start. */
function parityHelpers(): void {
  const w = window as unknown as W;
  const fiberOf = (el: Element | null) => {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key ? (el as unknown as Record<string, { stateNode?: unknown; return?: unknown }>)[key] : null;
  };
  type Fiber = { stateNode?: { __name?: string; logic?: Logic }; return?: Fiber | null } | null | undefined;
  const logicUp: ParityWindow['__parity']['logicUp'] = (el, pred) => {
    let f = fiberOf(el) as Fiber;
    while (f) {
      const sn = f.stateNode;
      if (sn && sn.logic && pred(sn as { __name?: string; logic: Logic })) return sn.logic;
      f = f.return;
    }
    return null;
  };
  const dc = (name: string) => {
    for (const el of document.querySelectorAll(`[data-sc-name="${CSS.escape(name)}"]`)) {
      const l = logicUp(el, (sn) => sn.__name === name);
      if (l) return l;
    }
    return null;
  };
  w.__parity = { dc, logicUp };
}

async function gotoDesign(page: Page, file: string, rootName: string): Promise<void> {
  await page.addInitScript(parityHelpers);
  await page.goto('/' + encodeURIComponent(file));
  await page.waitForFunction(
    (name) => (window as unknown as W).__dcRootName?.() === name && !!document.querySelector('#dc-root > .sc-host'),
    rootName,
    { timeout: 30_000 },
  );
}

// ------------------------------------------------------------------ Remi.dc.html
export class PrototypeApp implements AppDriver {
  constructor(readonly page: Page) {}

  async boot(opts: BootOptions = {}): Promise<void> {
    const { page } = this;
    await pinClock(page);
    await installClaudeStub(page, opts.claude);
    await gotoDesign(page, 'Remi.dc.html', 'Remi');
    await page.evaluate(() => (window as unknown as W).__dcSetProps('Remi', { motion: 'Reduced', frame: '1920 × 1080' }));
    await page.waitForFunction(
      (children) => {
        const w = window as unknown as W;
        const el = document.querySelector('[data-screen-label="Remi app"]');
        const shell = w.__parity.logicUp(el, (sn) => typeof (sn.logic as { buildModel?: unknown }).buildModel === 'function');
        if (!shell) return false;
        w.__remi = shell as ShellLogic;
        const timeline = w.__parity.dc('Timeline');
        return (
          document.documentElement.dataset.motion === 'reduced' &&
          children.every((name) => !!w.__parity.dc(name)) &&
          !!timeline &&
          timeline.state.settled === true
        );
      },
      SHELL_CHILDREN,
      { timeout: 30_000 },
    );
    await this.ready();
  }

  ready(opts?: ReadyOptions): Promise<void> {
    return waitReady(this.page, opts);
  }

  async setScreen(screen: Screen, extra: { ws?: string } = {}): Promise<void> {
    await this.page.evaluate(
      ({ screen, ws }) => (window as unknown as W).__remi.setState({ screen, instant: true, ...(ws ? { ws } : {}) }),
      { screen, ws: extra.ws },
    );
    await this.ready();
  }

  async openProject(id: string): Promise<void> {
    await this.page.evaluate((pid) => (window as unknown as W).__remi.openProject(pid), id);
    await this.page.waitForFunction((pid) => {
      const s = (window as unknown as W).__remi.state;
      return s.screen === 'workspace' && s.ws === pid;
    }, id);
    await this.ready();
  }

  async previewDay(iso: string): Promise<void> {
    await this.page.evaluate((day) => {
      const m = (window as unknown as W).__remi.buildModel();
      m.previewDay(m.F.dn(day));
    }, iso);
    // Today.pick fades out for 120ms before it swaps the day in.
    await this.page.waitForFunction((day) => {
      const w = window as unknown as W;
      const today = w.__parity.dc('Today');
      const m = w.__remi.buildModel();
      const n = m.F.dn(day);
      const want = n === (m as unknown as { TODAY: number }).TODAY ? null : n;
      return !!today && today.state.sel === want && today.state.fade === false && w.__remi.state.screen === 'today';
    }, iso);
    await this.ready();
  }

  async openRoutine(id: string): Promise<void> {
    await this.page.evaluate((rid) => (window as unknown as W).__remi.buildModel().openRoutine(rid), id);
    // Routines highlights the row ("fresh") for 1600ms: capture inside that window.
    await this.page.waitForFunction((rid) => (window as unknown as W).__parity.dc('Routines')?.state.fresh === rid, id);
    await this.ready({ animationTimeout: 600 });
  }

  async openCheckIn(pid: string | null): Promise<void> {
    await this.page.evaluate((p) => (window as unknown as W).__remi.openCheckIn(p), pid);
    await this.page.waitForFunction(() => {
      const w = window as unknown as W;
      const d = w.__remi.state.drawer as { open: boolean; session: number };
      const ci = w.__parity.dc('CheckIn');
      return d.open && !!ci && ci.state.session === d.session && ci.state.phase === 'compose';
    });
    // CheckIn focuses its textarea 380ms after it opens.
    await this.page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', undefined, { timeout: 5_000 });
    await this.ready();
  }

  private drawerTextarea() {
    return this.page.locator('[data-screen-label="Check-in drawer"] textarea');
  }

  async typeCheckIn(text: string): Promise<void> {
    await this.drawerTextarea().fill(text);
    await this.ready();
  }

  async sendCheckIn(): Promise<void> {
    await this.drawerTextarea().press('ControlOrMeta+Enter');
    await this.page.waitForFunction(() => {
      const ci = (window as unknown as W).__parity.dc('CheckIn');
      const phase = ci?.state.phase;
      return phase === 'error' || phase === 'thinking' || (phase === 'review' && ci?.state.shown === true);
    });
    await this.ready();
  }

  async simpleReading(): Promise<void> {
    await this.page.locator('[data-screen-label="Check-in drawer"]').getByRole('button', { name: 'Use a simple reading' }).click();
    await this.page.waitForFunction(() => {
      const ci = (window as unknown as W).__parity.dc('CheckIn');
      return ci?.state.phase === 'review' && ci.state.shown === true;
    });
    await this.ready();
  }

  async openPalette(): Promise<void> {
    await this.page.evaluate(() => (window as unknown as W).__remi.openPalette());
    await this.page.waitForFunction(() => document.activeElement?.tagName === 'INPUT');
    await this.ready();
  }

  async typePalette(query: string): Promise<void> {
    await this.page.locator('input[placeholder^="Jump to a screen or project"]').fill(query);
    await this.ready();
  }

  /** Centre of an element found in-page, for a real mouse hover (tooltips follow the pointer). */
  private async hoverAt(point: { x: number; y: number } | null, what: string): Promise<void> {
    if (!point) throw new Error(`prototype driver: could not find ${what}`);
    await this.page.mouse.move(point.x - 40, point.y);
    await this.page.mouse.move(point.x, point.y, { steps: 5 });
    await nextFrames(this.page);
    await this.ready();
  }

  async hoverTimelineProject(pid: string): Promise<void> {
    const point = await this.page.evaluate((id) => {
      const name = (window as unknown as W).__remi.buildModel().pmap[id]?.name;
      const section = document.querySelector('[data-screen-label="Timeline"]');
      const rows = [...(section?.querySelectorAll<HTMLElement>('div') ?? [])].filter(
        (d) => d.style.height === '64px' && d.style.cursor === 'pointer',
      );
      const row = rows.find((r) => r.querySelector('span')?.textContent?.trim() === name);
      const lane = row?.children[1];
      const bar = [...(lane?.children ?? [])].find((c) => {
        const s = (c as HTMLElement).style;
        return s.top === '26px' && s.height === '10px' && s.borderRadius === '2px';
      });
      const r = (bar && bar.getBoundingClientRect().width > 4 ? bar : lane)?.getBoundingClientRect();
      return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    }, pid);
    await this.hoverAt(point, `the Timeline bar for ${pid}`);
  }

  async hoverTimelineRotation(): Promise<void> {
    const point = await this.page.evaluate(() => {
      const section = document.querySelector('[data-screen-label="Timeline"]');
      const label = [...(section?.querySelectorAll('span') ?? [])].find((s) => s.textContent?.trim() === 'Eurozone sovereign rotation');
      const row = label?.parentElement?.parentElement;
      const lane = row?.children[1];
      if (!lane) return null;
      const lr = lane.getBoundingClientRect();
      const seg = [...lane.querySelectorAll('[title]')]
        .map((s) => s.getBoundingClientRect())
        .find((r) => r.width > 8 && r.x >= lr.x && r.x + r.width <= lr.x + lr.width);
      const r = seg ?? lr;
      return { x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + r.height / 2) };
    });
    await this.hoverAt(point, 'the Timeline rotation row');
  }

  async openTimelinePanel(pid: string): Promise<void> {
    await this.page.evaluate((id) => (window as unknown as W).__parity.dc('Timeline')?.setState({ panel: id, tip: null }), pid);
    await this.ready();
  }

  async openCalendarDay(iso: string): Promise<void> {
    await this.page.evaluate(
      ({ day, months }) => {
        const w = window as unknown as W;
        const m = w.__remi.buildModel();
        const n = m.F.dn(day);
        const d = m.CAL.days[n];
        const mi = d ? months.findIndex(([y, mo]) => y === d.y && mo === d.m) : -1;
        if (mi < 0) throw new Error('calendar day out of range: ' + day);
        w.__parity.dc('Calendar')?.setState({ sel: n, mi, fade: false });
      },
      { day: iso, months: CALENDAR_MONTHS },
    );
    await this.ready();
  }

  async openDatePicker(field: 'start' | 'target'): Promise<void> {
    await this.page.locator(`[data-screen-label="Project workspace"] button[title="Change the ${field} date"]`).click();
    await this.page.waitForFunction(() => !!(window as unknown as W).__parity.dc('Workspace')?.state.pk);
    await this.ready();
  }
}

// ------------------------------------------------------------------ Remi Home.dc.html
export class PrototypeHome implements HomeDriver {
  constructor(readonly page: Page) {}

  async boot(): Promise<void> {
    await pinClock(this.page);
    await gotoDesign(this.page, 'Remi Home.dc.html', 'Remi Home');
    await this.page.waitForFunction(() => {
      const w = window as unknown as W;
      return w.__parity.dc('Remi Home')?.state.arrived === true;
    });
    await this.ready();
  }

  ready(opts?: ReadyOptions): Promise<void> {
    return waitReady(this.page, opts);
  }

  async hoverCard(card: 'plan' | 'textbook'): Promise<void> {
    const point = await this.page.evaluate((index) => {
      const root = document.querySelector('[data-screen-label="Remi home"]');
      const cards = [...(root?.querySelectorAll<HTMLElement>('div') ?? [])].filter((d) => d.style.height === '560px');
      const r = cards[index]?.getBoundingClientRect();
      return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    }, card === 'plan' ? 0 : 1);
    if (!point) throw new Error(`prototype driver: no Home card ${card}`);
    await this.page.mouse.move(point.x, point.y, { steps: 5 });
    await this.page.waitForFunction(
      (want) => (window as unknown as W).__parity.dc('Remi Home')?.state.hover === want,
      card === 'plan' ? 'cp' : 'tb',
    );
    await this.ready();
  }
}

// ------------------------------------------------------------------ Remi Textbook.dc.html
export class PrototypeTextbook implements TextbookDriver {
  constructor(readonly page: Page) {}

  async boot(): Promise<void> {
    await pinClock(this.page);
    await gotoDesign(this.page, 'Remi Textbook.dc.html', 'Remi Textbook');
    await this.page.waitForFunction(() => {
      const w = window as unknown as W;
      const el = document.querySelector('[data-screen-label="Textbook"]');
      const tb = w.__parity.logicUp(el, (sn) => typeof (sn.logic as { openPage?: unknown }).openPage === 'function');
      if (!tb) return false;
      w.__tb = tb as W['__tb'];
      // KaTeX arrives from the (vendored) CDN; the component re-renders once it sees window.katex.
      return !!tb.state.data && !!(window as unknown as { katex?: unknown }).katex && Number(tb.state.mathV) >= 1;
    });
    await this.ready();
  }

  ready(opts?: ReadyOptions): Promise<void> {
    return waitReady(this.page, { frames: true, ...opts });
  }

  async openPage(pageId: string): Promise<void> {
    await this.page.evaluate((id) => (window as unknown as W).__tb.openPage(id), pageId);
    await this.page.waitForFunction((id) => {
      const s = (window as unknown as W).__tb.state;
      return s.data?.cur === id && s.fade === false;
    }, pageId);
    await this.page.waitForFunction(() => {
      const tb = (window as unknown as W).__tb;
      const formulas = tb.page().blocks.filter((b) => b.type === 'formula').length;
      return document.querySelectorAll('[data-screen-label="Textbook"] .katex').length >= formulas;
    });
    await this.settleCharts();
    await this.ready();
  }

  async fullscreenChart(): Promise<void> {
    await this.page.evaluate(() => {
      const tb = (window as unknown as W).__tb;
      const chart = tb.page().blocks.find((b) => b.type === 'chart');
      if (!chart) throw new Error('no chart block on the current Textbook page');
      tb.setState({ full: chart.id });
    });
    await this.settleCharts();
    await this.ready();
  }

  /** Live charts draw their curve over 1.4s after load; wait until every chart frame has drawn. */
  private async settleCharts(): Promise<void> {
    await this.page.waitForTimeout(1_600);
  }
}

// ------------------------------------------------------------------ Remi Foundations.dc.html
export class PrototypeFoundations implements FoundationsDriver {
  constructor(readonly page: Page) {}

  async boot(): Promise<void> {
    await pinClock(this.page);
    await gotoDesign(this.page, 'Remi Foundations.dc.html', 'Remi Foundations');
    await this.ready();
  }

  ready(opts?: ReadyOptions): Promise<void> {
    return waitReady(this.page, opts);
  }
}

/**
 * Tags the prototype's elements with the `data-parity` anchor names Remi's screens carry
 * (parity/README.md "Remi driver contract"), so Tier A can hold both apps' anchors to ±2px.
 * The elements are the ones the prototype driver hovers and clicks:
 *   timeline-row:<pid>          a project row (the 64px grid row with cursor:pointer)
 *   timeline-bar:<pid>          its forecast bar (the lane child at top 26px, 10px high, radius 2px)
 *   timeline-rotation           the rotation row's lane (Timeline.dc.html:118)
 *   timeline-rotation-segment   each segment in that lane (the [title] boxes)
 *   home-card:plan|textbook     the two 560px launcher cards (Remi Home.dc.html:54, :91)
 * Attributes only: nothing moves or repaints. The baseline spec calls it before capturing.
 */
export async function tagPrototypeAnchors(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as W;
    const tag = (el: Element | null | undefined, name: string) => el?.setAttribute('data-parity', name);
    for (const section of document.querySelectorAll('[data-screen-label="Timeline"]')) {
      const byName = new Map<string, string>();
      try {
        for (const p of w.__remi.buildModel().P) byName.set(p.name, p.id);
      } catch {
        /* not the planning app */
      }
      const rows = [...section.querySelectorAll<HTMLElement>('div')].filter((d) => d.style.height === '64px' && d.style.cursor === 'pointer');
      for (const row of rows) {
        const pid = byName.get(row.querySelector('span')?.textContent?.trim() ?? '');
        if (!pid) continue;
        tag(row, `timeline-row:${pid}`);
        const bar = [...(row.children[1]?.children ?? [])].find((c) => {
          const s = (c as HTMLElement).style;
          return s.top === '26px' && s.height === '10px' && s.borderRadius === '2px';
        });
        tag(bar, `timeline-bar:${pid}`);
      }
      const label = [...section.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'Eurozone sovereign rotation');
      const lane = label?.parentElement?.parentElement?.children[1];
      if (lane) {
        tag(lane, 'timeline-rotation');
        lane.querySelectorAll('[title]').forEach((seg) => tag(seg, 'timeline-rotation-segment'));
      }
    }
    for (const home of document.querySelectorAll('[data-screen-label="Remi home"]')) {
      const cards = [...home.querySelectorAll<HTMLElement>('div')].filter((d) => d.style.height === '560px');
      tag(cards[0], 'home-card:plan');
      tag(cards[1], 'home-card:textbook');
    }
  });
}

export function prototypeDrivers(page: Page): Drivers {
  return {
    kind: 'prototype',
    app: new PrototypeApp(page),
    home: new PrototypeHome(page),
    textbook: new PrototypeTextbook(page),
    foundations: new PrototypeFoundations(page),
  };
}
