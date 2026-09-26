import { describe, expect, it } from 'vitest';

import {
  clampChartHeight,
  dropIndex,
  editedWhen,
  editorReducer,
  filterSlash,
  headingNumbers,
  isHtmlFile,
  liveCharts,
  makeBlock,
  markdownShortcut,
  metaLine,
  moveBlock,
  outlineOf,
  SLASH_ITEMS,
  slashQuery,
  wordCount,
} from './editor';
import type { Block } from './editor';

const p = (id: string, text: string): Block => ({ id, type: 'p', text });
const h = (id: string, type: 'h1' | 'h2' | 'h3', text: string): Block => ({ id, type, text });

describe('heading numbers and outline', () => {
  const blocks: Block[] = [
    h('a', 'h1', 'Rates and duration'),
    h('b', 'h2', 'Price and yield'),
    p('c', 'text'),
    h('d', 'h3', 'Modified'),
    h('e', 'h3', ''),
    h('f', 'h2', 'Convexity'),
    h('g', 'h1', 'Credit'),
    h('i', 'h2', 'Spreads'),
  ];

  it('numbers in one c1/c2/c3 pass, resetting below each level', () => {
    expect(headingNumbers(blocks)).toEqual(['1', '1.1', '', '1.1.1', '1.1.2', '1.2', '2', '2.1']);
  });

  it('numbers an h2 before any h1 as 0.1 (the prototype does the same)', () => {
    expect(headingNumbers([h('x', 'h2', 'Early')])).toEqual(['0.1']);
  });

  it('lists every heading with its level and "Untitled" for a blank one', () => {
    const out = outlineOf(blocks);
    expect(out.map((o) => `${String(o.level)} ${o.num} ${o.text}`)).toEqual([
      '1 1 Rates and duration',
      '2 1.1 Price and yield',
      '3 1.1.1 Modified',
      '3 1.1.2 Untitled',
      '2 1.2 Convexity',
      '1 2 Credit',
      '2 2.1 Spreads',
    ]);
  });
});

describe('counts and the meta line', () => {
  it('counts words as the prototype: whitespace-only text is one word, formulas none', () => {
    const blocks: Block[] = [p('a', 'one two  three'), p('b', '   '), p('c', ''), { id: 'f', type: 'formula', tex: 'a + b' }];
    expect(wordCount(blocks)).toBe(4);
  });

  it('counts only charts that have a file', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'chart', assetId: 'x', name: 'a.html', height: 380, caption: '' },
      { id: 'b', type: 'chart', assetId: null, name: '', height: 380, caption: '' },
    ];
    expect(liveCharts(blocks)).toBe(1);
  });

  it('writes sections (h1), live charts, words and the edit day with real plurals', () => {
    const blocks: Block[] = [h('a', 'h1', 'One'), p('b', 'two words')];
    expect(metaLine(blocks, '2026-10-05')).toBe('1 section · 0 live charts · 3 words · edited 5 Oct');
    expect(metaLine([p('x', 'word')], null)).toBe('0 sections · 0 live charts · 1 word');
  });

  it('says today, yesterday, or the day for "Recently edited"', () => {
    const now = new Date(2026, 9, 5, 9, 30);
    expect(editedWhen(new Date(2026, 9, 5, 8, 0).toISOString(), now)).toBe('today');
    expect(editedWhen(new Date(2026, 9, 4, 18, 0).toISOString(), now)).toBe('yesterday');
    expect(editedWhen(new Date(2026, 8, 30, 12, 0).toISOString(), now)).toBe('30 Sep');
    expect(editedWhen('not a date', now)).toBe('');
  });
});

describe('markdown shortcuts', () => {
  it('convert a paragraph when the whole value is the marker', () => {
    expect(markdownShortcut('p', '# ')).toBe('h1');
    expect(markdownShortcut('p', '## ')).toBe('h2');
    expect(markdownShortcut('p', '### ')).toBe('h3');
    expect(markdownShortcut('p', '- ')).toBe('bullet');
    expect(markdownShortcut('p', '* ')).toBe('bullet');
    expect(markdownShortcut('p', '> ')).toBe('callout');
    expect(markdownShortcut('p', '$$ ')).toBe('formula');
    expect(markdownShortcut('p', '---')).toBe('divider');
  });

  it('leave other text and other block types alone (CORRECTION :494-496)', () => {
    expect(markdownShortcut('p', '# Heading')).toBeNull();
    expect(markdownShortcut('p', '#')).toBeNull();
    expect(markdownShortcut('bullet', '# ')).toBeNull();
    expect(markdownShortcut('bullet', '---')).toBeNull();
    expect(markdownShortcut('h1', '- ')).toBeNull();
  });
});

describe('slash menu', () => {
  it('has the ten block types in the prototype order', () => {
    expect(SLASH_ITEMS.map((x) => x.label)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Text',
      'Bullet',
      'Callout',
      'Formula',
      'Page inside',
      'Live chart',
      'Divider',
    ]);
  });

  it('opens only while the text is "/" plus a word', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/form')).toBe('form');
    expect(slashQuery('/two words')).toBeNull();
    expect(slashQuery('text /x')).toBeNull();
    expect(slashQuery('/a\nb')).toBeNull();
  });

  it('filters on the label or the type id, ignoring case', () => {
    expect(filterSlash('head').map((x) => x.type)).toEqual(['h1', 'h2', 'h3']);
    expect(filterSlash('H2').map((x) => x.type)).toEqual(['h2']);
    expect(filterSlash('chart').map((x) => x.type)).toEqual(['chart']);
    expect(filterSlash('p').map((x) => x.type)).toEqual(['p', 'page']);
    expect(filterSlash('zzz')).toEqual([]);
    expect(filterSlash('')).toHaveLength(10);
  });
});

describe('drag reorder maths', () => {
  const rows = [
    { index: 0, top: 0, height: 40 },
    { index: 1, top: 40, height: 20 },
    { index: 2, top: 60, height: 100 },
    { index: 3, top: 160, height: 64 },
  ];

  it('drops before the first row whose midpoint is below the pointer', () => {
    expect(dropIndex(rows, 5)).toBe(0);
    expect(dropIndex(rows, 25)).toBe(1);
    expect(dropIndex(rows, 55)).toBe(2);
    expect(dropIndex(rows, 150)).toBe(3);
    expect(dropIndex(rows, 900)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });

  it('moves a block before index `to` of the original list', () => {
    expect(moveBlock(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBlock(['a', 'b', 'c', 'd'], 0, 4)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveBlock(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveBlock(['a', 'b', 'c', 'd'], 1, 1)).toEqual(['a', 'b', 'c', 'd']);
    expect(moveBlock(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('editorReducer', () => {
  const base: Block[] = [h('t', 'h1', 'Title'), p('a', 'hello world'), { id: 'f', type: 'formula', tex: 'x' }, p('b', 'tail')];

  it('splits a block at the caret and inserts the new one after it', () => {
    const next = makeBlock('p', 'n', 'world');
    const out = editorReducer(base, { type: 'split', id: 'a', before: 'hello ', block: next });
    expect(out.map((b) => b.id)).toEqual(['t', 'a', 'n', 'f', 'b']);
    expect(out[1]).toEqual(p('a', 'hello '));
    expect(out[2]).toEqual(p('n', 'world'));
  });

  it('merges a block into the previous text block', () => {
    const out = editorReducer(base, { type: 'merge', id: 'a', into: 't' });
    expect(out.map((b) => b.id)).toEqual(['t', 'f', 'b']);
    expect(out[0]).toEqual(h('t', 'h1', 'Titlehello world'));
  });

  it('does not merge into a non-text block', () => {
    expect(editorReducer(base, { type: 'merge', id: 'b', into: 'f' })).toBe(base);
  });

  it('sets text on text blocks and TeX on formulas', () => {
    const out = editorReducer(base, { type: 'setText', id: 'f', text: '\\frac{1}{2}' });
    expect(out[2]).toEqual({ id: 'f', type: 'formula', tex: '\\frac{1}{2}' });
  });

  it('converts a block in place, keeping its id', () => {
    const out = editorReducer(base, { type: 'replace', id: 'a', block: makeBlock('divider', 'a') });
    expect(out[1]).toEqual({ id: 'a', type: 'divider' });
  });

  it('patches chart fields only on charts', () => {
    const chart: Block = { id: 'c', type: 'chart', assetId: null, name: '', height: 380, caption: 'keep' };
    const out = editorReducer([chart, p('x', '')], { type: 'patch', id: 'c', patch: { assetId: 'a1', name: 'new.html' } });
    expect(out[0]).toEqual({ ...chart, assetId: 'a1', name: 'new.html' });
    expect(editorReducer([p('x', '')], { type: 'patch', id: 'x', patch: { height: 500 } })[0]).toEqual(p('x', ''));
  });

  it('inserts clamped to the list and removes by id', () => {
    const out = editorReducer(base, { type: 'insert', index: 99, block: p('z', '') });
    expect(out.map((b) => b.id)).toEqual(['t', 'a', 'f', 'b', 'z']);
    expect(editorReducer(out, { type: 'remove', id: 'a' }).map((b) => b.id)).toEqual(['t', 'f', 'b', 'z']);
  });
});

describe('charts', () => {
  it('clamps drag-resize to 200-900 and rounds', () => {
    expect(clampChartHeight(120)).toBe(200);
    expect(clampChartHeight(412.6)).toBe(413);
    expect(clampChartHeight(2000)).toBe(900);
  });

  it('takes .html/.htm files or text/html', () => {
    expect(isHtmlFile({ name: 'chart.HTML', type: '' })).toBe(true);
    expect(isHtmlFile({ name: 'chart.htm', type: '' })).toBe(true);
    expect(isHtmlFile({ name: 'noext', type: 'text/html' })).toBe(true);
    expect(isHtmlFile({ name: 'data.csv', type: 'text/csv' })).toBe(false);
  });

  it('makes empty blocks of every type', () => {
    expect(makeBlock('chart', 'c')).toEqual({ id: 'c', type: 'chart', assetId: null, name: '', height: 380, caption: '' });
    expect(makeBlock('page', 'l')).toEqual({ id: 'l', type: 'page', targetPageId: null });
    expect(makeBlock('formula', 'f')).toEqual({ id: 'f', type: 'formula', tex: '' });
    expect(makeBlock('bullet', 'b', 'x')).toEqual({ id: 'b', type: 'bullet', text: 'x' });
  });
});
