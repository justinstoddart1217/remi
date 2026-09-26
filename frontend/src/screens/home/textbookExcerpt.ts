/**
 * The Textbook card's excerpt (Remi Home.dc.html:100-129). The card shows the opening lines of
 * the user's first page (the first root page of the first section that has one), typeset the
 * way the page is: a crumb, numbered headings, muted paragraphs, a formula in the display face,
 * and the next heading's number, which the hover demo types into.
 *
 * - No pages: a designed empty page (`kind: 'empty'`), with the §5 copy "No pages yet.".
 * - The design's own sample page, still as the design wrote it: the design's hand-set excerpt
 *   (`kind: 'sample'`), which the card draws exactly as the prototype did.
 * - Anything else: the page's real blocks (`kind: 'page'`).
 *
 * Pure functions; no KaTeX on Home: a formula is shown as plain Unicode (`texPlain`), as the
 * prototype's card did ('ΔP / P ≈ −D × Δy').
 */

import type { PageOut, PageSummaryOut, TextbookBlock, TextbookTreeOut } from '../../api';

export type ExcerptLine =
  | { kind: 'h1' | 'h2' | 'h3'; num: string; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'formula'; text: string; runs: TexRun[] }
  | { kind: 'chart'; text: string };

export interface PageExcerpt {
  kind: 'page';
  section: string;
  title: string;
  lines: ExcerptLine[];
  /** The row the hover demo types into: the next heading's number and text ('' when none). */
  next: { num: string; text: string };
}

export type Excerpt = { kind: 'sample' } | { kind: 'empty' } | PageExcerpt;

/** Lines shown before the typing row (the design shows five: h1, h2, text, formula, text). */
export const MAX_LINES = 5;
/** The longest heading the hover demo types. */
export const MAX_TYPED = 32;

const UNTITLED = 'Untitled';
const UNTITLED_SECTION = 'Untitled section';

/** The first page in sidebar order: the first root page of the first section that has one. */
export function firstPage(tree: TextbookTreeOut | undefined): PageSummaryOut | null {
  if (!tree) return null;
  const ids = new Set(tree.pages.map((p) => p.id));
  for (const section of tree.sections) {
    const page = tree.pages.find((p) => p.sectionId === section.id && (!p.parentId || !ids.has(p.parentId)));
    if (page) return page;
  }
  return null;
}

/**
 * The blocks of the design's sample page that its excerpt reads, as the design seed writes them
 * (parity/golden/prototype_seed.json, page `fi-rates`): the first `MAX_LINES` lines and the next
 * heading. The chart and callout between them never reach the card.
 */
const DESIGN_OPENING: TextbookBlock[] = [
  { id: 'b01', type: 'h1', text: 'Rates and duration' },
  { id: 'b02', type: 'h2', text: 'Price and yield' },
  {
    id: 'b03',
    type: 'p',
    text: 'A bond’s price is the present value of its cash flows. When yields rise, those cash flows are discounted more heavily, so the price falls. The relationship is curved, not straight.',
  },
  { id: 'b04', type: 'formula', tex: '\\frac{\\Delta P}{P} \\approx -D \\times \\Delta y' },
  { id: 'b05', type: 'p', text: 'where D is modified duration and Δy is the change in yield, in decimal.' },
  { id: 'b08', type: 'h2', text: 'Convexity' },
];
const DESIGN_SECTION = 'Fixed Income';
const DESIGN_TITLE = 'Rates primer';

let designKey: string | null = null;
const excerptKey = (ex: PageExcerpt) => JSON.stringify([ex.section, ex.title, ex.lines, ex.next]);

/**
 * The design's sample page ("Rates primer" in "Fixed Income", Remi Home.dc.html:100-129),
 * recognised by its seeded id and by an excerpt identical to the seeded page's: every line the
 * card would show, the next heading, the title and the section. The card then draws the design's
 * hand-set excerpt of it; once anything the card shows is edited, it follows the real blocks.
 */
export function isDesignSample(page: Pick<PageOut, 'id' | 'title' | 'blocks'>, sectionLabel: string): boolean {
  if (page.id !== 'fi-rates') return false;
  designKey ??= excerptKey(pageExcerpt({ title: DESIGN_TITLE, blocks: DESIGN_OPENING }, DESIGN_SECTION));
  return excerptKey(pageExcerpt(page, sectionLabel)) === designKey;
}

// ------------------------------------------------------------------ TeX as plain text

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  approx: '≈', times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  neq: '≠', ne: '≠', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', sum: 'Σ', prod: 'Π',
  int: '∫', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', in: '∈', ldots: '…', cdots: '⋯',
  ell: 'ℓ', forall: '∀', exists: '∃', cap: '∩', cup: '∪', subset: '⊂', subseteq: '⊆', ll: '≪', gg: '≫',
  perp: '⊥', circ: '∘', ast: '∗', star: '⋆', bullet: '•', mid: '|', vert: '|', lvert: '|', rvert: '|',
  Vert: '‖', lVert: '‖', rVert: '‖', langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', lfloor: '⌊',
  rfloor: '⌋', lceil: '⌈', rceil: '⌉', gets: '←', mapsto: '↦', leftrightarrow: '↔', Leftrightarrow: '⇔',
  Leftarrow: '⇐', uparrow: '↑', downarrow: '↓', prime: '′', degree: '°',
  // Letters and variants.
  hbar: 'ℏ', hslash: 'ℏ', varsigma: 'ς', vartheta: 'ϑ', varpi: 'ϖ', varrho: 'ϱ', varkappa: 'ϰ', digamma: 'ϝ',
  Upsilon: 'Υ', aleph: 'ℵ', beth: 'ℶ', Re: 'ℜ', Im: 'ℑ', wp: '℘', imath: 'ı', jmath: 'ȷ',
  // Binary operators.
  dagger: '†', dag: '†', ddagger: '‡', ddag: '‡', oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
  setminus: '∖', smallsetminus: '∖', wedge: '∧', land: '∧', vee: '∨', lor: '∨', neg: '¬', lnot: '¬',
  sqcup: '⊔', sqcap: '⊓', uplus: '⊎', amalg: '⨿', wr: '≀', diamond: '⋄', triangle: '△', square: '□', Box: '□',
  // Relations and arrows.
  notin: '∉', ni: '∋', owns: '∋', supset: '⊃', supseteq: '⊇', subsetneq: '⊊', supsetneq: '⊋', sqsubseteq: '⊑',
  cong: '≅', simeq: '≃', approxeq: '≊', asymp: '≍', doteq: '≐', triangleq: '≜', lt: '<', gt: '>',
  leqslant: '⩽', geqslant: '⩾', lesssim: '≲', gtrsim: '≳', nless: '≮', ngtr: '≯', nleq: '≰', ngeq: '≱',
  prec: '≺', succ: '≻', preceq: '⪯', succeq: '⪰', parallel: '∥', nparallel: '∦', models: '⊨', vdash: '⊢', dashv: '⊣',
  implies: '⟹', impliedby: '⟸', iff: '⟺', longrightarrow: '⟶', longleftarrow: '⟵', longleftrightarrow: '⟷',
  Longrightarrow: '⟹', Longleftarrow: '⟸', Longleftrightarrow: '⟺', longmapsto: '⟼', hookrightarrow: '↪',
  hookleftarrow: '↩', rightleftharpoons: '⇌', nearrow: '↗', searrow: '↘', nwarrow: '↖', swarrow: '↙',
  updownarrow: '↕', Uparrow: '⇑', Downarrow: '⇓', therefore: '∴', because: '∵', colon: ': ',
  // Big operators and misc.
  oint: '∮', iint: '∬', iiint: '∭', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂', bigvee: '⋁',
  bigwedge: '⋀', coprod: '∐', emptyset: '∅', varnothing: '∅', top: '⊤', bot: '⊥', angle: '∠', surd: '√',
  dots: '…', dotsc: '…', dotsb: '⋯', dotsm: '⋯', dotso: '…', vdots: '⋮', ddots: '⋱', checkmark: '✓',
  S: '§', P: '¶', pounds: '£', clubsuit: '♣', heartsuit: '♡', spadesuit: '♠', diamondsuit: '♢',
  flat: '♭', sharp: '♯', natural: '♮', mho: '℧', complement: '∁', Finv: 'Ⅎ', eth: 'ð',
  ln: 'ln', log: 'log', exp: 'exp', max: 'max', min: 'min', sin: 'sin', cos: 'cos', tan: 'tan',
  lim: 'lim', sup: 'sup', inf: 'inf', det: 'det', arg: 'arg', Pr: 'Pr', Var: 'Var', Cov: 'Cov',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin', arccos: 'arccos',
  arctan: 'arctan', lg: 'lg', gcd: 'gcd', deg: 'deg', dim: 'dim', ker: 'ker', hom: 'hom', liminf: 'lim inf',
  limsup: 'lim sup', mod: 'mod', bmod: 'mod',
};
/** Relations and operators the one-line preview spaces out ('a ⊕ b', 'x ∈ A'), as KaTeX does. */
const SPACED = '≈×=±∓≤≥≠→←⇒⇐⇔↔⟶⟵⟷⟹⟸⟺↦⟼∈∉∋≡≅≃≊∼∝⊂⊆⊃⊇⊊⊋≪≫<>⩽⩾≲≳≺≻⪯⪰∥⊨⊢+·÷⊕⊖⊗⊘⊙∪∩∧∨∖⊔⊓';
const SPACED_RE = new RegExp(`\\s*([${SPACED}]\\p{M}*)\\s*`, 'gu');
const SPACES: Record<string, string> = { ',': ' ', ':': ' ', ';': ' ', '!': '', ' ': ' ', '\\': ' ', quad: ' ', qquad: ' ' };
/** Escaped characters that print as themselves (`\%`, `\{`), or as a symbol (`\|`). */
const ESCAPES: Record<string, string> = { '|': '‖' };
/** Commands that print nothing and take no argument; `\left.` and `\right.` drop their dot too. */
const DROP = new Set(['left', 'right', 'middle', 'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'nonumber', 'notag']);
/** Commands whose one argument prints nothing either (`\begin{aligned}`, `\color{red}`). */
const DROP_ARG = new Set(['begin', 'end', 'label', 'tag', 'hspace', 'vspace', 'phantom', 'hphantom', 'vphantom', 'color']);
/** Font commands: the argument prints in the plain face. */
const FONTS = new Set([
  'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'mathbb', 'mathcal', 'mathfrak', 'mathscr', 'boldsymbol', 'bm',
  'text', 'textrm', 'textit', 'textbf', 'textsf', 'texttt', 'operatorname', 'mathop', 'mbox',
]);
/**
 * Accents: the argument, with a combining mark when it is one character. A longer argument keeps
 * its mark only for the bars, which join up across characters; the others print it plain.
 */
const ACCENTS: Record<string, { mark: string; long?: string }> = {
  bar: { mark: '\u0304', long: '\u0305' },
  overline: { mark: '\u0305', long: '\u0305' },
  underline: { mark: '\u0332', long: '\u0332' },
  hat: { mark: '\u0302' },
  widehat: { mark: '\u0302' },
  tilde: { mark: '\u0303' },
  widetilde: { mark: '\u0303' },
  vec: { mark: '\u20D7' },
  dot: { mark: '\u0307' },
  ddot: { mark: '\u0308' },
};
/** `\sqrt[n]{…}`: the root sign for index n (2 and none are the square root). */
const ROOTS: Record<string, string> = { '': '√', '2': '√', '3': '∛', '4': '∜' };
/**
 * Script characters with a Unicode form. rawRuns writes every '-' as '−' (U+2212) before a
 * script is read, so the minus key is '−'; the ASCII key only serves an escaped `\-`.
 */
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '−': '⁻', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '−': '₋', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

/** Read one group after position i: `{…}` (balanced) or a single token. */
function group(tex: string, i: number): [string, number] {
  let k = i;
  while (tex[k] === ' ') k++;
  if (tex[k] === '{') {
    let depth = 0;
    for (let j = k; j < tex.length; j++) {
      if (tex[j] === '{') depth++;
      else if (tex[j] === '}' && --depth === 0) return [tex.slice(k + 1, j), j + 1];
    }
    return [tex.slice(k + 1), tex.length];
  }
  if (tex[k] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(k));
    const token = m?.[0] ?? '\\';
    return [token, k + token.length];
  }
  return [tex[k] ?? '', k + 1];
}

/** A stretch of a formula: plain text, or a raised or lowered script. */
export interface TexRun {
  t: string;
  script?: 'sub' | 'sup';
}

/** Read an optional `[…]` argument after position i: its text, or null (and i) when there is none. */
function optional(tex: string, i: number): [string | null, number] {
  let k = i;
  while (tex[k] === ' ') k++;
  if (tex[k] !== '[') return [null, i];
  const end = tex.indexOf(']', k);
  return end < 0 ? [null, i] : [tex.slice(k + 1, end), end + 1];
}

const flat = (runs: TexRun[]) =>
  runs
    .map((r) => r.t)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const isMark = (c: string) => /\p{M}/u.test(c);

/** An accent over its argument's runs (see `ACCENTS`). */
function accented(inner: TexRun[], accent: { mark: string; long?: string }): TexRun[] {
  const bases = Array.from(flat(inner.filter((r) => !r.script)).replace(/\s/g, '')).filter((c) => !isMark(c));
  if (bases.length === 1) return inner.map((r) => (r.script || !r.t.trim() ? r : { t: r.t.trim() + accent.mark }));
  const { long } = accent;
  if (!long) return inner;
  return inner.map((r) =>
    r.script
      ? r
      : {
          t: Array.from(r.t)
            .map((c) => (/\s/.test(c) || isMark(c) ? c : c + long))
            .join(''),
        },
  );
}

/** The runs before spacing is tidied (see `texRuns`). */
function rawRuns(tex: string): TexRun[] {
  const out: TexRun[] = [];
  const push = (t: string) => {
    out.push({ t });
  };
  let i = 0;
  while (i < tex.length) {
    const c = tex[i] ?? '';
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      const name = m?.[1] ?? '';
      i += (m?.[0] ?? '\\').length;
      const word = /^[A-Za-z]+$/.test(name);
      if (word) while (tex[i] === ' ') i++;
      if (name === 'frac' || name === 'tfrac' || name === 'dfrac') {
        const [num, a] = group(tex, i);
        const [den, b] = group(tex, a);
        i = b;
        out.push(...rawRuns(num), { t: ' / ' }, ...rawRuns(den));
      } else if (name === 'binom' || name === 'tbinom' || name === 'dbinom') {
        const [n, a] = group(tex, i);
        const [k, b] = group(tex, a);
        i = b;
        out.push({ t: 'C(' }, ...rawRuns(n), { t: ', ' }, ...rawRuns(k), { t: ')' });
      } else if (name === 'not') {
        // `\not\in`, `\not=`: the next symbol, struck through.
        const [next, a] = group(tex, i);
        i = a;
        const t = flat(rawRuns(next));
        if (t) push(`${t}\u0338`.normalize('NFC'));
      } else if (name === 'sqrt') {
        const [index, a] = optional(tex, i);
        const [arg, b] = group(tex, a);
        i = b;
        const inner = rawRuns(arg);
        const long = flat(inner).length > 1;
        const n = flat(rawRuns(index ?? ''));
        const sign = ROOTS[n];
        if (sign === undefined) out.push({ t: n, script: 'sup' });
        push(sign ?? '√');
        if (long) push('(');
        out.push(...inner);
        if (long) push(')');
      } else if (Object.hasOwn(ACCENTS, name)) {
        const [arg, a] = group(tex, i);
        i = a;
        const accent = ACCENTS[name];
        if (accent) out.push(...accented(rawRuns(arg), accent));
      } else if (FONTS.has(name)) {
        if (tex[i] === '*') i++;
        const [arg, a] = group(tex, i);
        i = a;
        out.push(...rawRuns(arg));
      } else if (DROP_ARG.has(name)) {
        i = group(tex, i)[1];
      } else if (DROP.has(name)) {
        if ((name === 'left' || name === 'right' || name === 'middle') && tex[i] === '.') i++;
      } else if (Object.hasOwn(SYMBOLS, name)) {
        push(SYMBOLS[name] ?? '');
      } else if (Object.hasOwn(SPACES, name)) {
        push(SPACES[name] ?? '');
      } else if (!word && name) {
        push(ESCAPES[name] ?? name);
      }
      // Any other command prints nothing; a braced argument after it prints as written.
    } else if (c === '&') {
      i++;
    } else if (c === '^' || c === '_') {
      const [arg, a] = group(tex, i + 1);
      i = a;
      const t = flat(rawRuns(arg));
      if (t) out.push({ t, script: c === '^' ? 'sup' : 'sub' });
    } else if (c === '{' || c === '}') {
      i++;
    } else {
      push(c === '-' ? '−' : c === '~' ? ' ' : c);
      i++;
    }
  }
  return out;
}

/**
 * TeX as runs of plain Unicode for a one-line preview, with scripts kept apart so the card can
 * raise or lower them: Greek and operators as symbols, `\frac{a}{b}` as 'a / b', a minus as
 * '−', spacing around relations and '+', and layout commands dropped.
 */
export function texRuns(tex: string): TexRun[] {
  const merged: TexRun[] = [];
  for (const r of rawRuns(tex)) {
    const last = merged[merged.length - 1];
    if (last && last.script === r.script) last.t += r.t;
    else merged.push({ ...r });
  }
  const tidy = merged
    .map((r) =>
      r.script ? r : { t: r.t.replace(/\s+/g, ' ').replace(SPACED_RE, ' $1 ').replace(/\s+/g, ' ') },
    )
    .filter((r) => r.t !== '');
  const first = tidy[0];
  if (first && !first.script) first.t = first.t.trimStart();
  const last = tidy[tidy.length - 1];
  if (last && !last.script) last.t = last.t.trimEnd();
  return tidy.filter((r) => r.t !== '');
}

function scriptText(text: string, map: Record<string, string>, mark: string): string {
  const chars = Array.from(text);
  const all = chars.length > 0 && chars.every((c) => Object.hasOwn(map, c));
  return all ? chars.map((c) => map[c] ?? c).join('') : `${mark}${chars.length > 1 ? `(${text})` : text}`;
}

/** The runs as one string: digits in scripts as Unicode, other scripts as `_x` or `^(ab)`. */
export function texPlain(tex: string): string {
  return texRuns(tex)
    .map((r) => (r.script === 'sub' ? scriptText(r.t, SUB, '_') : r.script === 'sup' ? scriptText(r.t, SUP, '^') : r.t))
    .join('');
}

// ------------------------------------------------------------------ the page's lines

type Heading = Extract<TextbookBlock, { type: 'h1' | 'h2' | 'h3' }>;

const isHeading = (b: TextbookBlock): b is Heading => b.type === 'h1' || b.type === 'h2' || b.type === 'h3';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Heading numbers in one pass ('1', '1.1', '1.1.1'), as the Textbook numbers them. */
function numberer() {
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  return {
    take(level: 'h1' | 'h2' | 'h3'): string {
      if (level === 'h1') {
        c1++;
        c2 = 0;
        c3 = 0;
        return String(c1);
      }
      if (level === 'h2') {
        c2++;
        c3 = 0;
        return `${String(c1)}.${String(c2)}`;
      }
      c3++;
      return `${String(c1)}.${String(c2)}.${String(c3)}`;
    },
    /** The number a new heading at the deepest open level would take. */
    peek(): string {
      if (c1 === 0) return '1';
      if (c3 > 0) return `${String(c1)}.${String(c2)}.${String(c3 + 1)}`;
      return `${String(c1)}.${String(c2 + 1)}`;
    },
  };
}

function lineOf(b: TextbookBlock): Exclude<ExcerptLine, { kind: 'h1' | 'h2' | 'h3' }> | null {
  switch (b.type) {
    case 'p':
    case 'callout':
      return b.text.trim() ? { kind: 'para', text: b.text.trim() } : null;
    case 'bullet':
      return b.text.trim() ? { kind: 'para', text: `• ${b.text.trim()}` } : null;
    case 'formula': {
      const text = texPlain(b.tex);
      return text ? { kind: 'formula', text, runs: texRuns(b.tex) } : null;
    }
    case 'chart':
      return b.assetId ? { kind: 'chart', text: `Live chart${b.name ? ` · ${b.name}` : ''}` } : null;
    default:
      return null;
  }
}

/** The opening of a real page: up to `MAX_LINES` lines, then the next heading to type. */
export function pageExcerpt(page: Pick<PageOut, 'title' | 'blocks'>, sectionLabel: string): PageExcerpt {
  const n = numberer();
  const lines: ExcerptLine[] = [];
  let next: PageExcerpt['next'] | null = null;
  for (const b of page.blocks) {
    if (isHeading(b)) {
      const num = n.take(b.type);
      const text = b.text.trim() || UNTITLED;
      if (lines.length >= MAX_LINES) {
        next = { num, text: clip(text, MAX_TYPED) };
        break;
      }
      lines.push({ kind: b.type, num, text });
      continue;
    }
    if (lines.length >= MAX_LINES) continue;
    const line = lineOf(b);
    if (line) lines.push(line);
  }
  return {
    kind: 'page',
    section: sectionLabel.trim() || UNTITLED_SECTION,
    title: page.title.trim() || UNTITLED,
    lines,
    next: next ?? { num: n.peek(), text: '' },
  };
}

/**
 * Which excerpt the card shows. `pages` is the Home count (undefined while it loads); the tree
 * and the page arrive after it. Returns null while there is nothing certain to draw.
 */
export function excerptFor(
  pages: number | undefined,
  tree: TextbookTreeOut | undefined,
  page: PageOut | undefined,
): Excerpt | null {
  if (pages === undefined) return null;
  if (pages === 0) return { kind: 'empty' };
  const first = firstPage(tree);
  if (!tree) return null;
  if (!first) return { kind: 'empty' };
  if (page?.id !== first.id) return null;
  const section = tree.sections.find((x) => x.id === page.sectionId)?.label ?? '';
  if (isDesignSample(page, section)) return { kind: 'sample' };
  return pageExcerpt(page, section);
}

/** Hover typing: the steps and the slash menu's left edge follow the typed text. */
export function typedWidthPx(text: string): number {
  // Albert Sans 600 at 16px averages about 9.2px a character; 150px is where the design's menu
  // sits after 'Convexity' (44px number column + 9 characters + 22px).
  return Math.round(Array.from(text).length * 9.2);
}
