// The live-chart check (part of Tier A, so a blank or wrong chart fails the state).
//
// Tier B cannot see a chart: a live chart is a thin curve, a few labels and gridlines on
// paper, about 1% of a 1920×1080 frame, and pixelmatch counts much of that as anti-aliasing.
// Blanking the full-screen chart moved Tier B by 0.2% against a 2% budget. Tier A reads
// innerText, which does not cross into iframes. So each chart is checked on its own:
//
//   1. Crop the chart iframe's box out of both screenshots (the region a reader sees there). The
//      prototype capture's box is used for both crops, so a chart that moved also fails.
//   2. Ink: a pixel is ink when any channel differs from the crop's background (its most common
//      colour) by more than INK_DELTA. Remi's ink must be real (at least MIN_INK of the box) and
//      comparable to the prototype's (INK_RATIO_MIN to INK_RATIO_MAX times it). A blank frame,
//      or one that shows only its axes, fails here.
//   3. Fingerprint: the crop is cut into a grid (GRID_COLS wide, rows in proportion) and each
//      cell holds its share of the ink. The cosine similarity of the two grids must be at least
//      MIN_SIMILARITY. A mirrored, flipped, shifted or different chart fails here, while font
//      hinting and anti-aliasing do not move it.
//
// Calibrated on the Rates primer chart (textbook-home, textbook-katex, textbook-chart-full):
// Remi against the prototype scores 0.92–0.96 even with the chart's live point in a different
// place, and the chart's animation clock is now pinned in both apps (drivers/common.ts
// pinChartClock), which removes that too. A blanked chart scores ink 0 and similarity 0; a
// mirrored, flipped, shifted or axes-only chart scores 0.67 or less. specs/parity.spec.ts runs
// these cases as self-tests on every `make parity`.

import fs from 'node:fs';

import { PNG } from 'pngjs';

import type { Box } from './drivers/common.ts';

export const INK_DELTA = 16;
export const MIN_INK = 0.001;
export const INK_RATIO_MIN = 0.5;
export const INK_RATIO_MAX = 2;
export const GRID_COLS = 32;
export const MIN_SIMILARITY = 0.9;

/** A visible iframe in a capture (the live charts). */
export interface FrameBox {
  title: string;
  box: Box;
}

export interface ChartResult {
  /** The frame's title (the chart's file name), with "#k" when several share it. */
  name: string;
  box: Box;
  /** Share of the box that is ink, prototype and Remi. */
  protoInk: number;
  remiInk: number;
  /** Cosine similarity of the ink grids (1 = the same picture). */
  similarity: number;
  pass: boolean;
  /** Why it failed ('' when it passed). */
  reason: string;
}

/** An RGBA crop. */
export interface Crop {
  data: Buffer;
  width: number;
  height: number;
}

/** The chart frames of a capture. Prototype baselines captured before 2026-09-25 list them as `iframe` masks. */
export function framesOf(capture: { frames?: FrameBox[]; masks?: { kind: string; label: string; box: Box }[] }): FrameBox[] {
  if (capture.frames) return capture.frames;
  return (capture.masks ?? []).filter((m) => m.kind === 'iframe').map((m) => ({ title: m.label, box: m.box }));
}

export function cropPng(png: PNG, box: Box): Crop {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const width = Math.max(0, Math.min(png.width - x0, Math.round(box.width)));
  const height = Math.max(0, Math.min(png.height - y0, Math.round(box.height)));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * png.width + x0) * 4;
    png.data.copy(data, y * width * 4, from, from + width * 4);
  }
  return { data, width, height };
}

/** The crop's most common colour: the paper behind the chart. */
export function background(c: Crop): [number, number, number] {
  const counts = new Map<number, number>();
  let best = 0;
  let key = 0;
  for (let i = 0; i < c.width * c.height; i++) {
    const k = (c.data[i * 4]! << 16) | (c.data[i * 4 + 1]! << 8) | c.data[i * 4 + 2]!;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > best) {
      best = n;
      key = k;
    }
  }
  return [key >> 16, (key >> 8) & 255, key & 255];
}

/** The ink mask (1 = differs from the background) and its share of the crop. */
export function inkOf(c: Crop): { mask: Uint8Array; share: number } {
  const bg = background(c);
  const mask = new Uint8Array(c.width * c.height);
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    const d = Math.max(Math.abs(c.data[i * 4]! - bg[0]), Math.abs(c.data[i * 4 + 1]! - bg[1]), Math.abs(c.data[i * 4 + 2]! - bg[2]));
    if (d > INK_DELTA) {
      mask[i] = 1;
      n++;
    }
  }
  return { mask, share: mask.length ? n / mask.length : 0 };
}

/** Ink per grid cell: GRID_COLS columns, rows in proportion to the crop (at least 8). */
export function fingerprint(mask: Uint8Array, width: number, height: number): Float64Array {
  const rows = Math.max(8, Math.round((GRID_COLS * height) / Math.max(1, width)));
  const cells = new Float64Array(GRID_COLS * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const cell = row * GRID_COLS + Math.min(GRID_COLS - 1, Math.floor((x * GRID_COLS) / width));
      cells[cell] = (cells[cell] ?? 0) + 1;
    }
  }
  return cells;
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** Scores one chart: Remi's crop against the prototype's crop of the same box. */
export function scoreChartCrops(name: string, box: Box, proto: Crop, remi: Crop): ChartResult {
  const p = inkOf(proto);
  const r = inkOf(remi);
  const similarity = proto.width === remi.width && proto.height === remi.height ? cosine(fingerprint(p.mask, proto.width, proto.height), fingerprint(r.mask, remi.width, remi.height)) : 0;
  const reasons: string[] = [];
  if (p.share < MIN_INK) reasons.push(`the prototype's chart has no ink here (${round(p.share * 100, 2)}%); re-capture the baseline`);
  if (r.share < MIN_INK) reasons.push(`Remi's chart is blank (ink ${round(r.share * 100, 3)}% of the box)`);
  else if (p.share >= MIN_INK && (r.share < p.share * INK_RATIO_MIN || r.share > p.share * INK_RATIO_MAX)) {
    reasons.push(`ink ${round(r.share * 100, 2)}% against the prototype's ${round(p.share * 100, 2)}% (allowed ${String(INK_RATIO_MIN)}–${String(INK_RATIO_MAX)}×)`);
  }
  if (similarity < MIN_SIMILARITY) reasons.push(`similarity ${round(similarity, 3)} < ${String(MIN_SIMILARITY)} (a different picture)`);
  return { name, box, protoInk: round(p.share), remiInk: round(r.share), similarity: round(similarity, 3), pass: reasons.length === 0, reason: reasons.join('; ') };
}

/**
 * Every chart the prototype capture shows must be in Remi's screenshot with real ink and the
 * same picture. Frames pair by title and position; a chart Remi does not have fails.
 */
export function scoreCharts(opts: { prototypePng: string; remiPng: string; protoFrames: FrameBox[]; remiFrames: FrameBox[] }): ChartResult[] {
  if (!opts.protoFrames.length) return [];
  const proto = PNG.sync.read(fs.readFileSync(opts.prototypePng));
  const remi = PNG.sync.read(fs.readFileSync(opts.remiPng));
  const left = [...opts.remiFrames];
  return opts.protoFrames.map((f, k) => {
    const same = opts.protoFrames.filter((g) => g.title === f.title).length > 1;
    const name = same ? `${f.title} #${String(opts.protoFrames.slice(0, k + 1).filter((g) => g.title === f.title).length)}` : f.title;
    const c = { x: f.box.x + f.box.width / 2, y: f.box.y + f.box.height / 2 };
    let best = -1;
    let bestD = Infinity;
    left.forEach((r, j) => {
      if (r.title !== f.title) return;
      const d = Math.hypot(r.box.x + r.box.width / 2 - c.x, r.box.y + r.box.height / 2 - c.y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    if (best < 0) return { name, box: f.box, protoInk: 0, remiInk: 0, similarity: 0, pass: false, reason: 'Remi shows no chart frame with this title' };
    left.splice(best, 1);
    return scoreChartCrops(name, f.box, cropPng(proto, f.box), cropPng(remi, f.box));
  });
}

// ------------------------------------------------------------------ self-test helpers
/** A copy of `c` filled with its background: what a chart that failed to draw looks like. */
export function blankCrop(c: Crop): Crop {
  const bg = background(c);
  const data = Buffer.alloc(c.data.length);
  for (let i = 0; i < c.width * c.height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  return { data, width: c.width, height: c.height };
}

/** A copy of `c` mirrored left to right: the same ink, a different chart. */
export function mirrorCrop(c: Crop): Crop {
  const data = Buffer.alloc(c.data.length);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) c.data.copy(data, (y * c.width + x) * 4, (y * c.width + (c.width - 1 - x)) * 4, (y * c.width + (c.width - x)) * 4);
  }
  return { data, width: c.width, height: c.height };
}

/** A copy of `c` with only its axes left (the plot area painted over): a chart whose curve did not draw. */
export function axesOnlyCrop(c: Crop): Crop {
  const bg = background(c);
  const data = Buffer.from(c.data);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if (x > c.width * 0.1 && y < c.height * 0.88) data.set([bg[0], bg[1], bg[2], 255], (y * c.width + x) * 4);
  }
  return { data, width: c.width, height: c.height };
}
