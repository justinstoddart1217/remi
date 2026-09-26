/**
 * Roll tokeniser: Roll.dc.html `renderVals`, with the exact regexes and lookup tables.
 *
 * A value is split into columns ("parts"). Each column is a reel of candidate cells plus the
 * current one; the reel is translated so the current cell shows through a 1.25em window.
 *
 * Differences from the prototype, both from the architecture review:
 * - an unknown `cur` becomes a static column instead of silently showing reel index 0;
 * - each result carries its format family, so the component can key columns by
 *   `${family}:${position}` and remount cleanly when the family changes.
 */

/** Digits, with the blank cell at index 0 (above '0'), so a missing tens digit rolls away. */
export const DIG: readonly string[] = Object.freeze(['', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
export const WD: readonly string[] = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
export const MON: readonly string[] = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);
/** U+2212 MINUS SIGN: a typed '-' is normalised to it. */
export const MINUS = '−';
const SIGN: readonly string[] = Object.freeze(['', '+', MINUS]);
const DOT: readonly string[] = Object.freeze(['', '.']);

const DATE_RE =
  /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
const NUM_RE = /^([+−-]?)(\d{1,3})(?:\.(\d))?(\D*)$/;

/** 'dateW' = 'Wed 2 Dec' (6 columns), 'date' = '5 Oct' (4), 'num' = always 7, 'static' = 1. */
export type RollFamily = 'dateW' | 'date' | 'num' | 'static';

export interface RollPart {
  readonly cells: readonly string[];
  readonly cur: string;
  /** Index of `cur` in `cells`; the reel sits at translateY(-i * 1.25em). */
  readonly i: number;
}

export interface RollTokens {
  readonly text: string;
  readonly family: RollFamily;
  readonly parts: readonly RollPart[];
}

const stat = (s: string): RollPart => ({ cells: [s], cur: s, i: 0 });

function col(cells: readonly string[], cur: string): RollPart {
  const i = cells.indexOf(cur);
  return i < 0 ? stat(cur) : { cells, cur, i };
}

function compute(v: string): RollTokens {
  const dm = DATE_RE.exec(v);
  if (dm) {
    const [, wd, d = '', mon = ''] = dm;
    const parts: RollPart[] = [];
    if (wd) parts.push(col(WD, wd), stat(' '));
    parts.push(
      col(DIG, d.length === 2 ? d.charAt(0) : ''),
      col(DIG, d.charAt(d.length - 1)),
      stat(' '),
      col(MON, mon),
    );
    return { text: v, family: wd ? 'dateW' : 'date', parts };
  }
  const nm = NUM_RE.exec(v);
  if (nm) {
    const [, rawSign = '', digits = '', decimal, suffix] = nm;
    const sign = rawSign === '-' ? MINUS : rawSign;
    const int = digits.padStart(3, ' ');
    const parts: RollPart[] = [col(SIGN, sign)];
    for (const ch of int) parts.push(col(DIG, ch === ' ' ? '' : ch));
    parts.push(col(DOT, decimal ? '.' : ''), col(DIG, decimal ?? ''), stat(suffix ?? ''));
    return { text: v, family: 'num', parts };
  }
  return { text: v, family: 'static', parts: [stat(v)] };
}

const CACHE_LIMIT = 512;
const cache = new Map<string, RollTokens>();

/** Pure and memoised (results are shared and must not be mutated). */
export function tokenize(value: string): RollTokens {
  const hit = cache.get(value);
  if (hit) return hit;
  const out = compute(value);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(value, out);
  return out;
}
