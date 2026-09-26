/**
 * The rotation editor's draft list (setup step 3 and Settings): ordered countries with a
 * two-letter code, a length in business days and a Build/Refresh pass. The server lays the
 * segments out on the business calendar; the client only keeps the list and checks that each
 * entry is one the API accepts (`RotationSegmentIn`).
 */

import type { RotationSegmentOut, Schemas } from '../../../api';
import { count } from '../../../lib/format';
import { codeForCountry, countryForCode, isCurrentCountryCode } from '../countries';

export type RotationPass = 'Build' | 'Refresh';

export interface SegmentDraft {
  /** Stable React key (the server id when there is one). */
  key: string;
  /** The server id, kept so a full replace keeps the segment. */
  id: string | null;
  country: string;
  code: string;
  lengthBd: number;
  pass: RotationPass;
}

/** `RotationSegmentIn` limits. */
export const MAX_SEGMENTS = 60;
export const MAX_LENGTH_BD = 130;
export const DEFAULT_LENGTH_BD = 5;
const CODE_PATTERN = /^[A-Z]{2}$/;

let nextKey = 0;
function newKey(): string {
  nextKey += 1;
  return `new-${String(nextKey)}`;
}

export function blankSegment(pass: RotationPass = 'Build'): SegmentDraft {
  return { key: newKey(), id: null, country: '', code: '', lengthBd: DEFAULT_LENGTH_BD, pass };
}

export function fromServer(segments: readonly RotationSegmentOut[]): SegmentDraft[] {
  return [...segments]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ key: s.id, id: s.id, country: s.country, code: s.code, lengthBd: s.lengthBd, pass: s.pass }));
}

/** Upper-case letters only, at most two: ' de ' → 'DE', 'd3' → 'D'. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
}

/** What is missing from an entry, or null when the API would accept it. */
export function segmentIssue(seg: SegmentDraft): string | null {
  const country = seg.country.trim();
  const codeOk = CODE_PATTERN.test(seg.code);
  if (!country && !codeOk) return 'Needs a country and its two-letter code';
  if (!country) return 'Needs a country name';
  if (!codeOk) return 'Needs a two-letter code';
  if (country.length > 60) return 'Country names stop at 60 characters';
  if (!Number.isInteger(seg.lengthBd) || seg.lengthBd < 1 || seg.lengthBd > MAX_LENGTH_BD) {
    return `Length is 1 to ${String(MAX_LENGTH_BD)} business days`;
  }
  return null;
}

export function segmentsValid(segments: readonly SegmentDraft[]): boolean {
  return segments.length <= MAX_SEGMENTS && segments.every((s) => segmentIssue(s) === null);
}

/** The request body (`RotationSegmentIn[]`), in order. */
export function segmentsIn(segments: readonly SegmentDraft[]): Schemas['RotationSegmentIn'][] {
  return segments.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    country: s.country.trim(),
    code: s.code,
    lengthBd: s.lengthBd,
    pass: s.pass,
  }));
}

/** True when the draft differs from what the server holds (order, fields, additions, removals). */
export function segmentsDirty(draft: readonly SegmentDraft[], saved: readonly SegmentDraft[]): boolean {
  if (draft.length !== saved.length) return true;
  return draft.some((d, i) => {
    const s = saved[i];
    if (!s) return true;
    return (
      d.id !== s.id ||
      d.country.trim() !== s.country ||
      d.code !== s.code ||
      d.lengthBd !== s.lengthBd ||
      d.pass !== s.pass
    );
  });
}

/** Moves the entry at `from` to `to` (clamped). Returns the same list when nothing moves. */
export function moveSegment<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || target === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(target, 0, item);
  return next;
}

/**
 * Applies an edit to one entry. Typing a code fills an empty country ('DE' → 'Germany') and
 * typing a known country fills an empty code ('France' → 'FR', or 'fr' → France, FR), so a
 * stop takes one field.
 */
export function editSegment(seg: SegmentDraft, patch: Partial<Omit<SegmentDraft, 'key' | 'id'>>): SegmentDraft {
  const next: SegmentDraft = { ...seg, ...patch };
  if (patch.code !== undefined) {
    next.code = normaliseCode(patch.code);
    if (!next.country.trim() && next.code.length === 2) next.country = countryForCode(next.code) ?? '';
  }
  if (patch.country !== undefined) {
    next.country = patch.country.trim();
    if (!next.code && next.country) {
      // A code typed where the name goes ('fr', 'uk') fills both.
      const typedCode = /^[a-z]{2}$/i.test(next.country) ? next.country.toUpperCase() : null;
      const code =
        codeForCountry(next.country) ?? (typedCode && isCurrentCountryCode(typedCode) ? typedCode : null);
      if (code) {
        next.code = code;
        if (typedCode) next.country = countryForCode(code) ?? next.country;
      }
    }
  }
  if (patch.lengthBd !== undefined) {
    next.lengthBd = Math.max(1, Math.min(MAX_LENGTH_BD, Math.round(patch.lengthBd)));
  }
  return next;
}

/** The loop and refresh sums, as the editor states them (the server lays out the dates). */
export function rotationTotals(segments: readonly SegmentDraft[]): { build: number; refresh: number; total: number } {
  let build = 0;
  let refresh = 0;
  for (const s of segments) {
    if (s.pass === 'Build') build += s.lengthBd;
    else refresh += s.lengthBd;
  }
  return { build, refresh, total: build + refresh };
}

/**
 * The editor's totals line: the sums over complete stops only (an unfinished stop is never
 * saved, so it is not counted), and how many stops are unfinished.
 */
export function countedTotals(segments: readonly SegmentDraft[]): { build: number; refresh: number; unfinished: number } {
  const complete = segments.filter((s) => segmentIssue(s) === null);
  const { build, refresh } = rotationTotals(complete);
  return { build, refresh, unfinished: segments.length - complete.length };
}

/**
 * '3 countries · 49 BD' (distinct codes), over complete stops only, like the editor's totals
 * line: an unfinished stop is never saved, so it is named, not counted ('3 countries · 49 BD ·
 * 1 unfinished stop', or '1 unfinished stop' when no stop is complete yet).
 */
export function rotationSummary(segments: readonly SegmentDraft[]): string {
  const complete = segments.filter((s) => segmentIssue(s) === null);
  const unfinished = segments.length - complete.length;
  const parts: string[] = [];
  if (complete.length > 0) {
    const codes = new Set(complete.map((s) => s.code));
    parts.push(count(codes.size, 'country', 'countries'), `${String(rotationTotals(complete).total)} BD`);
  }
  if (unfinished > 0) parts.push(count(unfinished, 'unfinished stop', 'unfinished stops'));
  return parts.join(' · ');
}

/** Two-digit position: 0 → '01'. */
export function position(index: number): string {
  return String(index + 1).padStart(2, '0');
}
