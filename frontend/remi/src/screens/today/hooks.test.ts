import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DAY_SWITCH_MS, useDaySwitch } from './useDaySwitch';
import { isLive, OVERLAY_MAX_MS, useOptimisticDone, withoutValues } from './useOptimisticDone';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDaySwitch', () => {
  it('shows the first day at once', () => {
    const { result } = renderHook(() => useDaySwitch('2026-10-05', true));
    expect(result.current).toEqual({ shown: '2026-10-05', fading: false, dir: 1 });
  });

  it('fades out for 120ms, then swaps forward', () => {
    const { result, rerender } = renderHook(({ day }) => useDaySwitch(day, true), { initialProps: { day: '2026-10-05' } });
    rerender({ day: '2026-10-12' });
    expect(result.current).toEqual({ shown: '2026-10-05', fading: true, dir: 1 });
    act(() => {
      vi.advanceTimersByTime(DAY_SWITCH_MS - 1);
    });
    expect(result.current.shown).toBe('2026-10-05');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ shown: '2026-10-12', fading: false, dir: 1 });
  });

  it('slides the other way going back', () => {
    const { result, rerender } = renderHook(({ day }) => useDaySwitch(day, true), { initialProps: { day: '2026-10-12' } });
    rerender({ day: '2026-10-05' });
    expect(result.current.dir).toBe(-1);
  });

  it('waits for the new day’s data before swapping', () => {
    const { result, rerender } = renderHook(({ day, ready }) => useDaySwitch(day, ready), {
      initialProps: { day: '2026-10-05', ready: true },
    });
    rerender({ day: '2026-10-06', ready: false });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toMatchObject({ shown: '2026-10-05', fading: true });
    rerender({ day: '2026-10-06', ready: true });
    expect(result.current).toMatchObject({ shown: '2026-10-06', fading: false });
  });

  it('follows the latest pick when picks come quickly', () => {
    const { result, rerender } = renderHook(({ day }) => useDaySwitch(day, true), { initialProps: { day: '2026-10-05' } });
    rerender({ day: '2026-10-07' });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    rerender({ day: '2026-10-09' });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current.shown).toBe('2026-10-05');
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current).toEqual({ shown: '2026-10-09', fading: false, dir: 1 });
  });

  it('stops fading when the pick returns to the day on screen', () => {
    const { result, rerender } = renderHook(({ day }) => useDaySwitch(day, true), { initialProps: { day: '2026-10-05' } });
    rerender({ day: '2026-10-07' });
    rerender({ day: '2026-10-05' });
    expect(result.current).toMatchObject({ shown: '2026-10-05', fading: false });
  });
});

describe('optimistic ticks', () => {
  it('keeps an entry until every read has been fetched again', () => {
    expect(isLive(undefined, [1, 1])).toBe(false);
    expect(isLive({ value: true, settledAt: null }, [9, 9])).toBe(true);
    expect(isLive({ value: true, settledAt: [3, 5] }, [3, 5])).toBe(true);
    expect(isLive({ value: true, settledAt: [3, 5] }, [4, 5])).toBe(true);
    expect(isLive({ value: true, settledAt: [3, 5] }, [4, 6])).toBe(false);
  });

  it('drops only entries that still hold the given values', () => {
    const o = { a: { value: true, settledAt: null }, b: { value: false, settledAt: null } };
    expect(withoutValues(o, { a: true, b: true })).toEqual({ b: { value: false, settledAt: null } });
    expect(withoutValues(o, { c: true })).toBe(o);
  });

  it('shows the value at once, and the server’s once the reads catch up', async () => {
    let resolve: () => void = () => undefined;
    const onError = vi.fn();
    const { result, rerender } = renderHook(({ versions }) => useOptimisticDone(versions, onError), {
      initialProps: { versions: [1, 1] },
    });
    act(() => {
      result.current.run({ 'task:a': true }, () => new Promise<void>((r) => (resolve = r)));
    });
    expect(result.current.get('task:a', false)).toBe(true);
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(result.current.get('task:a', false)).toBe(true);
    rerender({ versions: [2, 1] });
    expect(result.current.get('task:a', false)).toBe(true);
    rerender({ versions: [2, 2] });
    expect(result.current.get('task:a', false)).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reverts and reports a failure', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useOptimisticDone([1, 1], onError));
    await act(async () => {
      result.current.run({ 'task:a': true, 'bau:r:2026-10-05': true }, () => Promise.reject(new Error('501')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.get('task:a', false)).toBe(false);
    expect(result.current.get('bau:r:2026-10-05', false)).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('lets a settled entry go after a while even without a refetch', async () => {
    const { result } = renderHook(() => useOptimisticDone([1, 1], vi.fn()));
    await act(async () => {
      result.current.run({ 'task:a': true }, () => Promise.resolve());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.get('task:a', false)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(OVERLAY_MAX_MS);
    });
    expect(result.current.get('task:a', false)).toBe(false);
  });
});
