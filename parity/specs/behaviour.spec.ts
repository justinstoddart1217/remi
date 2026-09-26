// Behaviour flows for the production app (`make behaviour`): PLAN.md "Verification ›
// Behaviour" and arch-delivery-parity §4. Every flow starts from a fresh design fixture
// (POST /api/dev/fixtures), runs in one worker in order (they mutate the one database), and
// asserts on what the user sees plus the API (the server owns every number).
//
// Tagged @p4: they are written against the documented UI (the prototype's copy and titles, the
// critique's corrections, the empty-state catalogue in arch-frontend-screens §5) while the
// screens are still being built, and are expected to pass from P4 on. Filter with
// `make behaviour FLOW=<regex>`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { pinClock } from '../drivers/common.ts';
import { quietTimeouts, remiDrivers } from '../drivers/remi.ts';
import { api, getPlan, getProject, loadFixture, useAiStub } from '../remi/api.ts';
import { CLAUDE_FIXTURE_REPLY, CLAUDE_FIXTURE_TEXT } from '../golden/claude-fixture.mjs';
import { fakeAiUrl } from '../remi/env.ts';

test.describe.configure({ mode: 'default' });

const DRAWER = '[data-screen-label="Check-in drawer"]';
const MULTI_LINE_TEXT = 'Pipeline: engine now reconciles 11 of 12 funds.\nPlaybook: outline drafted.\nReturns are done for today.';

test.beforeEach(async ({ page }) => {
  await loadFixture('design');
  await useAiStub('none');
  await pinClock(page);
});

// A readiness wait that ran into its 20s limit is a harness or app regression (a request that
// never settles), not a pass that happened slowly.
test.afterEach(({ page }) => {
  expect(quietTimeouts(page), 'readiness waits that ran into their 20s limit').toEqual([]);
});

const drawer = (page: Page): Locator => page.locator(DRAWER);
const region = (page: Page, label: string): Locator => page.locator(`[data-screen-label="${label}"]`);

/**
 * Waits until the drawer is settled open or settled closed. `aria-modal` flips the moment the
 * drawer opens or closes, visibility only once the 240ms fade ends: a drawer fading out reads
 * "moving", so `open: true` cannot pass on a first sample taken while it is closing.
 */
async function drawerState(page: Page): Promise<'open' | 'closed' | 'moving'> {
  return drawer(page).evaluate((el) => {
    const modal = el.getAttribute('aria-modal') === 'true';
    const visible = el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    return modal && visible ? 'open' : !modal && !visible ? 'closed' : 'moving';
  });
}

async function expectDrawerOpen(page: Page, open: boolean): Promise<void> {
  await expect.poll(() => drawerState(page), { timeout: 10_000 }).toBe(open ? 'open' : 'closed');
}

/** The fake AI server's counters: chats received, and pending chats still held open. */
async function fakeAi(): Promise<{ calls: number; held: number }> {
  return (await (await fetch(`${fakeAiUrl()!}/__parity/mode`)).json()) as { calls: number; held: number };
}

/** "7 Dec" for 2026-12-07 (the chip format). */
function dayMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${String(d.getUTCDate())} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

async function phase(page: Page): Promise<string | null> {
  return drawer(page).locator('[data-phase]').first().getAttribute('data-phase');
}

// ------------------------------------------------------------------ harness self-check
test('harness: the fake AI provider answers POST /checkins/parse in each mode', async () => {
  test.skip(!fakeAiUrl(), 'needs the fake AI server (globalSetup)');
  const parse = (text: string) => api<{ source: string; provider: string; changes: { type: string }[]; unplaced: string[] }>('POST', '/checkins/parse', { text, focusProjectId: null, parseId: crypto.randomUUID() });
  await useAiStub('fixture');
  const out = await parse(CLAUDE_FIXTURE_TEXT);
  expect(out.source).toBe('ai');
  expect(out.provider).toBe('ollama');
  expect(out.changes.map((c) => c.type)).toEqual(CLAUDE_FIXTURE_REPLY.changes.map((c) => c.type));
  expect(out.unplaced).toEqual(CLAUDE_FIXTURE_REPLY.unplaced);
  await useAiStub('error');
  await expect(parse(CLAUDE_FIXTURE_TEXT)).rejects.toMatchObject({ status: 502 });
  await useAiStub('none');
  expect((await parse('+6h returns, blocked on data access')).source).toBe('simple');
});

// ------------------------------------------------------------------ check-in
test('@p4 palette "+6h returns": preview equals the applied forecast, chip and feed', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.setScreen('timeline');
  await d.app.openPalette();
  await d.app.typePalette('+6h returns');
  await expect(page.getByRole('option', { name: /Add 6h of scope to Returns pipeline/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expectDrawerOpen(page, true);
  const textarea = drawer(page).locator('textarea').first();
  await expect(textarea).toHaveValue(/New scope on Returns pipeline, about 6h/);
  await textarea.press('ControlOrMeta+Enter');
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('review');
  await d.app.ready();

  // The review's effect chip for the returns pipeline: "2 Dec → 7 Dec · +3 BD" (ADR-0007).
  const text = await drawer(page).innerText();
  const chip = /2 Dec → (\d{1,2} \w{3}) · ([+−]\d+ BD)/.exec(text);
  expect(chip, `effect chip in:\n${text}`).not.toBeNull();
  const [, previewTo, previewDelta] = chip!;
  expect(previewTo).toBe('7 Dec');
  expect(previewDelta).toBe('+3 BD');

  await textarea.press('ControlOrMeta+Enter');
  await expectDrawerOpen(page, false);

  // Apply == preview: the stored forecast, then the Timeline's ret row. Before the apply that row
  // already reads "+3 BD" (against the target), so check what only the apply can produce: the
  // moved chip (shown for 5.2s after a move, data-show="true") carrying the preview's shift, the
  // row now "Mon 7 Dec, +6 BD" against the target, and the ghost label for the old forecast.
  await expect.poll(async () => (await getProject('ret'))?.forecastDate, { timeout: 10_000 }).toBe('2026-12-07');
  expect(dayMonth((await getProject('ret'))!.forecastDate!)).toBe(previewTo);
  const retRow = region(page, 'Timeline').locator('[data-parity="timeline-row:ret"]');
  await expect(retRow.locator('[data-show="true"]')).toHaveText(previewDelta);
  await expect(retRow).toHaveAttribute('aria-label', /: Mon 7 Dec, \+6 BD\./);
  await expect(retRow).toContainText('was 2 Dec');
  const feed = JSON.stringify(await api('GET', '/feed'));
  expect(feed).toMatch(/Scope added \([^)]*\+6h\)\. Forecast moved 2 Dec → 7 Dec\./);
});

test('@p4 simple reading: untick one change, apply the rest', async ({ page }) => {
  const d = remiDrivers(page);
  expect((await getProject('ret'))?.lastCheckinDate, 'the fixture has no check-in today yet').not.toBe('2026-10-05');
  await d.app.boot();
  await region(page, 'Remi app').getByRole('button', { name: 'Tell Remi' }).first().click();
  await expectDrawerOpen(page, true);
  await d.app.typeCheckIn(MULTI_LINE_TEXT);
  await d.app.sendCheckIn();
  await expect(drawer(page)).toContainText('simple reading');
  await expect(drawer(page)).toContainText('Apply 3 changes');

  // Untick the BAU run (the third change); the returns run must stay open.
  const toggles = drawer(page).locator('[role="checkbox"], input[type="checkbox"]');
  await expect(toggles).toHaveCount(3);
  await toggles.nth(2).click();
  await expect(drawer(page)).toContainText('Apply 2 changes');
  await drawer(page).locator('textarea').first().press('ControlOrMeta+Enter');
  await expectDrawerOpen(page, false);

  await expect.poll(async () => (await getProject('ret'))?.lastCheckinDate, { timeout: 10_000 }).toBe('2026-10-05');
  expect((await getProject('play'))?.lastCheckinDate).toBe('2026-10-05');
  const day = await api<{ bauRows: { routineId?: string; run?: { completed: boolean } | null }[] }>('GET', '/day/2026-10-05');
  expect(day.bauRows.find((r) => r.routineId === 'r-ret')?.run?.completed).toBe(false);

  // The Projects row (the whole row; its link holds only the name) reads "Today" for the last
  // check-in, and the project that was not checked in does not.
  await d.app.setScreen('projects');
  const row = (pid: string) => region(page, 'Projects').locator(`[data-project="${pid}"]`);
  await expect(row('ret')).toContainText('Returns pipeline automation');
  await expect(row('ret')).toContainText('Today');
  await expect(row('alpha')).not.toContainText('Today');
});

test('@p4 check-in keys: ⌘↵ retries from the error phase, Esc in the text closes the drawer', async ({ page }) => {
  test.skip(!fakeAiUrl(), 'needs the fake AI server (globalSetup)');
  const d = remiDrivers(page);
  await d.app.boot({ claude: 'error' });
  await d.app.openCheckIn('ret');
  await d.app.typeCheckIn('Parsed the extract.');
  const calls = async () => (await fakeAi()).calls;
  const before = await calls();
  await d.app.sendCheckIn();
  await expect.poll(() => phase(page)).toBe('error');
  await expect(drawer(page)).toContainText('Remi couldn’t read that just now');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(calls, { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 2);
  await expect.poll(() => phase(page), { timeout: 15_000 }).toBe('error');

  // Escape closes the drawer from anywhere, the textarea included: the prototype listens on the
  // window (Remi.dc.html:372), CheckIn.dc.html:323 handles only ⌘↵, and × is titled "Close (esc)".
  await drawer(page).locator('textarea').first().focus();
  await page.keyboard.press('Escape');
  await expectDrawerOpen(page, false);
});

test('@p4 check-in: Esc during a reading closes the drawer and cancels the parse', async ({ page }) => {
  test.skip(!fakeAiUrl(), 'needs the fake AI server (globalSetup)');
  const d = remiDrivers(page);
  await d.app.boot({ claude: 'pending' });
  await d.app.openCheckIn('ret');
  await d.app.typeCheckIn('Parsed the extract.');
  const heldBefore = (await fakeAi()).held;
  const isParse = (r: { method(): string; url(): string }) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/checkins/parse';
  const posted = page.waitForRequest(isParse, { timeout: 10_000 });
  await d.app.sendCheckIn();
  const parse = await posted;
  expect(await phase(page)).toBe('thinking');
  await expect.poll(async () => (await fakeAi()).held, { timeout: 10_000 }).toBe(heldBefore + 1);

  // "Close: CLOSE, Escape or the scrim aborts any in-flight request" (arch-frontend-screens §3,
  // Check-in drawer): the browser drops the request and tells the server to stop the reading.
  const aborted = page.waitForEvent('requestfailed', { predicate: (r) => r === parse, timeout: 10_000 });
  const cancelled = page.waitForRequest(
    (r) => r.method() === 'DELETE' && /^\/api\/checkins\/parse\/[^/]+$/.test(new URL(r.url()).pathname),
    { timeout: 10_000 },
  );
  await drawer(page).locator('textarea').first().focus();
  await page.keyboard.press('Escape');
  await expectDrawerOpen(page, false);
  await aborted;
  await cancelled;
  // The server's own call to the provider ends too (soft: how far the cancel reaches is the
  // backend's; the drawer's contract is the abort and the DELETE above).
  await expect.soft.poll(async () => (await fakeAi()).held, { message: 'the provider call is still open after the cancel', timeout: 10_000 }).toBe(heldBefore);
});

// ------------------------------------------------------------------ Today
test('@p4 Today: checklist and task ticks persist', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.boot();
  const today = region(page, 'Today');
  await today.getByRole('checkbox', { name: 'Infrastructure Debt' }).first().click();
  await expect
    .poll(async () => {
      const day = await api<{ bauRows: { routineId?: string; run?: { tickedItemIds: string[] } | null }[] }>('GET', '/day/2026-10-05');
      return day.bauRows.find((r) => r.routineId === 'r-ret')?.run?.tickedItemIds ?? [];
    })
    .toContain('r-ret-fund-06');

  // The plan list (left) comes before the month snapshot's copy of the same task.
  await today.getByRole('checkbox', { name: 'Send the NAV bridge spec to Finance' }).first().click();
  await expect
    .poll(async () => {
      const man = await getProject('manco');
      const tasks = (man?.milestones as { tasks: { id: string; done: boolean }[] }[] | undefined)?.flatMap((m) => m.tasks) ?? [];
      return tasks.find((t) => t.id === 'man-0')?.done;
    })
    .toBe(true);

  await page.reload();
  await d.app.ready();
  await expect(today.getByRole('checkbox', { name: 'Infrastructure Debt' }).first()).toBeChecked();
  await expect(today.getByRole('checkbox', { name: 'Send the NAV bridge spec to Finance' }).first()).toBeChecked();
});

// ------------------------------------------------------------------ Workspace
test('@p4 Workspace: the target snaps to a business day, a rate edit replans, delete returns to Projects', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.boot();
  await d.app.openProject('ret');
  const ws = region(page, 'Project workspace');

  await d.app.openDatePicker('target');
  await page.getByRole('dialog').getByRole('button', { name: 'Sat 28 Nov · weekend' }).click();
  await expect.poll(async () => (await getProject('ret'))?.targetDate).toBe('2026-11-30');
  await expect(ws).toContainText('Mon 30 Nov');

  const before = (await getProject('ret'))!.forecastDate!;
  const rate = ws.locator('input[inputmode="decimal"]').first();
  await rate.fill('4');
  await rate.press('Enter');
  await expect.poll(async () => (await getProject('ret'))?.rate).toBe(4);
  const after = (await getProject('ret'))!.forecastDate!;
  expect(after < before, `forecast ${before} → ${after} after 3.5h → 4h a day`).toBe(true);

  await ws.getByRole('button', { name: 'Remove project' }).click();
  await ws.getByRole('button', { name: /Click again to remove Returns pipeline automation/ }).click();
  await expect(page).toHaveURL(/\/app\/projects(\?|$)/);
  await expect.poll(async () => (await getPlan()).projects.some((p) => p.id === 'ret')).toBe(false);
});

// ------------------------------------------------------------------ Routines
test('@p4 Routines: a rule change moves the run on Today and the Timeline loads', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.setScreen('routines');
  // The routine's row (data-rid); its name is an input value, not text.
  const row = region(page, 'Routines').locator('[data-rid="r-man"]');
  await expect(row.getByRole('textbox', { name: 'Routine name' })).toHaveValue('Managing Committee pack');
  const step = row.getByRole('group', { name: 'Business day of the month' }).getByRole('button', { name: 'Later business day' });
  await step.click();
  await step.click();
  await expect.poll(async () => (await getPlan()).routines.find((r) => r.id === 'r-man')?.rule.bd).toBe(10);

  // BD10 of October is Wed 14 Oct; BD8 (Mon 12 Oct) no longer has the pack, so it has no BAU at
  // all (its "next run" line still names the pack, so check the empty BAU list, not the name).
  const bauOn = async (iso: string) =>
    (await api<{ bauRows: { routineId?: string }[] }>('GET', `/day/${iso}`)).bauRows.map((r) => r.routineId);
  expect(await bauOn('2026-10-14')).toContain('r-man');
  expect(await bauOn('2026-10-12')).not.toContain('r-man');
  await d.app.previewDay('2026-10-14');
  await expect(region(page, 'Today')).toContainText('Managing Committee pack');
  await expect(region(page, 'Today')).not.toContainText('No BAU on this day.');
  await d.app.previewDay('2026-10-12');
  await expect(region(page, 'Today')).toContainText('No BAU on this day.');
  const loads = (await getPlan()).loads;
  expect(loads['2026-10-14']?.total).toBeGreaterThan(loads['2026-10-12']?.total ?? 0);

  // The Timeline's routine row now reads BD10 (it read BD8 before the change).
  await d.app.setScreen('timeline');
  const lane = region(page, 'Timeline').locator('[aria-label^="Managing Committee pack, "]');
  await expect(lane).toHaveAttribute('aria-label', /, BD10 · /);
  await expect(lane).toContainText('BD10');
});

// ------------------------------------------------------------------ Transition
test('@p4 Transition: countdown, buffer and the verdict states', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.setScreen('transition');
  const tr = region(page, 'Transition');
  await expect(tr).toContainText('business days to Fixed Income');
  await expect(tr).toContainText('Yes, narrowly');
  await expect(tr).toContainText('with 7 business days to spare');

  // The returns pipeline past the key run (Thu 3 Dec): at risk.
  await api('POST', '/checkins/apply', {
    changes: [{ type: 'scope_add', project_id: 'ret', text: 'FX attribution', hours: 6 }],
    rawText: 'FX attribution, about 6h',
    source: 'simple',
  });
  await d.app.setScreen('transition');
  await expect(region(page, 'Remi app')).toContainText('Move at risk');
  await expect(tr).toContainText('misses the December run');

  // A Private Credit exit on or after the move: off track.
  await api('POST', '/checkins/apply', {
    changes: [{ type: 'scope_add', project_id: 'play', text: 'Successor walkthroughs', hours: 40 }],
    rawText: 'Successor walkthroughs, about 40h',
    source: 'simple',
  });
  await d.app.setScreen('transition');
  await expect(region(page, 'Remi app')).toContainText('Off track for the move');
  expect((await getPlan()).verdict.state).toBe('off_track');
});

// ------------------------------------------------------------------ Calendar, Notes, Home
test('@p4 Calendar: Esc closes the day panel', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.openCalendarDay('2026-10-05');
  const cal = region(page, 'Calendar');
  await expect(cal).toContainText('Open the day’s plan in Today');
  await page.keyboard.press('Escape');
  await expect(cal).not.toContainText('Open the day’s plan in Today');
  await expect(page).not.toHaveURL(/[?&]day=/);
});

/** The saved note whose text is `text` (entries are textareas, so their text is a value): its label and its entry's text. */
async function noteEntry(notes: Locator, text: string): Promise<{ label: string | null; entry: string } | null> {
  return notes.evaluate((root, want) => {
    const ta = [...root.querySelectorAll('textarea')].find((t) => t.value === want && t.getAttribute('aria-label') !== 'New note');
    if (!ta) return null;
    // DayPage: .entry > [.entryTime, .entryBody > [textarea, .entryTags]]
    const entry = ta.parentElement?.parentElement as HTMLElement | null;
    return { label: ta.getAttribute('aria-label'), entry: entry?.innerText ?? '' };
  }, text);
}

test('@p4 Notes: a note is stamped 09:30 and tagged with the project it names, and survives a reload', async ({ page }) => {
  const d = remiDrivers(page);
  await d.app.setScreen('notes');
  const notes = region(page, 'Notes');
  const composer = notes.getByRole('textbox', { name: 'New note' });
  // "pipeline" is an alias of the returns pipeline: the tag shows the project's name.
  const NOTE = 'Mapped two more funds into the pipeline.';
  await composer.fill(NOTE);
  await composer.press('Enter');
  await expect.poll(() => noteEntry(notes, NOTE)).not.toBeNull();
  await expect(notes).toContainText('BD3 · 4 notes');
  // The stamp is the entry's own (aria-label "Note at HH:MM"), not the page's pinned clock: the
  // server stamps the note, and the harness backend runs with REMI_NOW at the page's instant.
  const saved = (await noteEntry(notes, NOTE))!;
  expect(saved.label, `the note's stamp (entry: ${saved.entry})`).toBe('Note at 09:30');
  expect(saved.entry).toContain('Returns pipeline');
  const stored = JSON.stringify(await api('GET', '/notes?day=2026-10-05'));
  expect(stored).toContain(NOTE);

  await page.reload();
  await d.app.ready();
  await expect.poll(() => noteEntry(notes, NOTE), { timeout: 10_000 }).not.toBeNull();
});

test('@p4 Home: keys 1 and 2 open the Control Panel and the Textbook', async ({ page }) => {
  const d = remiDrivers(page);
  await d.home.boot();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/\/app\/today/);
  await d.home.boot();
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/\/textbook/);
});

// ------------------------------------------------------------------ Textbook
test('@p4 Textbook: slash menu, a formula renders with KaTeX, a chart uploads into a sandboxed frame', async ({ page }) => {
  const d = remiDrivers(page);
  await d.textbook.boot();
  await d.textbook.openPage('fi-rates');
  const tb = region(page, 'Textbook');
  const katexBefore = await tb.locator('.katex').count();

  await tb.getByRole('button', { name: 'Add a block' }).last().click();
  await page.keyboard.type('/');
  await expect(page.getByText('Blocks', { exact: true })).toBeVisible();
  await page.keyboard.type('formula');
  await page.keyboard.press('Enter');
  await page.keyboard.type('P = \\frac{C}{(1+y)^n}');
  await page.keyboard.press('Enter');
  await expect.poll(() => tb.locator('.katex').count()).toBeGreaterThan(katexBefore);

  await tb.getByRole('button', { name: 'Add a block' }).last().click();
  await page.keyboard.type('/chart');
  await page.keyboard.press('Enter');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remi-chart-')), 'bars.html');
  fs.writeFileSync(file, '<!doctype html><html><body><svg width="200" height="100"><rect width="80" height="60" fill="#526e2a"/></svg></body></html>');
  await tb.locator('input[type="file"]').last().setInputFiles(file);
  const frame = tb.locator('iframe').last();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute('src', /\/api\/charts\//);
  await expect(tb).toContainText(/Saved/);
});

// ------------------------------------------------------------------ first run
test('@p4 first run: the wizard leads to empty states', async ({ page }) => {
  await loadFixture('empty');
  const d = remiDrivers(page);
  await d.setup!.boot();
  await expect(page.getByRole('heading', { name: 'Set up your plan' })).toBeVisible();

  // 1 The move: Mon 4 Jan 2027.
  await page.getByRole('button', { name: /move|date/i }).first().click();
  const picker = page.getByRole('dialog');
  for (let i = 0; i < 6 && !(await picker.innerText()).includes('January 2027'); i++) await picker.getByRole('button', { name: 'Next month' }).click();
  await picker.getByRole('button', { name: 'Mon 4 Jan' }).click();
  await expect(page.locator('body')).toContainText('business days to Fixed Income');
  await page.getByRole('button', { name: 'Start with an empty plan' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await api<{ needsSetup: boolean }>('GET', '/setup')).needsSetup).toBe(false);

  const plan = await getPlan();
  expect(plan.projects).toEqual([]);
  expect(plan.move.date).toBe('2027-01-04');
  await d.app.setScreen('projects');
  await expect(region(page, 'Projects')).toContainText('No Private Credit projects yet. Start one with + New project.');
  await d.app.setScreen('today');
  await expect(region(page, 'Today')).toContainText('No BAU on this day.');
  await d.app.setScreen('notes');
  await expect(region(page, 'Notes')).toContainText('A blank page. Jot anything');
  await d.app.setScreen('routines');
  await expect(region(page, 'Routines')).toContainText('No routines yet.');
});

// ------------------------------------------------------------------ persistence
test('@p4 reload persistence: an applied check-in survives a new browser context', async ({ page, browser }) => {
  const d = remiDrivers(page);
  await d.app.boot();
  await d.app.openCheckIn('ret');
  await d.app.typeCheckIn('They want FX attribution too, about 6h.');
  await d.app.sendCheckIn();
  await drawer(page).locator('textarea').first().press('ControlOrMeta+Enter');
  await expectDrawerOpen(page, false);
  await expect.poll(async () => (await getProject('ret'))?.forecastDate, { timeout: 10_000 }).toBe('2026-12-07');

  // A fresh context has no browser storage: what it shows came from the server.
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    const d2 = remiDrivers(fresh);
    await d2.app.boot();
    await d2.app.openProject('ret');
    await expect(region(fresh, 'Project workspace')).toContainText('Mon 7 Dec');
  } finally {
    await context.close();
  }
});
