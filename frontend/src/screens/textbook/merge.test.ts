import { describe, expect, it } from 'vitest';

import type { Block } from './editor';
import { mergeBlocks, sameBlock } from './merge';

const p = (id: string, text: string): Block => ({ id, type: 'p', text });
const texts = (list: Block[]) => list.map((b) => (b as { text: string }).text);
const ids = (list: Block[]) => list.map((b) => b.id);

const base = [p('a', 'one'), p('b', 'two'), p('c', 'three')];

describe('mergeBlocks', () => {
  it('takes each side’s edits to different blocks', () => {
    const mine = [p('a', 'one'), p('b', 'two mine'), p('c', 'three')];
    const theirs = [p('a', 'one theirs'), p('b', 'two'), p('c', 'three')];
    expect(mergeBlocks(base, mine, theirs)).toEqual({ blocks: [p('a', 'one theirs'), p('b', 'two mine'), p('c', 'three')], kept: 0 });
  });

  it('keeps both versions of a block both sides changed differently, theirs first', () => {
    const mine = [p('a', 'one mine'), p('b', 'two'), p('c', 'three')];
    const theirs = [p('a', 'one theirs'), p('b', 'two'), p('c', 'three')];
    const out = mergeBlocks(base, mine, theirs);
    expect(texts(out.blocks)).toEqual(['one theirs', 'one mine', 'two', 'three']);
    expect(out.blocks[1]?.id).not.toBe('a');
    expect(out.kept).toBe(1);
  });

  it('keeps one copy when both made the same change', () => {
    const same = [p('a', 'one!'), p('b', 'two'), p('c', 'three')];
    expect(mergeBlocks(base, same, same)).toEqual({ blocks: same, kept: 0 });
  });

  it('places new blocks after the block they followed, from either side', () => {
    const mine = [p('a', 'one'), p('m', 'mine new'), p('b', 'two'), p('c', 'three')];
    const theirs = [p('a', 'one'), p('b', 'two'), p('t', 'theirs new'), p('c', 'three')];
    expect(ids(mergeBlocks(base, mine, theirs).blocks)).toEqual(['a', 'm', 'b', 't', 'c']);
    const first = [p('m', 'at the top'), ...base];
    expect(ids(mergeBlocks(base, first, base).blocks)).toEqual(['m', 'a', 'b', 'c']);
  });

  it('applies a deletion only when the other side left the block alone', () => {
    const mine = [p('a', 'one'), p('c', 'three')];
    expect(ids(mergeBlocks(base, mine, base).blocks)).toEqual(['a', 'c']);
    // They deleted b, this tab edited it: the edit is kept, where it was.
    const edited = [p('a', 'one'), p('b', 'two mine'), p('c', 'three')];
    const out = mergeBlocks(base, edited, [p('a', 'one'), p('c', 'three')]);
    expect(texts(out.blocks)).toEqual(['one', 'two mine', 'three']);
    expect(out.kept).toBe(1);
  });

  it('follows this tab’s order when only it moved blocks', () => {
    const mine = [p('c', 'three'), p('a', 'one'), p('b', 'two')];
    const theirs = [p('a', 'one theirs'), p('b', 'two'), p('c', 'three')];
    expect(texts(mergeBlocks(base, mine, theirs).blocks)).toEqual(['three', 'one theirs', 'two']);
  });

  it('compares blocks regardless of key order', () => {
    expect(sameBlock({ id: 'a', type: 'p', text: 'x' }, { text: 'x', type: 'p', id: 'a' })).toBe(true);
  });
});
