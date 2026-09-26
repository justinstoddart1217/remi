/**
 * Three-way merge of a page's blocks after a 409 (another tab saved first). `base` is the copy
 * this tab last loaded or saved, `mine` what it has typed since, `theirs` the server's latest.
 * Blocks carry stable client ids (editor.newId), so the merge works per block:
 *
 * - A block only one side changed takes that side's version (a deletion counts as a change).
 * - A block both sides changed the same way is kept once.
 * - A block both sides changed differently keeps theirs, then mine right after it as a copy
 *   with a new id, so no typing is lost. A block one side deleted and the other edited is kept.
 * - Order: theirs, unless only this tab reordered blocks; the other side's new blocks go after
 *   the block they followed there.
 *
 * `kept` counts the blocks kept twice or restored, so the screen can say so.
 */

import { newId } from './editor';
import type { Block } from './editor';

export interface MergeResult {
  blocks: Block[];
  /** Blocks both sides changed differently (a copy of mine follows theirs), or one side deleted. */
  kept: number;
}

/** Key-order independent, so a server echo and a local edit of the same block compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameBlock(a: Block, b: Block): boolean {
  return stable(a) === stable(b);
}

export function sameBlocks(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return y !== undefined && sameBlock(x, y);
  });
}

const byId = (list: readonly Block[]) => new Map(list.map((b) => [b.id, b]));

/** Did `side` move any block it shares with `base`? */
function reordered(base: readonly Block[], side: readonly Block[]): boolean {
  const inSide = new Set(side.map((b) => b.id));
  const inBase = new Set(base.map((b) => b.id));
  const a = base.filter((b) => inSide.has(b.id)).map((b) => b.id);
  const b = side.filter((x) => inBase.has(x.id)).map((x) => x.id);
  return a.some((id, i) => id !== b[i]);
}

export function mergeBlocks(base: readonly Block[], mine: readonly Block[], theirs: readonly Block[]): MergeResult {
  const B = byId(base);
  const M = byId(mine);
  const T = byId(theirs);
  let kept = 0;
  /** Mine, kept as a copy right after theirs. */
  const copies = new Map<string, Block>();

  const resolve = (id: string): Block | null => {
    const m = M.get(id);
    const t = T.get(id);
    const b = B.get(id);
    if (!b) {
      // New on one side (ids are random, so both adding one id means the same block).
      if (m && t && !sameBlock(m, t)) {
        kept += 1;
        copies.set(id, { ...m, id: newId() });
      }
      return t ?? m ?? null;
    }
    const mineChanged = !m || !sameBlock(m, b);
    const theirsChanged = !t || !sameBlock(t, b);
    if (!mineChanged) return t ?? null;
    if (!theirsChanged) return m ?? null;
    if (m && t) {
      if (sameBlock(m, t)) return t;
      kept += 1;
      copies.set(id, { ...m, id: newId() });
      return t;
    }
    if (!m && !t) return null;
    // One side deleted it, the other edited it: keep the edit.
    kept += 1;
    return m ?? t ?? null;
  };

  const mineFirst = reordered(base, mine) && !reordered(base, theirs);
  const primary = mineFirst ? mine : theirs;
  const secondary = mineFirst ? theirs : mine;

  const out: Block[] = [];
  const placed = new Set<string>();
  for (const x of primary) {
    const r = resolve(x.id);
    placed.add(x.id);
    if (r) out.push(r);
  }
  // The other side's blocks the primary order does not have: new ones, or ones it deleted.
  secondary.forEach((x, i) => {
    if (placed.has(x.id)) return;
    placed.add(x.id);
    const r = resolve(x.id);
    if (!r) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prevId = secondary[j]?.id;
      const k = out.findIndex((o) => o.id === prevId);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, r);
  });

  const blocks: Block[] = [];
  for (const b of out) {
    blocks.push(b);
    const copy = copies.get(b.id);
    if (copy) blocks.push(copy);
  }
  return { blocks, kept };
}
