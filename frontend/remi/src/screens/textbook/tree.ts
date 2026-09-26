/**
 * The sidebar's page tree (Remi Textbook.dc.html:604-639): rows with depth, carets, guides and
 * ancestors in ink, search results as a flat list per section, and the crumb path.
 */

import type { PageSummaryOut, SectionOut, TextbookHomeOut, TextbookSearchOut, TextbookTreeOut } from '../../api';
import { count } from '../../lib/format';

export const UNTITLED = 'Untitled';
export const UNTITLED_SECTION = 'Untitled section';

export const titleOf = (title: string) => title || UNTITLED;
export const sectionLabel = (label: string) => label || UNTITLED_SECTION;

export interface TreeRow {
  id: string;
  title: string;
  depth: number;
  hasKids: boolean;
  expanded: boolean;
  charts: number;
  current: boolean;
  /** An ancestor of the open page: drawn in ink (:609). */
  ancestor: boolean;
}

export interface SectionView {
  section: SectionOut;
  label: string;
  open: boolean;
  rows: TreeRow[];
  /** "No pages yet" / "No matches", or null. */
  empty: string | null;
  canDelete: boolean;
}

/** Overrides for the open page while it is being edited (title typed, charts added). */
export interface LivePage {
  pageId: string;
  title?: string;
  charts?: number;
}

function withLive(p: PageSummaryOut, live: LivePage | null): { title: string; charts: number } {
  if (live?.pageId === p.id) return { title: live.title ?? p.title, charts: live.charts ?? p.chartCount };
  return { title: p.title, charts: p.chartCount };
}

/** Ancestors of a page, root first. */
export function ancestorsOf(pages: readonly PageSummaryOut[], pageId: string | null): PageSummaryOut[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: PageSummaryOut[] = [];
  const seen = new Set<string>();
  let cur = pageId ? byId.get(pageId) : undefined;
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
    if (cur) out.unshift(cur);
  }
  return out;
}

/** Every page inside `pageId`, at any depth. */
export function descendantsOf(pages: readonly PageSummaryOut[], pageId: string): string[] {
  const kids = new Map<string, string[]>();
  for (const p of pages) if (p.parentId) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p.id]);
  const out: string[] = [];
  const walk = (id: string) => {
    for (const k of kids.get(id) ?? []) {
      if (out.includes(k)) continue;
      out.push(k);
      walk(k);
    }
  };
  walk(pageId);
  return out;
}

/**
 * The sections with their rows. Without a query each section is a collapsible tree (pages
 * come depth-first from the server); with one, every section is open and lists its matches
 * flat (:618, :623-624).
 */
export function sectionViews(
  tree: TextbookTreeOut,
  opts: {
    currentId: string | null;
    collapsed: ReadonlySet<string>;
    query: string;
    hits: TextbookSearchOut['hits'] | null;
    live?: LivePage | null;
  },
): SectionView[] {
  const { pages, sections } = tree;
  const ids = new Set(pages.map((p) => p.id));
  const kids = new Map<string, PageSummaryOut[]>();
  for (const p of pages) if (p.parentId && ids.has(p.parentId)) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p]);
  const anc = new Set(ancestorsOf(pages, opts.currentId).map((a) => a.id));
  const live = opts.live ?? null;
  const q = opts.query.trim();

  const row = (p: PageSummaryOut, depth: number): TreeRow => {
    const hasKids = (kids.get(p.id)?.length ?? 0) > 0;
    const { title, charts } = withLive(p, live);
    return {
      id: p.id,
      title: titleOf(title),
      depth,
      hasKids,
      expanded: hasKids && !opts.collapsed.has(p.id),
      charts,
      current: p.id === opts.currentId,
      ancestor: anc.has(p.id),
    };
  };

  return sections.map((section) => {
    const rows: TreeRow[] = [];
    if (q) {
      const matched = new Set((opts.hits ?? []).filter((h) => h.sectionId === section.id).map((h) => h.pageId));
      for (const p of pages) if (p.sectionId === section.id && matched.has(p.id)) rows.push(row(p, 0));
    } else {
      const walk = (p: PageSummaryOut, depth: number) => {
        rows.push(row(p, depth));
        if (!opts.collapsed.has(p.id)) for (const k of kids.get(p.id) ?? []) walk(k, depth + 1);
      };
      for (const p of pages) if (p.sectionId === section.id && (!p.parentId || !ids.has(p.parentId))) walk(p, 0);
    }
    return {
      section,
      label: sectionLabel(section.label),
      open: q ? true : !section.collapsed,
      rows,
      empty: rows.length ? null : q ? 'No matches' : 'No pages yet',
      canDelete: section.pageCount === 0 && sections.length > 1,
    };
  });
}

/** Row geometry (:610): left padding 4 + 16/level, guide line for nested rows. */
export function rowPad(depth: number): number {
  return 4 + depth * 16;
}
export function guideX(depth: number): number {
  return 14 + (depth - 1) * 16;
}

export interface Crumb {
  /** The section's colour (a CSS colour from the server). */
  accent: string;
  section: string;
  /** Ancestors, root first; each is a link. */
  path: { id: string; title: string }[];
  title: string;
}

/** The top bar's crumb for a page (:656): section, ancestors, then the page title. */
export function crumbFor(tree: TextbookTreeOut | undefined, pageId: string, liveTitle?: string | null): Crumb {
  const page = tree?.pages.find((p) => p.id === pageId);
  const section = page ? tree?.sections.find((sec) => sec.id === page.sectionId) : undefined;
  return {
    accent: section?.accent ?? 'var(--ink-faint)',
    section: section ? sectionLabel(section.label) : '',
    path: tree ? ancestorsOf(tree.pages, pageId).map((a) => ({ id: a.id, title: titleOf(a.title) })) : [],
    title: titleOf(liveTitle ?? page?.title ?? ''),
  };
}

/** Every live chart in the tree, with the open page's own count in place of the stored one. */
export function totalCharts(pages: readonly PageSummaryOut[], live: LivePage | null): number {
  return pages.reduce((n, p) => n + withLive(p, live).charts, 0);
}

/** Moves section `from` before section `to` (or to the end, for null): the new id order (:635). */
export function reorderSections(ids: readonly string[], from: string, to: string | null): string[] {
  const out = ids.filter((id) => id !== from);
  if (!ids.includes(from)) return [...ids];
  const at = to === null ? out.length : out.indexOf(to);
  out.splice(at < 0 ? out.length : at, 0, from);
  return out;
}

/**
 * Moves section `id` one place earlier (-1) or later (+1): the keyboard's Alt+↑ / Alt+↓, the
 * same reorder the drag makes. Unchanged at either end.
 */
export function moveSection(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  return reorderSections(ids, id, dir < 0 ? (ids[j] ?? null) : (ids[j + 1] ?? null));
}

/** The crumb on Textbook home (:656). */
export const HOME_CRUMB: Crumb = { accent: 'var(--ink)', section: 'Textbook', path: [], title: 'Home' };

/** '4 pages · 3 sections · 1 live chart · 256 words' (:550), words with en-GB grouping. */
export function homeSub(c: TextbookHomeOut['counts']): string {
  const words = `${c.words.toLocaleString('en-GB')} ${c.words === 1 ? 'word' : 'words'}`;
  return [count(c.pages, 'page'), count(c.sections, 'section'), count(c.charts, 'live chart'), words].join(' · ');
}

/** A section card's page meta: '2 inside · 1 chart' (:547). */
export function topPageMeta(descendants: number, charts: number): string {
  return [descendants ? `${String(descendants)} inside` : '', charts ? count(charts, 'chart') : ''].filter(Boolean).join(' · ');
}
