import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemiApiError } from '../../api';
import type { Block } from './editor';
import { createPageSaver, RETRY_MS, SAVE_COPY, SAVE_DEBOUNCE_MS } from './usePageSaver';
import type { SaveStatus, SaverDeps } from './usePageSaver';

const blocks = (text: string): Block[] => [{ id: 'b1', type: 'p', text }];
const p = (id: string, text: string): Block => ({ id, type: 'p', text });
const conflict = () => new RemiApiError({ status: 409, code: 'VERSION_CONFLICT', message: 'stale' });
type Latest = SaverDeps['events']['latest'];

function setup(save: SaverDeps['save'], latest: Latest = () => Promise.reject(new Error('no latest'))) {
  const statuses: [string, SaveStatus][] = [];
  const onConflict = vi.fn();
  const onGone = vi.fn();
  const rename = vi.fn(() => Promise.resolve({}));
  const saver = createPageSaver((id, st) => statuses.push([id, st]), { save, rename, events: { latest, onConflict, onGone } });
  return { saver, statuses, onConflict, onGone, rename };
}

describe('createPageSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says where pages are kept: on this computer, not in the browser', () => {
    // Pages live in the local server's database (PUT /textbook/pages/{id}/blocks), so the
    // prototype's "Saved in this browser" (it used localStorage) would be false.
    expect(SAVE_COPY.idle).toBe('Saved locally');
    expect(Object.values(SAVE_COPY).join(' ')).not.toMatch(/browser/i);
  });

  it('debounces 350ms and sends only the latest blocks with the opened version', async () => {
    const save = vi.fn(() => Promise.resolve({ version: 8 }));
    const { saver, statuses } = setup(save);
    saver.loaded('p', 7, []);
    saver.schedule('p', blocks('a'));
    saver.schedule('p', blocks('ab'));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ pageId: 'p', blocks: blocks('ab'), baseVersion: 7 });
    expect(statuses.map(([, st]) => st)).toEqual(['saved', 'saving', 'saved']);
  });

  it('chains saves, each with the version the last one returned', async () => {
    let v = 1;
    const save = vi.fn(() => Promise.resolve({ version: ++v }));
    const { saver } = setup(save);
    saver.loaded('p', 1, []);
    saver.schedule('p', blocks('a'));
    await saver.flush('p');
    saver.schedule('p', blocks('b'));
    await saver.flush('p');
    expect(save.mock.calls.map((c) => (c as unknown as [{ baseVersion: number }])[0].baseVersion)).toEqual([1, 2]);
  });

  it('keeps unsent blocks and their version when a page is reopened', async () => {
    const save = vi.fn(() => Promise.resolve({ version: 3 }));
    const { saver, statuses } = setup(save);
    saver.loaded('p', 2, []);
    saver.schedule('p', blocks('typed'));
    expect(saver.pendingBlocks('p')).toEqual(blocks('typed'));
    saver.loaded('p', 1, []);
    expect(statuses.at(-1)).toEqual(['p', 'saving']);
    await saver.flush('p');
    expect(save).toHaveBeenCalledWith({ pageId: 'p', blocks: blocks('typed'), baseVersion: 2 });
    expect(saver.pendingBlocks('p')).toBeNull();
  });

  it('on a 409 shows the latest copy when this tab has nothing of its own to keep', async () => {
    const save = vi.fn(() => Promise.reject(conflict()));
    const latest = vi.fn<Latest>(() => Promise.resolve({ version: 9, blocks: [p('b1', 'theirs')] }));
    const { saver, onConflict, statuses } = setup(save, latest);
    saver.loaded('p', 7, [p('b1', 'base')]);
    saver.schedule('p', [p('b1', 'base')]);
    await saver.flush('p');
    expect(latest).toHaveBeenCalledWith('p');
    expect(onConflict).toHaveBeenCalledWith('p', 'latest');
    expect(saver.pendingBlocks('p')).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toEqual(['p', 'saved']);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("on a 409 merges this tab's typing onto the latest copy instead of dropping it", async () => {
    // Another tab saved an edit to b1 (version 8); this tab edited b2 from version 7.
    const save = vi.fn<SaverDeps['save']>().mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ version: 9 });
    const latest = vi.fn<Latest>(() => Promise.resolve({ version: 8, blocks: [p('b1', 'one EDIT-FROM-TAB-A'), p('b2', 'two')] }));
    const { saver, onConflict } = setup(save, latest);
    saver.loaded('p', 7, [p('b1', 'one'), p('b2', 'two')]);
    saver.schedule('p', [p('b1', 'one'), p('b2', 'two EDIT-FROM-TAB-B')]);
    await saver.flush('p');
    expect(onConflict).toHaveBeenCalledWith('p', 'merged');
    expect(save).toHaveBeenLastCalledWith({
      pageId: 'p',
      blocks: [p('b1', 'one EDIT-FROM-TAB-A'), p('b2', 'two EDIT-FROM-TAB-B')],
      baseVersion: 8,
    });
  });

  it('on a 409 keeps both versions of a block both tabs changed, and what was typed meanwhile', async () => {
    let answer: (v: { version: number; blocks: Block[] }) => void = () => undefined;
    const latest = vi.fn<Latest>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const save = vi.fn<SaverDeps['save']>().mockRejectedValueOnce(conflict()).mockResolvedValue({ version: 9 });
    const { saver, onConflict } = setup(save, latest);
    saver.loaded('p', 7, [p('b1', 'one')]);
    saver.schedule('p', [p('b1', 'one mine')]);
    const done = saver.flush('p');
    await vi.advanceTimersByTimeAsync(0);
    // Still typing while the latest copy loads: nothing is sent with the stale version.
    saver.schedule('p', [p('b1', 'one mine more')]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.hasUnsaved()).toBe(true);
    answer({ version: 8, blocks: [p('b1', 'one theirs')] });
    await done;
    expect(onConflict).toHaveBeenCalledWith('p', 'kept');
    const sent = (save.mock.calls.at(-1) as [{ blocks: Block[]; baseVersion: number }])[0];
    expect(sent.baseVersion).toBe(8);
    expect(sent.blocks.map((b) => (b as { text: string }).text)).toEqual(['one theirs', 'one mine more']);
  });

  it('retries fetching the latest copy after a 409 when it fails, keeping the typing', async () => {
    const save = vi.fn<SaverDeps['save']>().mockRejectedValueOnce(conflict()).mockResolvedValue({ version: 9 });
    const latest = vi
      .fn<Latest>()
      .mockRejectedValueOnce(new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce({ version: 8, blocks: [p('b1', 'one')] });
    const { saver, statuses, onConflict } = setup(save, latest);
    saver.loaded('p', 7, [p('b1', 'one')]);
    saver.schedule('p', [p('b1', 'one'), p('b2', 'new')]);
    await saver.flush('p');
    expect(statuses.at(-1)).toEqual(['p', 'error']);
    expect(saver.hasUnsaved()).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(onConflict).toHaveBeenCalledWith('p', 'merged');
    expect(save).toHaveBeenLastCalledWith({ pageId: 'p', blocks: [p('b1', 'one'), p('b2', 'new')], baseVersion: 8 });
  });

  it('knows when anything is unsaved, and flushAll sends it at once', async () => {
    const save = vi
      .fn<SaverDeps['save']>()
      .mockRejectedValueOnce(new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValue({ version: 2 });
    const { saver } = setup(save);
    saver.loaded('p', 1, []);
    expect(saver.hasUnsaved()).toBe(false);
    saver.schedule('p', blocks('typed'));
    expect(saver.hasUnsaved()).toBe(true);
    saver.flushAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    // The save failed: still unsaved, so leaving the page would ask first.
    expect(saver.hasUnsaved()).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it('a page reopened while its save is in flight starts from the blocks being sent', async () => {
    let finish: (v: { version: number }) => void = () => undefined;
    const save = vi.fn<SaverDeps['save']>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { saver } = setup(save);
    saver.loaded('p', 1, []);
    saver.schedule('p', blocks('sending'));
    const done = saver.flush('p');
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.pendingBlocks('p')).toEqual(blocks('sending'));
    finish({ version: 2 });
    await done;
    expect(saver.pendingBlocks('p')).toBeNull();
  });

  it('hands a 404 to onGone', async () => {
    const save = vi.fn(() => Promise.reject(new RemiApiError({ status: 404, code: 'NOT_FOUND', message: 'gone' })));
    const { saver, onGone } = setup(save);
    saver.schedule('p', blocks('a'));
    await saver.flush('p');
    expect(onGone).toHaveBeenCalledWith('p');
  });

  it('says "not saved" on a failure and retries 3s later', async () => {
    const save = vi
      .fn<SaverDeps['save']>()
      .mockRejectedValueOnce(new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce({ version: 5 });
    const { saver, statuses } = setup(save);
    saver.schedule('p', blocks('a'));
    await saver.flush('p');
    expect(statuses.at(-1)).toEqual(['p', 'error']);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toEqual(['p', 'saved']);
  });

  it('renames on its own debounce and drops everything on discard', async () => {
    const save = vi.fn(() => Promise.resolve({ version: 2 }));
    const { saver, rename } = setup(save);
    saver.scheduleTitle('p', 'New title');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(rename).toHaveBeenCalledWith({ pageId: 'p', title: 'New title' });
    saver.schedule('q', blocks('x'));
    saver.scheduleTitle('q', 'gone');
    saver.discard('q');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
