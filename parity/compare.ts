// Scoring one state: Remi's capture against the prototype baseline
// (docs/design-spec/arch-delivery-parity.md section 3, "Scoring tiers").
//
//   Tier A (must pass)  For every labelled region that is visible in the prototype, Remi has the
//                       same region, visible, with the same Tier A text after the documented
//                       divergences (divergences.ts): its own visible text (ownLines: no icons,
//                       sr-only text, nested regions or opacity-0 content; each Roll read as its
//                       value) followed by its own form fields' values (ownFields); and its box
//                       is within ±2px. A region the prototype has but hides must not be shown
//                       by Remi. Every [data-parity] anchor the prototype capture carries (the
//                       baseline spec tags the elements Remi's screens mark) must exist in Remi
//                       within ±2px. Pages without labelled regions (Foundations) compare the
//                       whole page's text. Every live chart the prototype shows must be in
//                       Remi's screenshot with real ink and the same picture (charts.ts): the
//                       only check that sees inside a chart, since innerText stops at the iframe
//                       and a chart is too thin for Tier B.
//   Tier B              pixelmatch at threshold 0.1 over the whole screenshot, live charts
//                       included, with only the time-dependent content of both captures masked
//                       ([data-parity-mask], the Notes clock, "Just now" stamps; the caret is
//                       hidden at capture); the diff ratio must stay within the state's budget
//                       (states.ts: 1% chrome, 2% dense screens). Tier B alone cannot catch a
//                       blank chart (a blanked full-screen chart moves it by about 0.2%).
//   Tier C              everything else (regions or anchors only Remi has, divergence rows that
//                       no longer match) is reported, not failed.

import fs from 'node:fs';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { framesOf, scoreCharts, type ChartResult } from './charts.ts';
import type { Box, FieldCapture, Mask, PageCapture, RegionCapture } from './drivers/common.ts';
import { applyDivergences } from './divergences.ts';

/** What the capture specs write next to each PNG. */
export interface CaptureRecord extends PageCapture {
  state: { id: string; surface: string; about: string; fullPage: boolean; maxDiffRatio: number; [key: string]: unknown };
  app: string;
  screenshot: string;
  [key: string]: unknown;
}

export const BOX_TOLERANCE = 2;

export interface RegionResult {
  label: string;
  /**
   * pass; text (text or field values differ); box (moved more than 2px); text+box; missing (no
   * region with the label); hidden (Remi's is not visible); shown (the prototype hides it, Remi shows it).
   */
  status: 'pass' | 'text' | 'box' | 'text+box' | 'missing' | 'hidden' | 'shown';
  expected: string;
  actual: string;
  /** Line diff, prototype (after divergences) "-" vs Remi "+". */
  diff: string[];
  boxDelta: Box | null;
  divergences: string[];
}

export interface AnchorResult {
  /** The anchor name, with "#k" when the prototype has several (rotation segments). */
  name: string;
  /** Remi minus prototype; null when Remi has no such anchor. */
  delta: Box | null;
  pass: boolean;
}

export interface TierAResult {
  pass: boolean;
  regions: RegionResult[];
  anchors: AnchorResult[];
  /** The live-chart check (charts.ts), one row per chart the prototype shows. */
  charts: ChartResult[];
  /** Tier C notes: extra regions, stale divergence rows. */
  notes: string[];
}

export interface TierBResult {
  pass: boolean;
  ratio: number;
  budget: number;
  diffPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  sizeMismatch: string | null;
  masks: number;
}

// ------------------------------------------------------------------ text diff
/** A line diff (LCS). Returns "-" lines only in `a`, "+" lines only in `b`, in order. */
export function lineDiff(a: string[], b: string[], limit = 400): string[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 6_000_000) {
    const inB = new Set(b);
    const inA = new Set(a);
    return [...a.filter((l) => !inB.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+ ${l}`)].slice(0, limit);
  }
  const dp = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while ((i < n || j < m) && out.length < limit) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i === n || dp[at(i, j + 1)]! >= dp[at(i + 1, j)]!)) {
      out.push(`+ ${b[j]!}`);
      j++;
    } else {
      out.push(`- ${a[i]!}`);
      i++;
    }
  }
  return out;
}

function boxDelta(a: Box, b: Box): Box {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(b.x - a.x), y: r(b.y - a.y), width: r(b.width - a.width), height: r(b.height - a.height) };
}

const withinTolerance = (d: Box) => [d.x, d.y, d.width, d.height].every((v) => Math.abs(v) <= BOX_TOLERANCE);

/**
 * A form field as a Tier A line: its value, or its placeholder while it is empty (what a reader
 * sees). Values are not in innerText, so without these a wrong number in an input would pass.
 */
export function fieldLine(f: FieldCapture): string {
  return f.value ? `[field] ${f.value}` : `[field placeholder] ${f.placeholder ?? ''}`;
}

/** Tier A lines: the region's own text, then its own fields. */
export const tierALines = (r: RegionCapture): string[] => [...(r.ownLines ?? r.lines), ...(r.ownFields ?? []).map(fieldLine)];
export const tierAText = (r: RegionCapture): string => tierALines(r).join(' ');

const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * Pairs each prototype anchor with Remi's anchor of the same name (the nearest unpaired one, so
 * repeated names such as rotation segments pair up by position). A prototype anchor with no
 * partner fails; Remi's extras are notes.
 */
export function scoreAnchors(proto: PageCapture['anchors'], remi: PageCapture['anchors'], notes: string[]): AnchorResult[] {
  const out: AnchorResult[] = [];
  const names = [...new Set(proto.map((a) => a.name))];
  for (const name of names) {
    const ps = proto.filter((a) => a.name === name);
    const rs = remi.filter((a) => a.name === name);
    ps.forEach((p, k) => {
      const label = ps.length > 1 ? `${name} #${String(k + 1)}` : name;
      const c = centre(p.box);
      let best = -1;
      let bestD = Infinity;
      rs.forEach((r, j) => {
        const rc = centre(r.box);
        const d = Math.hypot(rc.x - c.x, rc.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      if (best < 0) {
        out.push({ name: label, delta: null, pass: false });
        return;
      }
      const [r] = rs.splice(best, 1);
      const delta = boxDelta(p.box, r!.box);
      out.push({ name: label, delta, pass: withinTolerance(delta) });
    });
    if (rs.length) notes.push(`Remi has ${String(rs.length)} more "${name}" anchor(s) than the prototype`);
  }
  const protoNames = new Set(names);
  const extra = [...new Set(remi.filter((a) => !protoNames.has(a.name)).map((a) => a.name))];
  if (extra.length) notes.push(`anchors only Remi has: ${extra.join(', ')}`);
  return out;
}

// ------------------------------------------------------------------ Tier A
/**
 * Tier A for one state. `pngs` (the two screenshots) turns on the live-chart check; without
 * them charts are not scored.
 */
export function scoreTierA(stateId: string, proto: CaptureRecord, remi: CaptureRecord, pngs?: { prototype: string; remi: string }): TierAResult {
  const regions: RegionResult[] = [];
  const notes: string[] = [];
  const labelledProto = proto.regions.filter((r) => !r.label.startsWith('#'));

  if (labelledProto.length === 0) {
    // Foundations: no labelled regions in the prototype, so compare the page's visible text.
    const exp = applyDivergences(stateId, 'page', proto.pageLines ?? proto.regions.flatMap(tierALines));
    const actual = (remi.pageLines ?? []).join(' ');
    const pass = exp.text === actual;
    regions.push({
      label: 'page',
      status: pass ? 'pass' : 'text',
      expected: exp.text,
      actual,
      diff: pass ? [] : lineDiff(exp.lines, remi.pageLines ?? []),
      boxDelta: null,
      divergences: exp.applied,
    });
    exp.missing.forEach((id) => notes.push(`divergence ${id} did not match the prototype text (stale row?)`));
  } else {
    for (const p of labelledProto) {
      if (!p.visible || !p.inViewport) continue;
      const candidates = remi.regions.filter((r) => r.label === p.label);
      const r = candidates.find((c) => c.visible) ?? candidates[0];
      const exp = applyDivergences(stateId, p.label, tierALines(p));
      exp.missing.forEach((id) => notes.push(`divergence ${id} did not match the prototype text of "${p.label}" (stale row?)`));
      if (!r) {
        regions.push({ label: p.label, status: 'missing', expected: exp.text, actual: '', diff: [], boxDelta: null, divergences: exp.applied });
        continue;
      }
      if (!r.visible) {
        regions.push({ label: p.label, status: 'hidden', expected: exp.text, actual: '', diff: [], boxDelta: boxDelta(p.box, r.box), divergences: exp.applied });
        continue;
      }
      const actual = tierAText(r);
      const textOk = exp.text === actual;
      const delta = proto.state.fullPage ? null : boxDelta(p.box, r.box);
      const boxOk = delta === null || withinTolerance(delta);
      regions.push({
        label: p.label,
        status: textOk && boxOk ? 'pass' : !textOk && !boxOk ? 'text+box' : textOk ? 'box' : 'text',
        expected: exp.text,
        actual,
        diff: textOk ? [] : lineDiff(exp.lines, tierALines(r)),
        boxDelta: delta,
        divergences: exp.applied,
      });
    }
    // A region the prototype has but does not show must not be on screen in Remi (Tier A); a
    // label the prototype never has is Remi-only UI (Tier C).
    const shownInProto = new Set(labelledProto.filter((p) => p.visible && p.inViewport).map((p) => p.label));
    const protoLabels = new Set(labelledProto.map((p) => p.label));
    const reported = new Set<string>();
    for (const r of remi.regions) {
      if (!r.visible || !r.inViewport || shownInProto.has(r.label) || reported.has(r.label)) continue;
      reported.add(r.label);
      if (!protoLabels.has(r.label)) {
        notes.push(`Remi shows a region the prototype does not have: "${r.label}"`);
        continue;
      }
      regions.push({
        label: r.label,
        status: 'shown',
        expected: '',
        actual: tierAText(r),
        diff: tierALines(r).map((l) => `+ ${l}`),
        boxDelta: null,
        divergences: [],
      });
    }
  }

  const anchors = scoreAnchors(proto.anchors ?? [], remi.anchors ?? [], notes);
  const charts = pngs ? scoreCharts({ prototypePng: pngs.prototype, remiPng: pngs.remi, protoFrames: framesOf(proto), remiFrames: framesOf(remi) }) : [];

  return {
    pass: regions.every((r) => r.status === 'pass') && anchors.every((a) => a.pass) && charts.every((c) => c.pass),
    regions,
    anchors,
    charts,
    notes,
  };
}

// ------------------------------------------------------------------ Tier B
function readPng(file: string): PNG {
  return PNG.sync.read(fs.readFileSync(file));
}

/** Copy `src` into a w×h canvas; the area outside it is magenta, so a size change counts as a difference. */
function padTo(src: PNG, w: number, h: number): Buffer {
  if (src.width === w && src.height === h) return Buffer.from(src.data);
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([255, 0, 255, 255], i * 4);
  for (let y = 0; y < src.height; y++) src.data.copy(out, y * w * 4, y * src.width * 4, (y + 1) * src.width * 4);
  return out;
}

function fillRect(buf: Buffer, w: number, h: number, box: Box, rgba: [number, number, number, number]): void {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.width));
  const y1 = Math.min(h, Math.ceil(box.y + box.height));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.set(rgba, (y * w + x) * 4);
}

/** Half-size copy (2×2 box filter) for the side-by-side sheet. */
function half(buf: Buffer, w: number, h: number): { data: Buffer; w: number; h: number } {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const out = Buffer.alloc(hw * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      for (let c = 0; c < 4; c++) {
        const s =
          buf[((2 * y) * w + 2 * x) * 4 + c]! +
          buf[((2 * y) * w + 2 * x + 1) * 4 + c]! +
          buf[((2 * y + 1) * w + 2 * x) * 4 + c]! +
          buf[((2 * y + 1) * w + 2 * x + 1) * 4 + c]!;
        out[(y * hw + x) * 4 + c] = Math.round(s / 4);
      }
    }
  }
  return { data: out, w: hw, h: hh };
}

function writeSideBySide(file: string, panels: Buffer[], w: number, h: number): void {
  const GAP = 16;
  const halves = panels.map((p) => half(p, w, h));
  const pw = halves[0]!.w;
  const ph = halves[0]!.h;
  const sheet = new PNG({ width: pw * halves.length + GAP * (halves.length - 1), height: ph });
  sheet.data.fill(255);
  halves.forEach((hp, k) => {
    for (let y = 0; y < ph; y++) hp.data.copy(sheet.data, (y * sheet.width + k * (pw + GAP)) * 4, y * pw * 4, (y + 1) * pw * 4);
  });
  fs.writeFileSync(file, PNG.sync.write(sheet));
}

/**
 * The mask kinds Tier B applies. Older prototype baselines also list "iframe" masks (the live
 * charts); those are ignored, so Tier B compares the charts' pixels too. That is not enough to
 * fail a blank or wrong chart (a chart is about 1% of the frame): Tier A's chart check
 * (charts.ts) is what does.
 */
export const TIER_B_MASK_KINDS: ReadonlySet<string> = new Set(['marked', 'clock', 'stamp']);

export function scoreTierB(opts: {
  prototypePng: string;
  remiPng: string;
  masks: Mask[];
  budget: number;
  diffPng: string;
  sideBySidePng: string;
}): TierBResult {
  const a = readPng(opts.prototypePng);
  const b = readPng(opts.remiPng);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const sizeMismatch = a.width !== b.width || a.height !== b.height ? `prototype ${String(a.width)}×${String(a.height)}, Remi ${String(b.width)}×${String(b.height)}` : null;
  const pa = padTo(a, w, h);
  const pb = padTo(b, w, h);
  const GREY: [number, number, number, number] = [128, 128, 128, 255];
  const masks = opts.masks.filter((m) => TIER_B_MASK_KINDS.has(m.kind));
  for (const m of masks) {
    fillRect(pa, w, h, m.box, GREY);
    fillRect(pb, w, h, m.box, GREY);
  }
  const diff = Buffer.alloc(w * h * 4);
  const diffPixels = pixelmatch(pa, pb, diff, w, h, { threshold: 0.1 });
  const out = new PNG({ width: w, height: h });
  diff.copy(out.data);
  fs.writeFileSync(opts.diffPng, PNG.sync.write(out));
  writeSideBySide(opts.sideBySidePng, [pa, pb, diff], w, h);
  const totalPixels = w * h;
  const ratio = diffPixels / totalPixels;
  return { pass: ratio <= opts.budget, ratio, budget: opts.budget, diffPixels, totalPixels, width: w, height: h, sizeMismatch, masks: masks.length };
}
