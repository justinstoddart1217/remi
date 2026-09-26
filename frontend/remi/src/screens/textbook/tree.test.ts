import { describe, expect, it } from 'vitest';

import type { PageSummaryOut, SectionOut, TextbookTreeOut } from '../../api';
import {
  ancestorsOf,
  crumbFor,
  descendantsOf,
  guideX,
  homeSub,
  moveSection,
  reorderSections,
  rowPad,
  sectionViews,
  topPageMeta,
  totalCharts,
} from './tree';

const sec = (id: string, label: string, pageCount: number, collapsed = false): SectionOut => ({
  id,
  label,
  accent: `var(--${id}-accent)`,
  sortOrder: 0,
  collapsed,
  pageCount,
});

const pg = (id: string, sectionId: string, parentId: string | null, title: string, chartCount = 0): PageSummaryOut => ({
  id,
  sectionId,
  parentId,
  title,
  sortOrder: 0,
  version: 1,
  updatedAt: '2026-10-05T08:30:00Z',
  childCount: 0,
  descendantCount: 0,
  chartCount,
  wordCount: 0,
});

// Depth-first, as GET /textbook returns it.
const tree: TextbookTreeOut = {
  sections: [sec('fi', 'Fixed Income', 4), sec('pc', 'Private Credit', 0), sec('gen', '', 1)],
  pages: [
    pg('rates', 'fi', null, 'Rates primer', 1),
    pg('dur', 'fi', 'rates', 'Duration'),
    pg('conv', 'fi', 'dur', ''),
    pg('rot', 'fi', null, 'Rotation'),
    pg('how', 'gen', null, 'How it works'),
  ],
};

const views = (opts: Partial<Parameters<typeof sectionViews>[1]> = {}) =>
  sectionViews(tree, { currentId: null, collapsed: new Set(), query: '', hits: null, ...opts });

describe('page tree', () => {
  it('walks each section depth-first with depth, carets and "Untitled"', () => {
    const fi = views()[0];
    expect(fi?.rows.map((r) => `${'-'.repeat(r.depth)}${r.title}${r.hasKids ? '>' : ''}`)).toEqual([
      'Rates primer>',
      '-Duration>',
      '--Untitled',
      'Rotation',
    ]);
  });

  it('draws the open page and its ancestors in ink', () => {
    const rows = views({ currentId: 'conv' })[0]?.rows ?? [];
    expect(rows.filter((r) => r.ancestor).map((r) => r.id)).toEqual(['rates', 'dur']);
    expect(rows.find((r) => r.current)?.id).toBe('conv');
  });

  it('hides the pages inside a folded page', () => {
    const rows = views({ collapsed: new Set(['rates']) })[0]?.rows ?? [];
    expect(rows.map((r) => r.id)).toEqual(['rates', 'rot']);
    expect(rows[0]?.expanded).toBe(false);
  });

  it('labels empty and unnamed sections and allows deleting only empty ones', () => {
    const [fi, pc, gen] = views();
    expect(pc?.empty).toBe('No pages yet');
    expect(pc?.canDelete).toBe(true);
    expect(fi?.canDelete).toBe(false);
    expect(gen?.label).toBe('Untitled section');
  });

  it('opens every section and lists matches flat while searching', () => {
    const t2 = { ...tree, sections: tree.sections.map((s) => ({ ...s, collapsed: true })) };
    const out = sectionViews(t2, {
      currentId: null,
      collapsed: new Set(['rates']),
      query: 'dur',
      hits: [{ pageId: 'dur', sectionId: 'fi', title: 'Duration', inTitle: true, snippet: '' }],
    });
    expect(out.map((v) => v.open)).toEqual([true, true, true]);
    expect(out[0]?.rows.map((r) => [r.id, r.depth])).toEqual([['dur', 0]]);
    expect(out[1]?.empty).toBe('No matches');
  });

  it('shows the typed title and chart count of the open page before the server has them', () => {
    const rows = views({ live: { pageId: 'rot', title: 'Rotation notes', charts: 2 } })[0]?.rows ?? [];
    expect(rows.find((r) => r.id === 'rot')).toMatchObject({ title: 'Rotation notes', charts: 2 });
    expect(totalCharts(tree.pages, { pageId: 'rot', charts: 2 })).toBe(3);
    expect(totalCharts(tree.pages, null)).toBe(1);
  });

  it('indents 16px a level with a guide line', () => {
    expect([rowPad(0), rowPad(1), rowPad(2)]).toEqual([4, 20, 36]);
    expect([guideX(1), guideX(2)]).toEqual([14, 30]);
  });
});

describe('ancestry and the crumb', () => {
  it('finds ancestors root first and every descendant', () => {
    expect(ancestorsOf(tree.pages, 'conv').map((p) => p.id)).toEqual(['rates', 'dur']);
    expect(ancestorsOf(tree.pages, 'rates')).toEqual([]);
    expect(descendantsOf(tree.pages, 'rates')).toEqual(['dur', 'conv']);
  });

  it('survives a parent loop', () => {
    const loop = [pg('a', 'fi', 'b', 'A'), pg('b', 'fi', 'a', 'B')];
    expect(ancestorsOf(loop, 'a')).toHaveLength(2);
    expect(descendantsOf(loop, 'a')).toEqual(['b', 'a']);
  });

  it('builds the crumb from the section, the ancestors and the (typed) title', () => {
    expect(crumbFor(tree, 'conv')).toEqual({
      accent: 'var(--fi-accent)',
      section: 'Fixed Income',
      path: [
        { id: 'rates', title: 'Rates primer' },
        { id: 'dur', title: 'Duration' },
      ],
      title: 'Untitled',
    });
    expect(crumbFor(tree, 'how', 'Typed').title).toBe('Typed');
    expect(crumbFor(undefined, 'x')).toMatchObject({ section: '', path: [], title: 'Untitled' });
  });
});

describe('sections', () => {
  it('moves a section before another, or to the end', () => {
    expect(reorderSections(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderSections(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
    // The keyboard's one place earlier or later (Alt+↑ / Alt+↓), unchanged at the ends.
    expect(moveSection(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveSection(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveSection(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveSection(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveSection(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(reorderSections(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(reorderSections(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
  });
});

describe('Textbook home copy', () => {
  it('pluralises the counts and groups words en-GB', () => {
    expect(homeSub({ pages: 4, sections: 3, charts: 1, words: 256 })).toBe('4 pages · 3 sections · 1 live chart · 256 words');
    expect(homeSub({ pages: 1, sections: 1, charts: 0, words: 1234 })).toBe('1 page · 1 section · 0 live charts · 1,234 words');
    expect(homeSub({ pages: 0, sections: 0, charts: 2, words: 1 })).toBe('0 pages · 0 sections · 2 live charts · 1 word');
  });

  it('writes a section card page meta', () => {
    expect(topPageMeta(0, 0)).toBe('');
    expect(topPageMeta(0, 1)).toBe('1 chart');
    expect(topPageMeta(2, 3)).toBe('2 inside · 3 charts');
  });
});
