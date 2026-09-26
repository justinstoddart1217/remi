// Visual parity for the production app (`make parity`): every state in states.ts is driven on
// Remi through drivers/remi.ts, captured into baselines/remi/<state>.png and .json, and scored
// against baselines/prototype/ (compare.ts: Tier A text and boxes, Tier B pixels). Each result
// lands in report/results/<state>.json; globalTeardown turns them into docs/parity-report.md,
// with the side-by-side and diff PNGs in report/.
//
// The design states run against the `design` fixture. The Remi-only states (setup wizard, empty
// states, Settings) run in a second invocation against the `empty` fixture (PARITY_FIXTURE=empty);
// they have no prototype baseline, so they compare against an approved Remi capture in
// baselines/remi-approved/ (PARITY_APPROVE=1 PARITY_APPROVER=<who> records it, approvals.ts).
// A Remi-only state fails when it has no approved baseline, when its PNG is not the approved one
// in approvals.json, or when its page is taller or wider than the viewport but not captured in
// full (nothing below the fold may go without a reference).
//
// Filter with `make parity STATE=<regex>` (Playwright --grep on the test title, which is the
// state id) or PARITY_STATES=<id>,<id> for exact ids. Each result carries the run's id
// (PARITY_RUN_ID, one per `make parity`), so the report counts only this run's rows and marks
// the rest stale.
//
// Two self-tests run with the design states: the live-chart check (charts.ts) must fail a
// blank, mirrored or axes-only copy of the prototype's own charts, and a chart blanked inside
// Remi's running Textbook.

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { axesOnlyCrop, blankCrop, cropPng, framesOf, INK_RATIO_MIN, MIN_SIMILARITY, mirrorCrop, scoreChartCrops, scoreCharts } from '../charts.ts';
import { approvalStatus, recordApproval } from '../approvals.ts';
import { scoreTierA, scoreTierB, type CaptureRecord, type TierAResult, type TierBResult } from '../compare.ts';
import { captureRegions, FIXED_NOW, HARNESS_NOISE, VIEWPORT } from '../drivers/common.ts';
import { remiDrivers } from '../drivers/remi.ts';
import { divergencesFor } from '../divergences.ts';
import { api } from '../remi/api.ts';
import { fixtureName, PARITY_DIR, remiBaseUrl } from '../remi/env.ts';
import { REPORT_DIR, RESULTS_DIR, type StateResult } from '../report.ts';
import { reachState, STATES, type ParityState } from '../states.ts';

const PROTOTYPE_DIR = path.join(PARITY_DIR, 'baselines', 'prototype');
const REMI_DIR = path.join(PARITY_DIR, 'baselines', 'remi');
const APPROVED_DIR = path.join(PARITY_DIR, 'baselines', 'remi-approved');
const EMPTY_RUN = fixtureName() === 'empty';
const STATE_DEADLINE_MS = 60_000;
/** PARITY_STATES=a,b,c picks exact state ids (STATE=<regex> in make is Playwright's --grep). */
const ONLY = process.env.PARITY_STATES ? new Set(process.env.PARITY_STATES.split(',').map((s) => s.trim())) : null;
const SELECTED = STATES.filter((s) => (EMPTY_RUN ? s.remiOnly : !s.remiOnly) && (!ONLY || ONLY.has(s.id)));

test.beforeAll(() => {
  for (const dir of [REMI_DIR, REPORT_DIR, RESULTS_DIR]) fs.mkdirSync(dir, { recursive: true });
});

/** Record, then abort, anything that is not loopback (egress.spec.ts is the real gate). */
async function blockExternal(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route(
    (url) => !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    async (route) => {
      blocked.push(route.request().url());
      await route.abort('blockedbyclient');
    },
  );
  return blocked;
}

/** The empty states need setup done with nothing in the plan: the minimal first run. */
async function ensureSetupDone(): Promise<void> {
  const status = await api<{ needsSetup: boolean }>('GET', '/setup');
  if (!status.needsSetup) return;
  await api('POST', '/setup', { moveDate: '2027-01-04', timezone: 'Europe/London', holidayRegion: 'GB-ENG', capacityHoursPerDay: 8, aiProvider: 'none' });
}

function referenceFor(state: ParityState): { dir: string; kind: StateResult['reference'] } {
  if (!state.remiOnly && fs.existsSync(path.join(PROTOTYPE_DIR, `${state.id}.png`))) return { dir: PROTOTYPE_DIR, kind: 'prototype' };
  if (state.remiOnly && fs.existsSync(path.join(APPROVED_DIR, `${state.id}.png`))) return { dir: APPROVED_DIR, kind: 'remi-approved' };
  return { dir: '', kind: 'none' };
}

/**
 * What the capture depends on that the harness cannot pin. The wizard pre-fills the server's
 * default timezone: the backend runs with REMI_DEFAULT_TIMEZONE=Europe/London (remi/servers.ts),
 * so this note appears only if that stops working and the machine's zone leaks through.
 */
async function hostNotes(state: ParityState): Promise<string[]> {
  if (state.id === 'settings') {
    // The harness backend gets no API key from the environment (remi/servers.ts), but the
    // Keychain is the machine's: a saved key adds the key row to Tell Remi.
    try {
      const settings = await api<{ aiKeyConfigured?: boolean }>('GET', '/settings');
      return settings.aiKeyConfigured ? ['host-dependent: this machine has an Anthropic key in its Keychain, so Tell Remi shows the key row'] : [];
    } catch {
      return [];
    }
  }
  if (state.id !== 'setup-wizard') return [];
  try {
    const status = await api<{ defaults?: { timezone?: string; holidayRegion?: string } }>('GET', '/setup');
    const tz = status.defaults?.timezone ?? '?';
    return tz === 'Europe/London'
      ? []
      : [`host-dependent: the wizard pre-fills this machine's timezone (${tz}, ${status.defaults?.holidayRegion ?? '?'}), not Europe/London`];
  } catch {
    return [];
  }
}

function runState(state: ParityState) {
  return async ({ page, context, browser }: { page: Page; context: BrowserContext; browser: Browser }) => {
    const blocked = await blockExternal(context);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const harnessNoise = new Set<string>();
    page.on('pageerror', (e) => (HARNESS_NOISE.test(String(e)) ? harnessNoise.add(String(e)) : pageErrors.push(String(e))));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    if (state.remiOnly && state.id !== 'setup-wizard') await ensureSetupDone();
    const notes = await hostNotes(state);

    // A state that hangs still gets captured and scored: the driver has STATE_DEADLINE_MS, well
    // inside the test timeout.
    let driverError: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        reachState(remiDrivers(page), state),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`the driver did not reach the state within ${String(STATE_DEADLINE_MS / 1000)}s`)), STATE_DEADLINE_MS);
        }),
      ]);
    } catch (e) {
      driverError = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    } finally {
      clearTimeout(timer);
    }

    const png = path.join(REMI_DIR, `${state.id}.png`);
    await page.screenshot({ path: png, fullPage: !!state.fullPage, animations: 'disabled', caret: 'hide' });
    const capture = await captureRegions(page);
    const record = {
      state: { id: state.id, surface: state.surface, about: state.about, claude: state.claude ?? 'none', fullPage: !!state.fullPage, maxDiffRatio: state.maxDiffRatio },
      app: 'remi',
      capturedWith: {
        browser: `chromium ${browser.version()}`,
        clock: FIXED_NOW.toISOString(),
        timezone: 'Europe/London',
        locale: 'en-GB',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
        baseURL: remiBaseUrl(),
        servedBy: process.env.REMI_PARITY_SERVED_BY ?? 'vite',
      },
      screenshot: path.basename(png),
      ...capture,
      driverError,
      blockedRequests: blocked,
      pageErrors,
      consoleErrors,
      harnessNoise: [...harnessNoise],
    };
    fs.writeFileSync(path.join(REMI_DIR, `${state.id}.json`), JSON.stringify(record, null, 2) + '\n');

    // What a Remi-only capture must be before it can serve as a reference: all of the page.
    const coverage: string[] = [];
    if (state.remiOnly) {
      if (!state.fullPage && capture.document.height > VIEWPORT.height)
        coverage.push(`the page is ${String(capture.document.height)}px tall: set fullPage in states.ts so the part below the fold has a reference`);
      if (capture.document.width > VIEWPORT.width) coverage.push(`the page is ${String(capture.document.width)}px wide at a ${String(VIEWPORT.width)}px viewport (sideways scroll)`);
    }

    if (state.remiOnly && process.env.PARITY_APPROVE === '1') {
      const approver = process.env.PARITY_APPROVER ?? '';
      if (!approver.trim()) throw new Error('PARITY_APPROVE=1 needs PARITY_APPROVER="<who looked at the capture>" (approvals.ts)');
      const problems = [...(driverError ? [driverError] : []), ...coverage, ...pageErrors.map((e) => `page error: ${e}`), ...blocked.map((u) => `blocked request: ${u}`)];
      if (problems.length) throw new Error(`not approving ${state.id}: ${problems.join('; ')}`);
      fs.mkdirSync(APPROVED_DIR, { recursive: true });
      fs.copyFileSync(png, path.join(APPROVED_DIR, `${state.id}.png`));
      fs.copyFileSync(path.join(REMI_DIR, `${state.id}.json`), path.join(APPROVED_DIR, `${state.id}.json`));
      recordApproval(state.id, approver, { note: process.env.PARITY_APPROVAL_NOTE });
    }

    const ref = referenceFor(state);
    const approval = state.remiOnly ? approvalStatus(state.id) : null;
    let tierA: TierAResult | null = null;
    let tierB: TierBResult | null = null;
    const sideBySide = path.join(REPORT_DIR, `${state.id}.side-by-side.png`);
    const diffPng = path.join(REPORT_DIR, `${state.id}.diff.png`);
    if (ref.kind !== 'none') {
      const proto = JSON.parse(fs.readFileSync(path.join(ref.dir, `${state.id}.json`), 'utf8')) as CaptureRecord;
      tierA = scoreTierA(state.id, proto, record as unknown as CaptureRecord, { prototype: path.join(ref.dir, `${state.id}.png`), remi: png });
      tierB = scoreTierB({
        prototypePng: path.join(ref.dir, `${state.id}.png`),
        remiPng: png,
        masks: [...(proto.masks ?? []), ...capture.masks],
        budget: state.maxDiffRatio,
        diffPng,
        sideBySidePng: sideBySide,
      });
    }

    const result: StateResult = {
      id: state.id,
      about: state.about,
      surface: state.surface,
      remiOnly: !!state.remiOnly,
      runId: process.env.PARITY_RUN_ID ?? 'unknown',
      capturedAt: new Date().toISOString(),
      servedBy: process.env.REMI_PARITY_SERVED_BY ?? 'vite',
      reference: ref.kind,
      driverError,
      pageErrors,
      blockedRequests: blocked,
      tierA,
      tierB,
      divergences: divergencesFor(state.id).map((d) => d.id),
      hostNotes: notes,
      approval:
        approval && approval.kind !== 'none'
          ? {
              matches: approval.kind !== 'mismatch',
              approvedBy: approval.approval.approvedBy,
              approvedAt: approval.approval.approvedAt,
              note: approval.approval.note ?? null,
              signedOffBy: approval.approval.signedOffBy ?? null,
              signedOffAt: approval.approval.signedOffAt ?? null,
            }
          : null,
      coverage,
      images: {
        remi: path.relative(PARITY_DIR, png),
        sideBySide: tierB ? path.relative(PARITY_DIR, sideBySide) : null,
        diff: tierB ? path.relative(PARITY_DIR, diffPng) : null,
      },
    };
    fs.writeFileSync(path.join(RESULTS_DIR, `${state.id}.json`), JSON.stringify(result, null, 2) + '\n');

    expect.soft(driverError, 'the driver reached the state').toBeNull();
    expect.soft(blocked, 'non-loopback requests').toEqual([]);
    expect.soft(pageErrors, 'uncaught page errors').toEqual([]);
    if (state.remiOnly) {
      expect.soft(coverage, 'the capture holds the whole page').toEqual([]);
      expect.soft(ref.kind, `an approved baseline in baselines/remi-approved/ (look at baselines/remi/${state.id}.png, then approve it with PARITY_APPROVE=1 PARITY_APPROVER=<who>)`).toBe('remi-approved');
      if (ref.kind === 'remi-approved')
        expect.soft(approval?.kind, `baselines/remi-approved/${state.id}.png is the PNG recorded in approvals.json (re-approve it with PARITY_APPROVE=1 PARITY_APPROVER=<who>)`).toMatch(/^(approved|signed-off)$/);
    }
    if (tierA) {
      const failing = tierA.regions.filter((r) => r.status !== 'pass').map((r) => `${r.label}: ${r.status}`);
      failing.push(...tierA.anchors.filter((a) => !a.pass).map((a) => `anchor ${a.name}`));
      failing.push(...tierA.charts.filter((c) => !c.pass).map((c) => `chart ${c.name}: ${c.reason}`));
      expect.soft(failing, `Tier A against ${ref.kind} (see docs/parity-report.md)`).toEqual([]);
    }
    if (tierB) {
      expect.soft(tierB.ratio, `Tier B pixel diff ratio against ${ref.kind} (budget ${String(tierB.budget)})`).toBeLessThanOrEqual(tierB.budget);
    }
  };
}

// The states that name an AI stub (the drawer states and Notes) switch the global AI provider
// (remi/api.ts useAiStub), and the Remi-only states depend on each other (the wizard before
// setup, the empty states after), so each group runs in declaration order in one worker. The
// other states run in parallel and never touch Settings (drivers/remi.ts boot), and none of
// them reads the AI setting, so they cannot disturb the group or be disturbed by it.
const serial = (s: ParityState) => !!s.remiOnly || s.claude !== undefined;

// ------------------------------------------------------------------ chart check self-tests
/** The prototype baselines that show live charts. */
const CHART_STATES = ['textbook-katex', 'textbook-chart-full'];

if (!EMPTY_RUN && !ONLY) {
  test('self-test: the chart check fails a blank, mirrored or axes-only chart', () => {
    for (const id of CHART_STATES) {
      const png = path.join(PROTOTYPE_DIR, `${id}.png`);
      const frames = framesOf(JSON.parse(fs.readFileSync(path.join(PROTOTYPE_DIR, `${id}.json`), 'utf8')) as CaptureRecord);
      expect(frames.length, `${id} shows a live chart`).toBeGreaterThan(0);
      const image = PNG.sync.read(fs.readFileSync(png));
      for (const f of frames) {
        const proto = cropPng(image, f.box);
        const same = scoreChartCrops(f.title, f.box, proto, proto);
        expect(same.pass, `${id} ${f.title} against itself: ${same.reason}`).toBe(true);
        for (const [what, crop] of [
          ['blank', blankCrop(proto)],
          ['mirrored', mirrorCrop(proto)],
          ['axes only', axesOnlyCrop(proto)],
        ] as const) {
          const out = scoreChartCrops(f.title, f.box, proto, crop);
          expect(out.pass, `${id} ${f.title}, ${what}: similarity ${String(out.similarity)}, ink ${String(out.remiInk)}`).toBe(false);
        }
      }
    }
  });

  test('self-test: a chart blanked in Remi fails the chart check', async ({ page }, testInfo) => {
    const d = remiDrivers(page);
    await d.textbook.boot();
    await d.textbook.openPage('fi-rates');
    const protoPng = path.join(PROTOTYPE_DIR, 'textbook-katex.png');
    const protoFrames = framesOf(JSON.parse(fs.readFileSync(path.join(PROTOTYPE_DIR, 'textbook-katex.json'), 'utf8')) as CaptureRecord);

    const drawn = testInfo.outputPath('chart-drawn.png');
    await page.screenshot({ path: drawn, animations: 'disabled', caret: 'hide' });
    const before = scoreCharts({ prototypePng: protoPng, remiPng: drawn, protoFrames, remiFrames: (await captureRegions(page)).frames ?? [] });
    expect(before.length).toBeGreaterThan(0);
    expect(before.filter((c) => !c.pass).map((c) => c.reason), 'the drawn chart passes').toEqual([]);

    // Empty every chart document (the frame stays, as when a chart's script fails).
    const charts = page.frames().filter((f) => f !== page.mainFrame());
    expect(charts.length, 'chart frames on the page').toBeGreaterThan(0);
    for (const f of charts) await f.evaluate(() => document.body.replaceChildren());
    await d.textbook.ready();
    const blank = testInfo.outputPath('chart-blank.png');
    await page.screenshot({ path: blank, animations: 'disabled', caret: 'hide' });
    const after = scoreCharts({ prototypePng: protoPng, remiPng: blank, protoFrames, remiFrames: (await captureRegions(page)).frames ?? [] });
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) {
      expect(c.pass, `blanked ${c.name}: ${c.reason}`).toBe(false);
      // The ink is gone (what is left is the chart block's own frame), and so is the picture.
      expect(c.remiInk, `blanked ${c.name}: ${c.reason}`).toBeLessThan(c.protoInk * INK_RATIO_MIN);
      expect(c.similarity, `blanked ${c.name}: ${c.reason}`).toBeLessThan(MIN_SIMILARITY);
    }

    // For the record: Tier B alone would have let the blank chart through.
    const tierB = scoreTierB({
      prototypePng: protoPng,
      remiPng: blank,
      masks: [],
      budget: 0.02,
      diffPng: testInfo.outputPath('chart-blank.diff.png'),
      sideBySidePng: testInfo.outputPath('chart-blank.side-by-side.png'),
    });
    testInfo.annotations.push({ type: 'tier B with the chart blanked', description: `${(tierB.ratio * 100).toFixed(3)}% (budget 2%)` });
  });
}

for (const state of SELECTED.filter((s) => !serial(s))) test(state.id, runState(state));

test.describe('one worker, in order', () => {
  test.describe.configure({ mode: 'default' });
  for (const state of SELECTED.filter(serial)) test(state.id, runState(state));
});
