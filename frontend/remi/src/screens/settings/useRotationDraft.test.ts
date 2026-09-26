import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RotationOut, RotationSegmentOut } from '../../api';
import { fixtureRotation } from '../../test/msw';
import type { SegmentDraft } from '../setup/rotation/model';
import { ROTATION_SAVE_DELAY_MS, useRotationDraft } from './useRotationDraft';

function out(id: string, order: number, code = 'DE'): RotationSegmentOut {
  return { id, order, country: 'Germany', code, lengthBd: 5, pass: 'Build', loop: 1, start: '2027-01-04', end: '2027-01-08' };
}

function fresh(key: string, code = 'FR'): SegmentDraft {
  return { key, id: null, country: 'France', code, lengthBd: 4, pass: 'Build' };
}

type Save = (segments: unknown) => Promise<{ entity: RotationOut }>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRotationDraft', () => {
  it('saves a valid change once, after a pause, and adopts the new ids', async () => {
    const rotation = fixtureRotation({ segments: [out('rot-0', 0)] });
    const save = vi.fn<Save>(() =>
      Promise.resolve({ entity: fixtureRotation({ segments: [out('rot-0', 0), out('rot-1', 1, 'FR')] }) }),
    );
    const { result } = renderHook(() => useRotationDraft(rotation, save));
    const first = result.current.draft[0];
    if (!first) throw new Error('no segment');

    act(() => {
      result.current.change([first, fresh('new-a')]);
    });
    act(() => {
      result.current.change([first, fresh('new-a'), fresh('new-b', '')]);
    });
    act(() => {
      result.current.change([first, fresh('new-a')]);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_SAVE_DELAY_MS);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toEqual([
      { id: 'rot-0', country: 'Germany', code: 'DE', lengthBd: 5, pass: 'Build' },
      { country: 'France', code: 'FR', lengthBd: 4, pass: 'Build' },
    ]);
    expect(result.current.draft.map((s) => [s.key, s.id])).toEqual([
      ['rot-0', 'rot-0'],
      ['new-a', 'rot-1'],
    ]);
  });

  it('does not save an unfinished country', async () => {
    const save = vi.fn<Save>();
    const { result } = renderHook(() => useRotationDraft(fixtureRotation(), save));
    act(() => {
      result.current.change([fresh('new-a', '')]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTATION_SAVE_DELAY_MS * 2);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.draft).toHaveLength(1);
  });

  it('follows the server when nothing is waiting', () => {
    const save = vi.fn<Save>();
    const { result, rerender } = renderHook(({ rotation }) => useRotationDraft(rotation, save), {
      initialProps: { rotation: fixtureRotation({ segments: [out('rot-0', 0)] }) },
    });
    rerender({ rotation: fixtureRotation({ segments: [out('rot-0', 0), out('rot-1', 1, 'FR')] }) });
    expect(result.current.draft.map((s) => s.id)).toEqual(['rot-0', 'rot-1']);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps a local edit when the server changes underneath it', () => {
    const save = vi.fn<Save>();
    const { result, rerender } = renderHook(({ rotation }) => useRotationDraft(rotation, save), {
      initialProps: { rotation: fixtureRotation({ segments: [out('rot-0', 0)] }) },
    });
    act(() => {
      result.current.change([fresh('new-a', '')]);
    });
    rerender({ rotation: fixtureRotation({ segments: [out('rot-0', 0), out('rot-1', 1, 'FR')] }) });
    expect(result.current.draft.map((s) => s.key)).toEqual(['new-a']);
  });
});
