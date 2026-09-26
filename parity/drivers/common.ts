// Helpers shared by both drivers: the pinned clock, the window.claude stub, the readiness wait
// and the per-state capture (normalised innerText and boxes of every [data-screen-label]).

import type { Page } from '@playwright/test';

import { CLAUDE_ERROR_RAW, CLAUDE_FIXTURE_RAW } from '../golden/claude-fixture.mjs';
import type { ClaudeStub } from './types.ts';

/**
 * serviceWorkers: 'block' is implemented by a Playwright init script that reads
 * navigator.serviceWorker; inside sandboxed (opaque-origin) live-chart iframes that read throws.
 * It comes from the harness, not the app, so both capture specs record it apart and never fail on it.
 */
export const HARNESS_NOISE = /Failed to read the 'serviceWorker' property from 'Navigator'/;

/** Mon 5 Oct 2026, 09:30 in Europe/London (BST): the prototype's hard-coded "today". */
export const FIXED_NOW = new Date('2026-10-05T09:30:00+01:00');
export const VIEWPORT = { width: 1920, height: 1080 } as const;

/**
 * The moment every live chart is drawn at: this many ms after the chart's script started.
 * The sample chart eases its curve in over 1.4s and then moves its marked point with
 * performance.now, so an unpinned capture depends on how long the page took to get there.
 */
export const CHART_TIME_MS = 3_000;

const pinned = new WeakSet<Page>();

/**
 * Must run before the first navigation: Date.now()/new Date() are fixed, timers keep running,
 * and every chart frame draws at CHART_TIME_MS (pinChartClock). Safe to call more than once.
 */
export async function pinClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  if (pinned.has(page)) return;
  pinned.add(page);
  await pinChartClock(page);
}

/**
 * In child frames only (the live charts, sandboxed or not; the app's own document is left
 * alone): performance.now() stands still at the frame's start, and requestAnimationFrame
 * callbacks get that start + CHART_TIME_MS. A chart that animates from rAF timestamps against
 * a performance.now() baseline is then drawn at the same moment in every run and in both apps,
 * so its pixels can be compared (charts.ts) instead of masked.
 */
export async function pinChartClock(page: Page): Promise<void> {
  await page.addInitScript((at: number) => {
    if (window.top === window) return;
    const start = performance.now();
    const raf = window.requestAnimationFrame.bind(window);
    Object.defineProperty(performance, 'now', { value: () => start, configurable: true });
    window.requestAnimationFrame = (cb: FrameRequestCallback) => raf(() => cb(start + at));
  }, CHART_TIME_MS);
}

export async function installClaudeStub(page: Page, stub: ClaudeStub | undefined): Promise<void> {
  if (!stub || stub === 'none') return;
  const raw = stub === 'fixture' ? CLAUDE_FIXTURE_RAW : CLAUDE_ERROR_RAW;
  await page.addInitScript(
    ({ mode, reply }) => {
      const complete = mode === 'pending' ? () => new Promise<string>(() => undefined) : async () => reply;
      (window as unknown as { claude: unknown }).claude = { complete };
    },
    { mode: stub, reply: raw },
  );
}

export async function nextFrames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
        step(count);
      }),
    n,
  );
}

export interface ReadyOptions {
  /** Upper bound for waiting on finite CSS animations/transitions to finish (ms). */
  animationTimeout?: number;
  /** Also wait for fonts inside child frames (live-chart iframes). */
  frames?: boolean;
}

/**
 * Readiness: no streaming or placeholder classes, document.fonts.ready, finite animations
 * settled (bounded), then two animation frames.
 */
export async function waitReady(page: Page, opts: ReadyOptions = {}): Promise<void> {
  await page.waitForFunction(
    () => !document.querySelector('.sc-placeholder') && !document.documentElement.classList.contains('sc-dc-streaming'),
    undefined,
    { timeout: 30_000 },
  );
  await nextFrames(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          if (a.playState !== 'running') return true;
          const end = a.effect?.getComputedTiming().endTime;
          return typeof end === 'number' && !Number.isFinite(end);
        }),
      undefined,
      { timeout: opts.animationTimeout ?? 5_000 },
    )
    .catch(() => undefined);
  if (opts.frames) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      await Promise.race([
        frame.evaluate(async () => {
          await document.fonts.ready;
        }),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]).catch(() => undefined);
    }
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await nextFrames(page);
}

// ------------------------------------------------------------------ capture
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldCapture {
  tag: string;
  placeholder: string | null;
  value: string;
}

export interface RegionCapture {
  label: string;
  box: Box;
  /** checkVisibility() with opacity and visibility: false for hidden screens and a closed drawer. */
  visible: boolean;
  inViewport: boolean;
  /** Raw innerText with NBSPs as spaces, whitespace runs collapsed, one line per rendered line. */
  lines: string[];
  /** lines joined with single spaces. */
  text: string;
  /**
   * The region's visible text as a reader sees it (the "Tier A view" below), nested regions and
   * opacity-0 content included. The prototype writes icons as ligature names ("chevron_left");
   * Remi may use codepoints instead, so icons are left out.
   */
  textNoIcons: string;
  /**
   * The Tier A lines: the region's own visible text. Read in the Tier A view: icon glyphs and
   * screen-reader-only (clipped, 1px) text are left out, and each Roll reads as its value (its
   * full-text sizer) instead of its reels ("0 1 2 … 9"). Nested labelled regions (each is
   * compared on its own) and anything at opacity 0 (a closed drawer or palette, hover-only
   * controls) are left out too. Empty for an invisible region.
   */
  ownLines: string[];
  /** ownLines joined with single spaces. */
  ownText: string;
  /** Visible icon names in document order (ligature text). */
  icons: string[];
  /** Visible form controls in the region, nested regions included: their values are not part of innerText. */
  fields: FieldCapture[];
  /** The Tier A fields: visible controls outside nested regions and opacity-0 content. */
  ownFields: FieldCapture[];
}

export interface Mask {
  /**
   * marked ([data-parity-mask]), clock (Notes clock times) or stamp ("Just now"): only what
   * depends on the time of the run (arch-delivery-parity §3). Prototype baselines captured before
   * 2026-09-24 also list kind "iframe"; Tier B ignores those (compare.ts TIER_B_MASK_KINDS).
   */
  kind: string;
  label: string;
  box: Box;
}

export interface PageCapture {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  regions: RegionCapture[];
  /** The whole page's visible text in the Tier A view (opacity-0 content left out): Tier A for pages without labelled regions. */
  pageLines: string[];
  pageText: string;
  /**
   * Visible [data-parity] anchors (Tier A: within ±2px). Remi's screens carry them; the
   * prototype baseline spec tags the same elements (drivers/prototype.ts tagPrototypeAnchors).
   */
  anchors: { name: string; box: Box }[];
  /** Areas masked in pixel comparisons: [data-parity-mask], the Notes clock, "Just now" stamps. */
  masks: Mask[];
  /** Visible iframes (the live charts): Tier A's chart check (charts.ts) crops them from the screenshots, and Tier B compares their pixels too. */
  frames?: { title: string; box: Box }[];
  activeElement: string | null;
  fontsLoaded: string[];
}

/**
 * Snapshot of every [data-screen-label] region (or #dc-root when a page has none). Call it after
 * the screenshot: reading the Tier A view briefly restyles the page (then restores it).
 */
export async function captureRegions(page: Page): Promise<PageCapture> {
  return page.evaluate(() => {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) };
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const norm = (s: string) => s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[ \t\f\v\r]+/g, ' ').trim();
    const linesOf = (el: HTMLElement) => el.innerText.split('\n').map(norm).filter(Boolean);
    const seen = (el: Element) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const labelled = [...document.querySelectorAll<HTMLElement>('[data-screen-label]')];
    const root = document.getElementById('dc-root');
    const els = labelled.length ? labelled : root ? [root] : [document.body];
    const all = [...document.querySelectorAll<HTMLElement>('body *')];
    const style = new Map(all.map((e) => [e, getComputedStyle(e)] as const));
    const css = (e: Element) => style.get(e as HTMLElement) ?? getComputedStyle(e);
    const iconEls = all.filter((e) => e.childElementCount === 0 && css(e).fontFamily.includes('Material Symbols'));
    const zeroOpacity = all.filter((e) => css(e).opacity === '0');
    // Screen-reader-only text (Remi's .srOnly: absolute, 1px, clip-path inset(50%)) is in
    // innerText but never on screen.
    const srOnly = all.filter((e) => {
      const cs = css(e);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
      if (/inset\(50%\)/.test(cs.clipPath) || /^rect\(0px,? 0px,? 0px,? 0px\)$/.test(cs.clip)) return true;
      const r = e.getBoundingClientRect();
      return cs.overflow === 'hidden' && r.width <= 1 && r.height <= 1;
    });
    // Roll (Roll.dc.html and components/Roll): a visibility:hidden sizer holding the full text,
    // then an aria-hidden absolute strip of reels. A reader sees the value, not the reels.
    const rolls = all.filter((e) => {
      const [sizer, strip] = [e.children[0], e.children[1]];
      if (!sizer || !strip) return false;
      if (e.hasAttribute('data-roll')) return true;
      const ss = css(strip);
      return strip.getAttribute('aria-hidden') === 'true' && css(sizer).visibility === 'hidden' && ss.position === 'absolute' && ss.display === 'flex';
    });
    const fieldsIn = (el: Element) =>
      [...el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter(
        (f) => seen(f) && !['file', 'checkbox', 'radio', 'hidden'].includes(f.type),
      );
    const fieldOf = (f: HTMLInputElement | HTMLTextAreaElement) => ({ tag: f.tagName.toLowerCase(), placeholder: f.getAttribute('placeholder'), value: f.value });
    const regions = els.map((el) => {
      const box = boxOf(el);
      const lines = linesOf(el);
      return {
        label: el.getAttribute('data-screen-label') ?? `#${el.id || el.tagName.toLowerCase()}`,
        box,
        visible: seen(el),
        inViewport: box.width > 0 && box.height > 0 && box.x < vw && box.y < vh && box.x + box.width > 0 && box.y + box.height > 0,
        lines,
        text: lines.join(' '),
        textNoIcons: '',
        ownLines: [] as string[],
        ownText: '',
        icons: iconEls.filter((i) => el.contains(i) && seen(i)).map((i) => norm(i.textContent ?? '')),
        fields: fieldsIn(el).map(fieldOf),
        ownFields: [] as { tag: string; placeholder: string | null; value: string }[],
      };
    });
    // After the screenshot: switch to the Tier A view for a moment (icons and sr-only text
    // hidden, Rolls read from their sizers; per region, nested regions and opacity-0 content
    // hidden too), read the text, then restore the page.
    const view = document.createElement('style');
    view.textContent =
      '[data-parity-icon],[data-parity-sr],[data-parity-strip],[data-parity-hide]{display:none!important}' +
      '[data-parity-sizer]{visibility:visible!important}';
    const marks: [Element, string][] = [
      ...iconEls.map((e) => [e, 'data-parity-icon'] as [Element, string]),
      ...srOnly.map((e) => [e, 'data-parity-sr'] as [Element, string]),
      ...rolls.map((e) => [e.children[1]!, 'data-parity-strip'] as [Element, string]),
      ...rolls.map((e) => [e.children[0]!, 'data-parity-sizer'] as [Element, string]),
    ];
    marks.forEach(([e, a]) => e.setAttribute(a, ''));
    document.head.appendChild(view);
    els.forEach((el, k) => {
      regions[k]!.textNoIcons = linesOf(el).join(' ');
    });
    const withHidden = <T,>(targets: Element[], read: () => T): T => {
      targets.forEach((t) => t.setAttribute('data-parity-hide', ''));
      try {
        return read();
      } finally {
        targets.forEach((t) => t.removeAttribute('data-parity-hide'));
      }
    };
    els.forEach((el, k) => {
      if (!regions[k]!.visible) return;
      const nested = [...el.querySelectorAll('[data-screen-label]')];
      const faded = zeroOpacity.filter((z) => z !== el && el.contains(z));
      const own = withHidden([...nested, ...faded], () => linesOf(el));
      regions[k]!.ownLines = own;
      regions[k]!.ownText = own.join(' ');
      regions[k]!.ownFields = fieldsIn(el)
        .filter((f) => !nested.some((n) => n.contains(f)) && !faded.some((z) => z.contains(f)))
        .map(fieldOf);
    });
    const pageLines = withHidden(zeroOpacity, () => linesOf(document.body));
    view.remove();
    marks.forEach(([e, a]) => e.removeAttribute(a));

    // Charts are compared, not masked: only time-dependent content is (arch-delivery-parity §3).
    // Their boxes feed the chart check (charts.ts), which Tier A runs on the screenshots.
    const frames = [...document.querySelectorAll('iframe')].filter((f) => seen(f)).map((f) => ({ title: f.getAttribute('title') ?? '', box: boxOf(f) }));
    const masks: { kind: string; label: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    document.querySelectorAll('[data-parity-mask]').forEach((m) => {
      if (seen(m)) masks.push({ kind: 'marked', label: m.getAttribute('data-parity-mask') ?? '', box: boxOf(m) });
    });
    const leafText = (e: Element) => (e.childElementCount === 0 ? norm(e.textContent ?? '') : '');
    const notes = labelled.find((el) => el.getAttribute('data-screen-label') === 'Notes' && seen(el));
    if (notes) {
      notes.querySelectorAll('*').forEach((e) => {
        if (/^(\d{1,2}:\d{2}|—:—)$/.test(leafText(e)) && seen(e)) masks.push({ kind: 'clock', label: leafText(e), box: boxOf(e) });
      });
    }
    all.forEach((e) => {
      if (/^just now$/i.test(leafText(e)) && seen(e)) masks.push({ kind: 'stamp', label: leafText(e), box: boxOf(e) });
    });
    const anchors = [...document.querySelectorAll('[data-parity]')]
      .filter((a) => seen(a))
      .map((a) => ({ name: a.getAttribute('data-parity') ?? '', box: boxOf(a) }));

    const active = document.activeElement;
    const describe = (el: Element | null) =>
      !el || el === document.body
        ? null
        : el.tagName.toLowerCase() + (el.getAttribute('placeholder') ? `[placeholder="${el.getAttribute('placeholder')}"]` : '');
    const fonts = new Set<string>();
    document.fonts.forEach((f) => {
      if (f.status === 'loaded') fonts.add(`${f.family.replace(/"/g, '')} ${f.style} ${f.weight}`);
    });
    return {
      url: location.pathname + location.search,
      title: document.title,
      viewport: { width: vw, height: vh },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      regions,
      pageLines,
      pageText: pageLines.join(' '),
      anchors,
      masks,
      frames,
      activeElement: describe(active),
      fontsLoaded: [...fonts].sort(),
    };
  });
}
