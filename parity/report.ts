// Writes docs/parity-report.md from parity/report/results/<state>.json (written by
// specs/parity.spec.ts). Called by the Remi run's globalTeardown after a parity run, and
// runnable on its own: `node report.ts` from parity/ (Node strips the types).
//
// The report has a table per state (Tier A pass/fail and the regions that differ, Tier B diff
// ratio against its budget, when it was captured, links to the side-by-side and diff PNGs in
// parity/report/), the documented divergences, and the Tier A line diffs.
//
// Rows belong to runs (PARITY_RUN_ID: one per `make parity`, shared by its design and empty
// invocations). The totals count only the current run's rows; rows left from earlier runs (a
// run filtered with STATE= captures only some states) are listed as stale and not counted.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIVERGENCES } from './divergences.ts';
import { STATES } from './states.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_DIR = path.join(HERE, 'report');
export const RESULTS_DIR = path.join(REPORT_DIR, 'results');
export const REPORT_MD = path.resolve(HERE, '..', 'docs', 'parity-report.md');

interface BoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One state's outcome (the shape specs/parity.spec.ts writes). */
export interface StateResult {
  id: string;
  about: string;
  surface: string;
  remiOnly: boolean;
  /** The run that captured it (PARITY_RUN_ID). */
  runId?: string;
  capturedAt: string;
  servedBy: string;
  /** The baseline the capture was scored against. */
  reference: 'prototype' | 'remi-approved' | 'none';
  driverError: string | null;
  pageErrors: string[];
  blockedRequests: string[];
  tierA: {
    pass: boolean;
    regions: { label: string; status: string; diff: string[]; boxDelta: BoxLike | null; divergences: string[] }[];
    anchors: { name: string; delta: BoxLike | null; pass: boolean }[];
    /** The live-chart check (charts.ts); absent in results written before it existed. */
    charts?: { name: string; protoInk: number; remiInk: number; similarity: number; pass: boolean; reason: string }[];
    notes: string[];
  } | null;
  tierB: { pass: boolean; ratio: number; budget: number; sizeMismatch: string | null; masks: number } | null;
  divergences: string[];
  /** What the capture depends on that the harness cannot pin (the wizard's host timezone). */
  hostNotes?: string[];
  /** Remi only: the approval of the baseline it was scored against (approvals.ts). */
  approval?: { matches: boolean; approvedBy: string; approvedAt: string; note?: string | null; signedOffBy: string | null; signedOffAt: string | null } | null;
  /** Remi only: why the capture does not hold the whole page (not fullPage, sideways scroll). */
  coverage?: string[];
  images: { remi: string; sideBySide: string | null; diff: string | null };
}

const DIFF_LINES_SHOWN = 24;

/** Copy that only Remi has (no prototype state shows it), listed for the reviewers. */
const NEW_COPY: [string, string, string][] = [
  ['Home, Textbook card on an install with no pages', 'No pages yet.', 'docs/requests/F4-screens.md (Home Textbook card)'],
  ['Timeline footnote on an empty plan', 'The footnote drops the "Hover a row…" clause, and the day slivers stop above it', 'docs/requests/F4-screens.md (Timeline)'],
  ['Today, a past day', 'Kicker "<Weekday> · N business day(s) ago"; plan note "Looking back; the plan as it stands now"', 'docs/requests/UI-today.md, F4-screens.md (Today)'],
  ['Every screen with nothing in the plan', 'The empty-state catalogue (for example "No Private Credit projects yet. Start one with + New project.", "No routines yet.")', 'arch-frontend-screens §5; the empty-* captures'],
  ['Home and the Textbook with nothing in them', 'Home\'s empty control panel and Textbook card; the Textbook with no pages', 'arch-frontend-screens §5; the empty-home and empty-textbook captures'],
  ['First-run wizard and Settings', 'All of it (ADR-0010)', 'docs/requests/UI-setup-settings.md; the setup-wizard and settings captures'],
];
const pct = (v: number) => `${(v * 100).toFixed(v < 0.001 && v > 0 ? 3 : 2)}%`;
const link = (rel: string | null, text: string) => (rel ? `[${text}](../parity/${rel})` : '');
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function readResults(): Map<string, StateResult> {
  const out = new Map<string, StateResult>();
  if (!fs.existsSync(RESULTS_DIR)) return out;
  for (const f of fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')) as StateResult;
      out.set(r.id, r);
    } catch {
      /* a half-written file from an interrupted run */
    }
  }
  return out;
}

function tierACell(r: StateResult): string {
  if (!r.tierA) return r.reference === 'none' ? 'no baseline' : '—';
  if (r.tierA.pass) return '**pass**';
  const bad = r.tierA.regions.filter((g) => g.status !== 'pass').map((g) => `${g.label} (${g.status})`);
  const anchors = r.tierA.anchors.filter((a) => !a.pass);
  if (anchors.length) {
    const names = anchors.slice(0, 4).map((a) => `anchor ${a.name}${a.delta ? '' : ' (missing)'}`);
    if (anchors.length > 4) names.push(`${String(anchors.length - 4)} more anchors`);
    bad.push(...names);
  }
  bad.push(...(r.tierA.charts ?? []).filter((c) => !c.pass).map((c) => `chart ${c.name} (${c.reason})`));
  return `fail: ${esc(bad.join(', '))}`;
}

function tierBCell(r: StateResult): string {
  if (!r.tierB) return '—';
  return `${r.tierB.pass ? '**pass**' : 'fail'} ${pct(r.tierB.ratio)} / ${pct(r.tierB.budget)}`;
}

function notesCell(r: StateResult): string {
  const notes: string[] = [];
  if (r.driverError) notes.push(`driver: ${r.driverError}`);
  if (r.pageErrors.length) notes.push(`${String(r.pageErrors.length)} page error(s): ${r.pageErrors[0]!.slice(0, 120)}`);
  if (r.blockedRequests.length) notes.push(`${String(r.blockedRequests.length)} external request(s) blocked`);
  if (r.tierB?.sizeMismatch) notes.push(`size: ${r.tierB.sizeMismatch}`);
  if (r.divergences.length) notes.push(`divergences: ${r.divergences.join(', ')}`);
  for (const c of r.tierA?.charts ?? []) notes.push(`chart ${c.name}: similarity ${c.similarity.toFixed(3)}, ink ${pct(c.remiInk)} vs ${pct(c.protoInk)}`);
  if (r.hostNotes?.length) notes.push(...r.hostNotes);
  if (r.coverage?.length) notes.push(...r.coverage.map((c) => `capture: ${c}`));
  if (r.approval && !r.approval.matches) notes.push('the approved PNG is not the one recorded in approvals.json');
  if (r.approval?.note) notes.push(`approval note: ${r.approval.note}`);
  if (r.tierA) notes.push(...r.tierA.notes);
  return esc(notes.join('; ')).slice(0, 600);
}

/** "Approved by X, 25 Sep; signed off by Y" for a Remi-only row. */
function approvalCell(r: StateResult): string {
  const a = r.approval;
  if (!a) return r.reference === 'none' ? 'not approved' : 'no record in approvals.json';
  const approved = `${esc(a.approvedBy)}, ${a.approvedAt.slice(0, 10)}`;
  return a.signedOffBy && a.matches ? `${approved}; **signed off** by ${esc(a.signedOffBy)}, ${(a.signedOffAt ?? '').slice(0, 10)}` : `${approved}; sign-off pending`;
}

function imagesCell(r: StateResult): string {
  return [link(r.images.sideBySide, 'side by side'), link(r.images.diff, 'diff'), link(r.images.remi, 'Remi')].filter(Boolean).join(' · ');
}

/** "2026-09-24 18:13 UTC" from an ISO time. */
const when = (iso: string) => iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC');

/**
 * The run the report is for: `runId`, else PARITY_RUN_ID, else the run of the newest result.
 * Rows from other runs are stale.
 */
function currentRun(results: StateResult[], runId?: string): string | null {
  const id = runId ?? process.env.PARITY_RUN_ID;
  if (id) return id;
  const newest = [...results].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1);
  return newest?.runId ?? null;
}

export function writeReport(opts: { runId?: string } = {}): { states: number; tierA: number; tierB: number; stale: number } {
  const results = readResults();
  const order = STATES.map((s) => s.id);
  const rows = order.map((id) => results.get(id)).filter((r): r is StateResult => !!r);
  const run = currentRun(rows, opts.runId);
  const isStale = (r: StateResult) => run !== null && (r.runId ?? null) !== run;
  const fresh = rows.filter((r) => !isStale(r));
  const stale = rows.filter(isStale);
  const design = rows.filter((r) => !r.remiOnly);
  const remiOnly = rows.filter((r) => r.remiOnly);
  const scored = design.filter((r) => !isStale(r) && r.tierA && r.tierB);
  const tierA = scored.filter((r) => r.tierA!.pass).length;
  const tierB = scored.filter((r) => r.tierB!.pass).length;
  const drivers = fresh.filter((r) => r.driverError).length;
  const onlyScored = remiOnly.filter((r) => !isStale(r) && r.tierA && r.tierB);
  const onlyUnapproved = remiOnly.filter((r) => !isStale(r) && r.reference === 'none').map((r) => r.id);
  const onlySigned = onlyScored.filter((r) => r.approval?.signedOffBy && r.approval.matches).length;
  const onlyPending = remiOnly.filter((r) => !isStale(r) && r.reference !== 'none' && !(r.approval?.signedOffBy && r.approval.matches)).map((r) => r.id);
  const missing = STATES.filter((s) => !results.has(s.id)).map((s) => s.id);
  const newest = fresh.map((r) => r.capturedAt).sort().at(-1);
  const servedBy = [...new Set(fresh.map((r) => r.servedBy))].join(', ') || '—';
  const capturedCell = (r: StateResult) => (isStale(r) ? `**stale** (${when(r.capturedAt)}, not counted)` : when(r.capturedAt));

  const L: string[] = [];
  L.push('# Visual parity report');
  L.push('');
  L.push(
    'Generated by `make parity` (`parity/specs/parity.spec.ts`, `parity/compare.ts`) from `parity/report/results/`. ' +
      'Remi runs with `REMI_ENV=test REMI_TODAY=2026-10-05 REMI_NOW=2026-10-05T09:30:00+01:00 REMI_DEFAULT_TIMEZONE=Europe/London` ' +
      'and the design fixture; both apps run in Chromium at 1920×1080, DPR 1, reduced motion, en-GB, Europe/London, clock pinned ' +
      'to Mon 5 Oct 2026 09:30, and every live chart drawn at the same moment of its animation. ' +
      'The prototype side is `parity/baselines/prototype/` (`make parity-baseline`).',
  );
  L.push('');
  L.push(`- This run: \`${run ?? 'unknown'}\`, last capture ${newest ? when(newest) : 'never'}; frontend served by ${servedBy}.`);
  L.push(`- **Tier A** (each visible \`data-screen-label\` region's own text and field values, its box, every \`data-parity\` anchor within ±2px, and every live chart's content): **${String(tierA)} of ${String(scored.length)}** design states in this run pass (target: all).`);
  L.push(`- **Tier B** (pixelmatch, threshold 0.1, live charts compared; only the Notes clock, "Just now" stamps, [data-parity-mask] and the caret masked): **${String(tierB)} of ${String(scored.length)}** within budget (target: 95%).`);
  L.push(
    `- **Remi-only states** (the first-run wizard and the empty states, against their approved baselines): Tier A **${String(onlyScored.filter((r) => r.tierA!.pass).length)} of ${String(onlyScored.length)}**, ` +
      `Tier B **${String(onlyScored.filter((r) => r.tierB!.pass).length)} of ${String(onlyScored.length)}**` +
      (onlyUnapproved.length ? `; no approved baseline yet: ${onlyUnapproved.join(', ')}` : '') +
      `. Signed off by a person: **${String(onlySigned)} of ${String(onlyScored.length)}**` +
      (onlyPending.length ? ` (pending: ${onlyPending.join(', ')}; \`make parity-confirm\`).` : '.'),
  );
  L.push(`- Driver errors (the state could not be reached; the capture shows where it stopped): ${String(drivers)}.`);
  if (stale.length) L.push(`- Stale rows from earlier runs, listed but not counted (re-run without \`STATE=\` to refresh them): ${stale.map((r) => r.id).join(', ')}.`);
  if (missing.length) L.push(`- Not captured yet: ${missing.join(', ')}.`);
  L.push('');
  L.push('How to read it: Tier A compares each region\'s own visible text as a reader sees it (icons, screen-reader-only text, nested labelled regions and opacity-0 content left out; each Roll read as its value, not its reels), then its own form fields\' values (`[field] …` lines), after the documented divergences below are applied to the prototype\'s text. `missing` means Remi has no region with that label, `hidden` that it is not visible, `shown` that Remi shows a region the prototype hides, `box` that its box moved more than 2px; `anchor … (missing)` that Remi lacks a `data-parity` anchor the prototype capture has; `chart …` that a live chart is blank or a different picture (`parity/charts.ts`: the chart\'s box is cropped from both screenshots, its ink must be at least 0.1% of the box and 0.5–2× the prototype\'s, and the cosine similarity of the two 32-column ink grids at least 0.9; the notes give each chart\'s figures). Tier B is the share of differing pixels against the state\'s budget (1% chrome, 2% dense screens). Images: prototype | Remi | diff, at half size; the diff PNG is full size.');
  L.push('');
  L.push('## Design states');
  L.push('');
  L.push('| State | Tier A | Tier B (diff / budget) | Captured | Notes | Images |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of design) L.push(`| \`${r.id}\` | ${tierACell(r)} | ${tierBCell(r)} | ${capturedCell(r)} | ${notesCell(r)} | ${imagesCell(r)} |`);
  L.push('');
  L.push('## Remi-only states');
  L.push('');
  L.push(
    'The prototype has no first run, no empty plan and no Settings page, so these states compare against approved Remi captures in `parity/baselines/remi-approved/` (committed), ' +
      'with the same Tier A and Tier B rules; a page taller than the viewport is captured in full. Each approval is recorded in `approvals.json` against the PNG\'s sha256: ' +
      'who approved it (`make parity STATE=<id> PARITY_APPROVE=1 PARITY_APPROVER="<who>"`, after looking at the capture) and, once a person has looked at the approved PNG, ' +
      'their sign-off (`make parity-confirm STATE=<regex> BY="<name>"`). A state whose PNG is not the approved one fails; a new approval clears the sign-off.',
  );
  L.push('');
  L.push('| State | Reference | Tier A | Tier B (diff / budget) | Approved; signed off | Captured | Notes | Images |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of remiOnly) L.push(`| \`${r.id}\` | ${r.reference} | ${tierACell(r)} | ${tierBCell(r)} | ${approvalCell(r)} | ${capturedCell(r)} | ${notesCell(r)} | ${imagesCell(r)} |`);
  if (!remiOnly.length) L.push('| — | | | | | | not captured yet | |');
  L.push('');
  L.push('## Documented divergences');
  L.push('');
  L.push('From `parity/divergences.ts`. Text rows rewrite the prototype\'s Tier A text for that region before comparing; visual rows only explain pixels.');
  L.push('');
  L.push('| Id | Kind | States | Region | Prototype → Remi | Source | Why |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  const quoted = (v: string) => (v === '' ? '(removed)' : `"${v.replace(/\n/g, ' / ')}"`);
  for (const d of DIVERGENCES) {
    if (d.kind === 'data') continue;
    const change = d.kind === 'text' ? `${quoted(d.prototype)} → ${quoted(d.remi)}` : d.what;
    L.push(`| \`${d.id}\` | ${d.kind} | ${d.states.join(', ')} | ${d.region} | ${esc(change)} | ${d.source} | ${esc(d.why)} |`);
  }
  L.push('');
  L.push('### Documented divergences that no state shows');
  L.push('');
  L.push('The rest of ADR-0007\'s table, for completeness: no parity state reaches these values (or the design never renders them). The backend goldens and the behaviour flows cover them.');
  L.push('');
  L.push('| Id | Where | What Remi does | Source | Why no state shows it |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const d of DIVERGENCES) {
    if (d.kind !== 'data') continue;
    L.push(`| \`${d.id}\` | ${d.region} | ${esc(d.what)} | ${d.source} | ${esc(d.why)} |`);
  }
  L.push('');
  L.push('### New copy (Remi only)');
  L.push('');
  L.push('Text the prototype never shows, because it has no such state. None of it appears in a design state; the Remi-only captures show some of it.');
  L.push('');
  L.push('| Where | Copy | Source |');
  L.push('| --- | --- | --- |');
  for (const [where, copy, source] of NEW_COPY) L.push(`| ${where} | ${esc(copy)} | ${source} |`);
  L.push('');
  L.push('## Tier A differences');
  L.push('');
  L.push(`Line diffs per failing region: \`-\` the prototype (after divergences), \`+\` Remi. At most ${String(DIFF_LINES_SHOWN)} lines per region; the full diff is in \`parity/report/results/<state>.json\`.`);
  L.push('');
  let any = false;
  for (const r of fresh) {
    const bad = r.tierA?.regions.filter((g) => g.status !== 'pass') ?? [];
    if (!bad.length) continue;
    any = true;
    L.push(`### ${r.id}`);
    L.push('');
    for (const g of bad) {
      const box = g.boxDelta ? ` (box Δ x ${String(g.boxDelta.x)}, y ${String(g.boxDelta.y)}, w ${String(g.boxDelta.width)}, h ${String(g.boxDelta.height)})` : '';
      L.push(`<details><summary>${g.label}: ${g.status}${box}, ${String(g.diff.length)} diff line(s)</summary>`);
      L.push('');
      if (g.diff.length) {
        L.push('```diff');
        g.diff.slice(0, DIFF_LINES_SHOWN).forEach((l) => L.push(l.length > 220 ? l.slice(0, 220) + '…' : l));
        if (g.diff.length > DIFF_LINES_SHOWN) L.push(`… ${String(g.diff.length - DIFF_LINES_SHOWN)} more`);
        L.push('```');
      } else {
        L.push(
          g.status === 'missing'
            ? 'Remi has no region with this label.'
            : g.status === 'hidden'
              ? 'The region exists but is not visible.'
              : 'Text matches; only the box differs.',
        );
      }
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }
  if (!any) L.push('None.');
  L.push('');

  const anchorRows = fresh.filter((r) => r.tierA?.anchors.some((a) => !a.pass));
  if (anchorRows.length) {
    L.push('## Anchors off by more than 2px or missing');
    L.push('');
    L.push('| State | Anchor | Δ x, y, w, h (Remi − prototype) |');
    L.push('| --- | --- | --- |');
    for (const r of anchorRows) {
      for (const a of r.tierA!.anchors.filter((x) => !x.pass)) {
        const d = a.delta ? `${String(a.delta.x)}, ${String(a.delta.y)}, ${String(a.delta.width)}, ${String(a.delta.height)}` : 'missing in Remi';
        L.push(`| \`${r.id}\` | \`${a.name}\` | ${d} |`);
      }
    }
    L.push('');
  }

  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, L.join('\n'));
  return { states: fresh.length, tierA, tierB, stale: stale.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = writeReport();
  console.log(`docs/parity-report.md: ${String(out.states)} states in this run (${String(out.stale)} stale); Tier A ${String(out.tierA)}, Tier B ${String(out.tierB)} passing`);
}
