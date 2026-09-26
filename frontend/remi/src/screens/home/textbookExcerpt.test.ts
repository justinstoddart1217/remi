import { describe, expect, it } from 'vitest';

import type { PageOut, PageSummaryOut, TextbookBlock, TextbookTreeOut } from '../../api';
import { excerptFor, firstPage, isDesignSample, MAX_LINES, pageExcerpt, texPlain, texRuns } from './textbookExcerpt';

const summary = (id: string, sectionId: string, parentId: string | null = null): PageSummaryOut => ({
  id,
  sectionId,
  parentId,
  title: id,
  sortOrder: 0,
  chartCount: 0,
  childCount: 0,
  descendantCount: 0,
  wordCount: 0,
  version: 1,
  updatedAt: '',
});

const tree = (pages: PageSummaryOut[]): TextbookTreeOut =>
  ({
    sections: [
      { id: 'fi', label: 'Fixed Income', accent: '', collapsed: false, pageCount: 0 },
      { id: 'pc', label: 'Private Credit', accent: '', collapsed: false, pageCount: 0 },
    ],
    pages,
  }) as TextbookTreeOut;

const page = (id: string, title: string, blocks: TextbookBlock[], sectionId = 'fi'): PageOut => ({
  id,
  title,
  blocks,
  sectionId,
  parentId: null,
  sortOrder: 0,
  version: 1,
  createdAt: '',
  updatedAt: '',
});

/** The design seed's `fi-rates` page (parity/golden/prototype_seed.json), up to its second h2 and one block on. */
const SAMPLE_BLOCKS: TextbookBlock[] = [
  { id: 'b1', type: 'h1', text: 'Rates and duration' },
  { id: 'b2', type: 'h2', text: 'Price and yield' },
  {
    id: 'b3',
    type: 'p',
    text: 'A bond’s price is the present value of its cash flows. When yields rise, those cash flows are discounted more heavily, so the price falls. The relationship is curved, not straight.',
  },
  { id: 'b4', type: 'formula', tex: '\\frac{\\Delta P}{P} \\approx -D \\times \\Delta y' },
  { id: 'b5', type: 'p', text: 'where D is modified duration and Δy is the change in yield, in decimal.' },
  { id: 'b6', type: 'chart', assetId: 'c', name: 'price-yield.html', height: 380, caption: 'The marker drifts.' },
  { id: 'b7', type: 'callout', text: 'Duration is a first-order estimate.' },
  { id: 'b8', type: 'h2', text: 'Convexity' },
  { id: 'b9', type: 'p', text: 'Convexity measures how much the slope itself changes as yields move.' },
];

/** The sample page with block `id` replaced (or removed, with no `block`). */
const edit = (id: string, block?: TextbookBlock): TextbookBlock[] =>
  SAMPLE_BLOCKS.flatMap((b) => (b.id !== id ? [b] : block ? [block] : []));

describe('texPlain', () => {
  it('writes the design card’s formula from its TeX', () => {
    expect(texPlain('\\frac{\\Delta P}{P} \\approx -D \\times \\Delta y')).toBe('ΔP / P ≈ −D × Δy');
  });

  it('raises digits, keeps other scripts readable and drops spacing commands', () => {
    expect(texPlain('\\frac{\\Delta P}{P} \\approx -D\\,\\Delta y + \\tfrac{1}{2}\\,C\\,(\\Delta y)^2')).toBe(
      'ΔP / P ≈ −D Δy + 1 / 2 C (Δy)²',
    );
    expect(texPlain('x_{i} + y^{ab}')).toBe('x_i + y^(ab)');
    expect(texPlain('R = \\frac{V_1 - V_0 - F}{V_0 + \\sum_i w_i F_i}')).toBe('R = V₁ − V₀ − F / V₀ + Σ_i w_i F_i');
    expect(texPlain('\\sqrt{2}\\left( a \\right)')).toBe('√2( a )');
    expect(texPlain('')).toBe('');
    expect(texPlain('a \\\\ b')).toBe('a b');
  });

  it('keeps scripts apart for the card to raise or lower', () => {
    expect(texRuns('s_{OAS} = y - r_f')).toEqual([
      { t: 's' },
      { t: 'OAS', script: 'sub' },
      { t: ' = y − r' },
      { t: 'f', script: 'sub' },
    ]);
    expect(texRuns('(\\Delta y)^2')).toEqual([{ t: '(Δy)' }, { t: '2', script: 'sup' }]);
  });

  it('prints a font command’s argument alone, never the command’s name', () => {
    expect(texPlain('\\mathbb{E}[X_t]')).toBe('E[X_t]');
    expect(texPlain('\\mathcal{L}')).toBe('L');
    expect(texPlain('\\mathfrak{g} + \\mathsf{T} + \\boldsymbol{\\beta} + \\bm{x}')).toBe('g + T + β + x');
    expect(texPlain('\\mathrm{d}x + \\text{if } y')).toBe('dx + if y');
    expect(texPlain('\\operatorname*{arg\\,max}_x f')).toBe('arg max_x f');
  });

  it('puts an accent’s combining mark on a one-character argument', () => {
    expect(texPlain('\\bar{s}')).toBe('s\u0304');
    expect(texPlain('\\hat{\\beta}')).toBe('β\u0302');
    expect(texPlain('\\hat\\beta_1')).toBe('β\u0302₁');
    expect(texPlain('\\tilde{x} \\vec{v} \\dot{q} \\ddot{q}')).toBe('x\u0303 v\u20D7 q\u0307 q\u0308');
    expect(texPlain('\\overline{x}')).toBe('x\u0305');
    expect(texPlain('\\underline{u}')).toBe('u\u0332');
    expect(texPlain('\\widehat{A} \\widetilde{B}')).toBe('A\u0302 B\u0303');
    expect(texPlain('\\bar{x_i}')).toBe('x\u0304_i');
  });

  it('bars a longer argument across its characters and prints other accents plain', () => {
    expect(texPlain('\\overline{xy}')).toBe('x\u0305y\u0305');
    expect(texPlain('\\bar{AB}')).toBe('A\u0305B\u0305');
    expect(texPlain('\\hat{ab} + \\widetilde{XY}')).toBe('ab + XY');
  });

  it('reads a root’s index as a root sign, never as text', () => {
    expect(texPlain('\\sqrt[3]{x}')).toBe('∛x');
    expect(texPlain('\\sqrt[4]{x}')).toBe('∜x');
    expect(texPlain('\\sqrt[2]{x}')).toBe('√x');
    expect(texPlain('\\sqrt[n]{x}')).toBe('ⁿ√x');
    expect(texRuns('\\sqrt[k]{ab}')).toEqual([{ t: 'k', script: 'sup' }, { t: '√(ab)' }]);
  });

  it('drops unknown commands and layout, keeping escaped characters', () => {
    expect(texPlain('\\foo x + \\cancel{y}')).toBe('x + y');
    expect(texPlain('5\\% + \\{a\\} + \\|v\\|')).toBe('5% + {a} + ‖v‖');
    expect(texPlain('\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}')).toBe('a = b c = d');
    expect(texPlain('\\left. x \\right|_0 \\color{red} z')).toBe('x |₀ z');
  });

  it('knows the common symbols, so a known command never vanishes and changes the formula', () => {
    expect(texPlain('i\\hbar \\frac{\\partial}{\\partial t}\\psi = H\\psi')).toBe('iℏ∂ / ∂tψ = Hψ');
    expect(texPlain('E = \\hbar \\omega')).toBe('E = ℏω');
    expect(texPlain('A^\\dagger A = I')).toBe('A^† A = I');
    expect(texPlain('H = \\hbar \\omega (a^\\dagger a + \\frac{1}{2})')).toBe('H = ℏω(a^† a + 1 / 2)');
    expect(texPlain('a \\oplus b \\otimes c')).toBe('a ⊕ b ⊗ c');
    expect(texPlain('x \\notin A \\setminus B')).toBe('x ∉ A ∖ B');
    expect(texPlain('p \\implies q \\iff r')).toBe('p ⟹ q ⟺ r');
    expect(texPlain('\\therefore \\neg p \\wedge q \\vee r')).toBe('∴¬p ∧ q ∨ r');
    expect(texPlain('\\emptyset')).toBe('∅');
    expect(texPlain('f\\colon X \\to Y')).toBe('f: X → Y');
    expect(texPlain('x \\leftarrow y')).toBe('x ← y');
    expect(texPlain('a \\cdot b')).toBe('a · b');
    expect(texPlain('\\binom{n}{k}')).toBe('C(n, k)');
    expect(texPlain('x \\not= y \\not\\in B')).toBe('x \u2260 y \u2209 B');
    expect(texPlain('a \\not\\approx b')).toBe('a \u2249 b');
    expect(texPlain('\\varsigma \\ddagger')).toBe('ς‡');
  });

  it('writes a negative script in Unicode (a minus is U+2212 by then)', () => {
    expect(texPlain('\\Sigma^{-1}')).toBe('Σ⁻¹');
    expect(texPlain('x^{-2} + y_{-1}')).toBe('x⁻² + y₋₁');
    expect(texPlain('10^{-3}')).toBe('10⁻³');
    expect(texPlain('e^{-rT}')).toBe('e^(−rT)');
    expect(texPlain('x^{(n)}')).toBe('x⁽ⁿ⁾');
  });

  it('writes a page’s formula with every command read', () => {
    const tex = 's_{t+1} = s_t + \\beta (\\bar{s} - s_t) + \\sigma^2';
    expect(texPlain(tex)).toBe('s_(t+1) = s_t + β(s\u0304 − s_t) + σ²');
    expect(texRuns(tex).map((r) => r.t).join('')).toBe('st+1 = st + β(s\u0304 − st) + σ2');
  });
});

describe('firstPage', () => {
  it('takes the first root page of the first section that has one', () => {
    expect(firstPage(undefined)).toBeNull();
    expect(firstPage(tree([]))).toBeNull();
    expect(firstPage(tree([summary('p1', 'pc'), summary('child', 'fi', 'f1'), summary('f1', 'fi')]))?.id).toBe('f1');
    expect(firstPage(tree([summary('orphan', 'fi', 'gone')]))?.id).toBe('orphan');
  });
});

describe('isDesignSample', () => {
  const FI = 'Fixed Income';
  const sample = (blocks: TextbookBlock[], title = 'Rates primer', id = 'fi-rates') => page(id, title, blocks);

  it('recognises the design’s sample page while everything the card shows is as seeded', () => {
    expect(isDesignSample(sample(SAMPLE_BLOCKS), FI)).toBe(true);
    expect(isDesignSample(sample(SAMPLE_BLOCKS), 'Rates')).toBe(false);
    expect(isDesignSample(sample(SAMPLE_BLOCKS, 'Rates notes'), FI)).toBe(false);
    expect(isDesignSample(sample(SAMPLE_BLOCKS, 'Rates primer', 'other'), FI)).toBe(false);
  });

  it('follows an edit to any line of the excerpt, including below the first h2', () => {
    expect(isDesignSample(sample(edit('b1', { id: 'b1', type: 'h1', text: 'Duration' })), FI)).toBe(false);
    expect(isDesignSample(sample(edit('b3', { id: 'b3', type: 'p', text: 'Prices fall as yields rise.' })), FI)).toBe(false);
    expect(isDesignSample(sample(edit('b4', { id: 'b4', type: 'formula', tex: 'P = \\sum_t c_t' })), FI)).toBe(false);
    expect(isDesignSample(sample(edit('b5')), FI)).toBe(false);
    expect(isDesignSample(sample(edit('b8', { id: 'b8', type: 'h2', text: 'Carry' })), FI)).toBe(false);
  });

  it('ignores edits the card never shows', () => {
    expect(isDesignSample(sample(edit('b6')), FI)).toBe(true);
    expect(isDesignSample(sample(edit('b7', { id: 'b7', type: 'callout', text: 'Changed.' })), FI)).toBe(true);
    expect(isDesignSample(sample(edit('b9')), FI)).toBe(true);
  });
});

describe('pageExcerpt', () => {
  it('numbers the headings, reads the text and types the next heading', () => {
    const ex = pageExcerpt(
      page('p', 'Credit notes', [
        { id: 'a', type: 'h1', text: 'Spreads' },
        { id: 'b', type: 'p', text: '  ' },
        { id: 'c', type: 'h2', text: 'OAS' },
        { id: 'd', type: 'bullet', text: 'Option-adjusted' },
        { id: 'e', type: 'divider' },
        { id: 'f', type: 'formula', tex: 's = y - r' },
        { id: 'g', type: 'chart', assetId: 'x', name: 'spread.html', height: 380, caption: '' },
        { id: 'h', type: 'h3', text: 'Z-spread' },
        { id: 'i', type: 'h2', text: 'Carry' },
      ]),
      'Private Credit',
    );
    expect(ex.section).toBe('Private Credit');
    expect(ex.title).toBe('Credit notes');
    expect(ex.lines).toEqual([
      { kind: 'h1', num: '1', text: 'Spreads' },
      { kind: 'h2', num: '1.1', text: 'OAS' },
      { kind: 'para', text: '• Option-adjusted' },
      { kind: 'formula', text: 's = y − r', runs: [{ t: 's = y − r' }] },
      { kind: 'chart', text: 'Live chart · spread.html' },
    ]);
    expect(ex.lines).toHaveLength(MAX_LINES);
    expect(ex.next).toEqual({ num: '1.1.1', text: 'Z-spread' });
  });

  it('offers the next number when the page has no heading left', () => {
    expect(pageExcerpt(page('p', '', [{ id: 'a', type: 'p', text: 'Loose thought' }]), '').next).toEqual({ num: '1', text: '' });
    const one = pageExcerpt(page('p', 'T', [{ id: 'a', type: 'h1', text: '' }, { id: 'b', type: 'h2', text: 'B' }]), 'S');
    expect(one.lines[0]).toEqual({ kind: 'h1', num: '1', text: 'Untitled' });
    expect(one.next).toEqual({ num: '1.2', text: '' });
    expect(pageExcerpt(page('p', '', []), '')).toMatchObject({ section: 'Untitled section', title: 'Untitled', lines: [] });
  });
});

describe('excerptFor', () => {
  const t = tree([summary('fi-rates', 'fi')]);
  it('waits for the counts, the tree and the first page', () => {
    expect(excerptFor(undefined, t, undefined)).toBeNull();
    expect(excerptFor(4, undefined, undefined)).toBeNull();
    expect(excerptFor(4, t, undefined)).toBeNull();
    expect(excerptFor(4, t, page('other', 'X', []))).toBeNull();
  });

  it('is the empty page with no pages, the sample for the design page, else the real page', () => {
    expect(excerptFor(0, undefined, undefined)).toEqual({ kind: 'empty' });
    expect(excerptFor(3, tree([]), undefined)).toEqual({ kind: 'empty' });
    expect(excerptFor(4, t, page('fi-rates', 'Rates primer', SAMPLE_BLOCKS))).toEqual({ kind: 'sample' });
    const edited = excerptFor(4, t, page('fi-rates', 'Rates primer', edit('b3', { id: 'b3', type: 'p', text: 'Mine.' })));
    expect(edited?.kind === 'page' ? edited.lines[2] : edited).toEqual({ kind: 'para', text: 'Mine.' });
    const mine = excerptFor(4, t, page('fi-rates', 'My rates', SAMPLE_BLOCKS));
    expect(mine).toMatchObject({ kind: 'page', section: 'Fixed Income', title: 'My rates' });
  });
});
