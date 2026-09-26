/**
 * Pure palette logic (Remi.dc.html paletteGroups / palKey), kept apart from the component so
 * it can be tested: quick-add parsing, the 16-item cap, grouping, and selection clamping.
 */

import type { PaletteContext, PaletteItem, PaletteProvider, QuickAdd } from './types';

export const PALETTE_MAX_ITEMS = 16;

export const PALETTE_PLACEHOLDER = 'Jump to a screen or project, or type “+6h returns” to add scope';

export const PALETTE_EMPTY_TEXT = 'Nothing matches that. Try a project name, a screen, or “+4h manco”.';

/** The prototype's quick-add pattern: the first '<n>h' anywhere in the query. */
export const QUICK_ADD_PATTERN = /\+?\s*(\d+(?:\.\d+)?)\s*h\b/;

/** `q` must already be trimmed and lower-cased. */
export function parseQuickAdd(q: string): QuickAdd | null {
  const m = QUICK_ADD_PATTERN.exec(q);
  if (!m?.[1]) return null;
  return { hours: parseFloat(m[1]), rest: q.replace(m[0], '').trim() };
}

export interface PaletteRow {
  item: PaletteItem;
  /** Position in the flat list (selection index). */
  index: number;
  /** Stable React key: provider id + item key. */
  id: string;
}

export interface PaletteGroup {
  label: string;
  rows: PaletteRow[];
}

export interface PaletteModel {
  flat: PaletteRow[];
  groups: PaletteGroup[];
  emptyText: string;
}

export const EMPTY_PALETTE: PaletteModel = { flat: [], groups: [], emptyText: PALETTE_EMPTY_TEXT };

export function buildPalette(providers: readonly PaletteProvider[], ctx: PaletteContext): PaletteModel {
  const ordered = [...providers].sort((a, b) => a.order - b.order);
  const all: PaletteRow[] = [];
  for (const provider of ordered) {
    for (const item of provider.items(ctx)) {
      all.push({ item, index: all.length, id: `${provider.id}:${item.key}` });
    }
  }
  const flat = all.slice(0, PALETTE_MAX_ITEMS);
  const groups: PaletteGroup[] = [];
  for (const row of flat) {
    let group = groups.find((g) => g.label === row.item.group);
    if (!group) {
      group = { label: row.item.group, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  let emptyText = PALETTE_EMPTY_TEXT;
  for (const provider of ordered) {
    const text = provider.emptyText?.(ctx);
    if (text) {
      emptyText = text;
      break;
    }
  }
  return { flat, groups, emptyText };
}

/** The selected row for a stored index (the prototype's `sel`). */
export function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

/** ArrowUp / ArrowDown without wrap-around. */
export function stepIndex(selected: number, count: number, direction: 1 | -1): number {
  if (count === 0) return 0;
  return direction > 0 ? Math.min(count - 1, selected + 1) : Math.max(0, selected - 1);
}
