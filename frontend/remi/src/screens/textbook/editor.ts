/**
 * The Textbook editor's pure parts (Remi Textbook.dc.html, arch-frontend-screens §4): the block
 * model, the reducer, heading numbers, the outline, word counts, markdown shortcuts, the slash
 * menu's items and filter, and drag-reorder maths.
 */

import type { TextbookBlock } from '../../api';
import { count, dm } from '../../lib/format';

export type Block = TextbookBlock;
export type BlockType = Block['type'];
export type TextType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'callout';
export type TextBlock = Extract<Block, { type: TextType }>;
export type FormulaBlock = Extract<Block, { type: 'formula' }>;
export type ChartBlock = Extract<Block, { type: 'chart' }>;
export type PageLinkBlock = Extract<Block, { type: 'page' }>;

export const TEXT_TYPES: readonly TextType[] = ['p', 'h1', 'h2', 'h3', 'bullet', 'callout'];

export function isTextType(type: BlockType): type is TextType {
  return (TEXT_TYPES as readonly string[]).includes(type);
}

export function isText(b: Block): b is TextBlock {
  return isTextType(b.type);
}

/** Block ids are client-generated (the server's BlockId), so autosave never waits. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Chart presets (:594) and the drag-resize clamp (:684). */
export const CHART_SIZES: readonly (readonly [label: 'S' | 'M' | 'L', height: number])[] = [
  ['S', 280],
  ['M', 380],
  ['L', 560],
];
export const CHART_MIN = 200;
export const CHART_MAX = 900;
export const CHART_DEFAULT = 380;
/** The server's upload cap (`chart_max_bytes`, 4 MB); checked first to save the upload. */
export const MAX_CHART_BYTES = 4 * 1024 * 1024;

/** Files that can become a live chart (:454): .html/.htm, or typed text/html. */
export function isHtmlFile(f: { name: string; type: string }): boolean {
  return /\.html?$/i.test(f.name) || f.type === 'text/html';
}

export const clampChartHeight = (h: number) => Math.max(CHART_MIN, Math.min(CHART_MAX, Math.round(h)));

/** A fresh block of `type`, keeping `id` when one is given (a conversion keeps the row). */
export function makeBlock(type: BlockType, id: string = newId(), text = ''): Block {
  switch (type) {
    case 'formula':
      return { id, type, tex: text };
    case 'page':
      return { id, type, targetPageId: null };
    case 'divider':
      return { id, type };
    case 'chart':
      return { id, type, assetId: null, name: '', height: CHART_DEFAULT, caption: '' };
    default:
      return { id, type, text };
  }
}

/** The editable text of a block: text, or the formula's TeX. */
export function textOf(b: Block): string {
  if (isText(b)) return b.text;
  if (b.type === 'formula') return b.tex;
  return '';
}

// ------------------------------------------------------------------ numbering and outline
export interface Heading {
  id: string;
  level: 1 | 2 | 3;
  num: string;
  text: string;
}

/** Heading numbers in one c1/c2/c3 pass (:571): '1', '1.1', '1.1.1'; '' for other blocks. */
export function headingNumbers(blocks: readonly Block[]): string[] {
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  return blocks.map((b) => {
    if (b.type === 'h1') {
      c1++;
      c2 = 0;
      c3 = 0;
      return String(c1);
    }
    if (b.type === 'h2') {
      c2++;
      c3 = 0;
      return `${String(c1)}.${String(c2)}`;
    }
    if (b.type === 'h3') {
      c3++;
      return `${String(c1)}.${String(c2)}.${String(c3)}`;
    }
    return '';
  });
}

/** The outline column's entries (:572): every heading, 'Untitled' when blank. */
export function outlineOf(blocks: readonly Block[]): Heading[] {
  const nums = headingNumbers(blocks);
  const out: Heading[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      out.push({ id: b.id, level: b.type === 'h1' ? 1 : b.type === 'h2' ? 2 : 3, num: nums[i] ?? '', text: b.text || 'Untitled' });
    }
  });
  return out;
}

/**
 * Words as the prototype counts them (:646): each non-empty text block adds its trimmed
 * text split on whitespace, so a text of only spaces is one word. Formulas do not count.
 */
export function wordCount(blocks: readonly Block[]): number {
  return blocks.reduce((n, b) => (isText(b) && b.text ? n + b.text.trim().split(/\s+/).length : n), 0);
}

/** Chart blocks with an uploaded file ("live charts"). */
export function liveCharts(blocks: readonly Block[]): number {
  return blocks.filter((b) => b.type === 'chart' && b.assetId !== null).length;
}

/** '1 section · 1 live chart · 108 words · edited 5 Oct' (:665). */
export function metaLine(blocks: readonly Block[], editedIso: string | null): string {
  const sections = blocks.filter((b) => b.type === 'h1').length;
  const parts = [count(sections, 'section'), count(liveCharts(blocks), 'live chart'), count(wordCount(blocks), 'word')];
  if (editedIso) parts.push(`edited ${dm(editedIso)}`);
  return parts.join(' · ');
}

/** The local calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function localDate(timestamp: string): string | null {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return null;
  const y = String(t.getFullYear());
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'today' / 'yesterday' / '5 Oct' for "Recently edited" (:540), by local calendar day. */
export function editedWhen(timestamp: string, now: Date = new Date()): string {
  const day = localDate(timestamp);
  if (!day) return '';
  const today = localDate(now.toISOString());
  if (!today || day >= today) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localDate(y.toISOString())) return 'yesterday';
  return dm(day);
}

// ------------------------------------------------------------------ markdown shortcuts
/**
 * Markdown shortcuts convert a `p` only (CORRECTION :494-496), and only when the whole value
 * is the marker: '# ', '## ', '### ', '- ', '* ', '> ', '$$ ', or '---' (a divider).
 */
export function markdownShortcut(type: BlockType, value: string): BlockType | null {
  if (type !== 'p') return null;
  const md: Record<string, BlockType> = {
    '# ': 'h1',
    '## ': 'h2',
    '### ': 'h3',
    '- ': 'bullet',
    '* ': 'bullet',
    '> ': 'callout',
    '$$ ': 'formula',
    '---': 'divider',
  };
  return md[value] ?? null;
}

// ------------------------------------------------------------------ slash menu
export interface SlashItem {
  type: BlockType;
  label: string;
  hint: string;
  icon: string;
  font: 'numeric' | 'ui' | 'display';
  size: number;
}

/** The ten block types (:475-477), in order. */
export const SLASH_ITEMS: readonly SlashItem[] = [
  { type: 'h1', label: 'Heading 1', hint: 'Numbered section, 1', icon: '1', font: 'numeric', size: 13 },
  { type: 'h2', label: 'Heading 2', hint: 'Subsection, 1.1', icon: '1.1', font: 'numeric', size: 11 },
  { type: 'h3', label: 'Heading 3', hint: 'Concept, 1.1.1', icon: '1.1.1', font: 'numeric', size: 9 },
  { type: 'p', label: 'Text', hint: 'Plain paragraph', icon: 'Aa', font: 'ui', size: 13 },
  { type: 'bullet', label: 'Bullet', hint: 'A simple list item', icon: '•', font: 'ui', size: 18 },
  { type: 'callout', label: 'Callout', hint: 'A note to remember', icon: '◆', font: 'ui', size: 12 },
  { type: 'formula', label: 'Formula', hint: 'LaTeX, rendered', icon: 'Σ', font: 'display', size: 17 },
  { type: 'page', label: 'Page inside', hint: 'A sub-page nested under this one', icon: '▤', font: 'ui', size: 16 },
  { type: 'chart', label: 'Live chart', hint: 'Drop or browse an HTML file', icon: '▦', font: 'ui', size: 16 },
  { type: 'divider', label: 'Divider', hint: 'A quiet rule', icon: '—', font: 'ui', size: 14 },
];

/** The menu opens while a text block's value starts with '/' and has no whitespace (:498). */
export function slashQuery(value: string): string | null {
  return value.startsWith('/') && !/\s/.test(value) ? value.slice(1) : null;
}

/** Items whose label or type id contains the query (:479). */
export function filterSlash(q: string): SlashItem[] {
  const l = q.toLowerCase();
  return SLASH_ITEMS.filter((x) => !l || x.label.toLowerCase().includes(l) || x.type.includes(l));
}

// ------------------------------------------------------------------ drag reorder
/**
 * The drop index for a pointer at `y`: the first row whose vertical midpoint is below it
 * (:470), else the last index (the end row).
 */
export function dropIndex(rows: readonly { index: number; top: number; height: number }[], y: number): number {
  for (const r of rows) if (y < r.top + r.height / 2) return r.index;
  const last = rows[rows.length - 1];
  return last ? last.index : 0;
}

/** Moves the block at `from` so it lands before index `to` of the original list (:681). */
export function moveBlock<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  if (item === undefined) return [...list];
  out.splice(to > from ? to - 1 : to, 0, item);
  return out;
}

// ------------------------------------------------------------------ reducer
export type EditorAction =
  | { type: 'reset'; blocks: Block[] }
  | { type: 'setText'; id: string; text: string }
  | { type: 'patch'; id: string; patch: Partial<Omit<ChartBlock, 'id' | 'type'>> }
  | { type: 'replace'; id: string; block: Block }
  | { type: 'insert'; index: number; block: Block }
  | { type: 'remove'; id: string }
  | { type: 'move'; from: number; to: number }
  /** Enter: the block keeps `before`; `block` is inserted after it. */
  | { type: 'split'; id: string; before: string; block: Block }
  /** Backspace at 0: `id`'s text joins the previous text block, and `id` goes. */
  | { type: 'merge'; id: string; into: string };

export function editorReducer(blocks: Block[], action: EditorAction): Block[] {
  switch (action.type) {
    case 'reset':
      return action.blocks;
    case 'setText':
      return blocks.map((b) => {
        if (b.id !== action.id) return b;
        if (isText(b)) return b.text === action.text ? b : { ...b, text: action.text };
        if (b.type === 'formula') return b.tex === action.text ? b : { ...b, tex: action.text };
        return b;
      });
    case 'patch':
      return blocks.map((b) => (b.id === action.id && b.type === 'chart' ? { ...b, ...action.patch } : b));
    case 'replace':
      return blocks.map((b) => (b.id === action.id ? action.block : b));
    case 'insert': {
      const out = [...blocks];
      out.splice(Math.max(0, Math.min(out.length, action.index)), 0, action.block);
      return out;
    }
    case 'remove':
      return blocks.filter((b) => b.id !== action.id);
    case 'move':
      return moveBlock(blocks, action.from, action.to);
    case 'split': {
      const i = blocks.findIndex((b) => b.id === action.id);
      if (i < 0) return blocks;
      const out = editorReducer(blocks, { type: 'setText', id: action.id, text: action.before });
      out.splice(i + 1, 0, action.block);
      return out;
    }
    case 'merge': {
      const from = blocks.find((b) => b.id === action.id);
      const into = blocks.find((b) => b.id === action.into);
      if (!from || !into || !isText(into)) return blocks;
      const joined = into.text + textOf(from);
      return blocks.filter((b) => b.id !== action.id).map((b) => (b.id === action.into ? { ...into, text: joined } : b));
    }
  }
}

/** The slash menu's option id for `type` (the text field's aria-activedescendant). */
export function slashOptionId(menuId: string, type: BlockType): string {
  return `${menuId}-${type}`;
}
