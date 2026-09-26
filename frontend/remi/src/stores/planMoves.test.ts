import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLASH_MS, MOVED_MS, usePlanMoves } from './planMoves';
import type { Movement } from './planMoves';

const slip: Movement = { projectId: 'ret', fromForecast: '2026-11-27', toForecast: '2026-12-07', deltaBd: 3, cause: 'scope' };

describe('planMoves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePlanMoves.getState().reset();
  });
  afterEach(() => {
    usePlanMoves.getState().reset();
    vi.useRealTimers();
  });

  it('flashes for 1100ms and shows the moved chip for 5200ms', () => {
    usePlanMoves.getState().start([slip]);
    expect(usePlanMoves.getState().flash.ret).toBe(true);
    expect(usePlanMoves.getState().moved.ret?.label).toBe('+3 BD');

    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(usePlanMoves.getState().flash.ret).toBe(true);
    vi.advanceTimersByTime(1);
    expect(usePlanMoves.getState().flash.ret).toBeUndefined();
    expect(usePlanMoves.getState().moved.ret).toBeDefined();

    vi.advanceTimersByTime(MOVED_MS - FLASH_MS - 1);
    expect(usePlanMoves.getState().moved.ret).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(usePlanMoves.getState().moved.ret).toBeUndefined();
  });

  it('restarts both timers when the same project moves again', () => {
    usePlanMoves.getState().start([slip]);
    vi.advanceTimersByTime(1000);
    usePlanMoves.getState().start([{ ...slip, fromForecast: '2026-12-07', toForecast: '2026-12-09', deltaBd: 2 }]);
    vi.advanceTimersByTime(1000);
    // 2000ms after the first start: the first flash would have ended at 1100ms.
    expect(usePlanMoves.getState().flash.ret).toBe(true);
    expect(usePlanMoves.getState().moved.ret?.label).toBe('+2 BD');
    vi.advanceTimersByTime(4000);
    // 6000ms after the first start (its chip would have gone at 5200), 5000ms after the second.
    expect(usePlanMoves.getState().moved.ret).toBeDefined();
    vi.advanceTimersByTime(200);
    expect(usePlanMoves.getState().moved.ret).toBeUndefined();
  });

  it('labels backward moves with U+2212 and keeps projects independent', () => {
    usePlanMoves.getState().start([
      { projectId: 'manco', fromForecast: '2026-12-11', toForecast: '2026-12-09', deltaBd: -2 },
      { projectId: 'fi', fromForecast: null, toForecast: '2027-02-01', deltaBd: 0 },
    ]);
    const { flash, moved } = usePlanMoves.getState();
    expect(moved.manco?.label).toBe('−2 BD');
    expect(flash.fi).toBe(true);
    expect(moved.fi).toBeUndefined();
    vi.advanceTimersByTime(FLASH_MS);
    expect(usePlanMoves.getState().flash).toEqual({});
    expect(usePlanMoves.getState().moved.manco).toBeDefined();
  });

  it('honours explicit flash/moved flags and clears a previous chip on a no-move check-in', () => {
    usePlanMoves.getState().start([slip]);
    usePlanMoves.getState().start([
      { projectId: 'ret', fromForecast: '2026-12-07', toForecast: '2026-12-07', deltaBd: 0, flash: false, moved: false },
    ]);
    expect(usePlanMoves.getState().flash.ret).toBeUndefined();
    expect(usePlanMoves.getState().moved.ret).toBeUndefined();
    vi.advanceTimersByTime(MOVED_MS * 2);
    expect(usePlanMoves.getState().moved).toEqual({});
  });
});
