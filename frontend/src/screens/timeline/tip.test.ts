import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tip } from './model';
import { createTipController } from './tip';

const tipOf = (key: string): Tip => ({ key, title: key, chip: '', lines: [] });

describe('timeline tip controller', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never reads layout inside a mouse event, and places once a frame at the last pointer', () => {
    const tips = createTipController();
    const wrap = document.createElement('div');
    const tip = document.createElement('div');
    const rect = vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 800));
    Object.defineProperty(wrap, 'offsetWidth', { value: 1000 });
    Object.defineProperty(wrap, 'offsetHeight', { value: 800 });
    tips.setElements({ wrap, tip });

    tips.show(tipOf('a'), { clientX: 10, clientY: 10 });
    tips.move({ clientX: 20, clientY: 30 });
    tips.move({ clientX: 40, clientY: 50 });
    // Enter and moves in one frame: no forced layout yet, one frame asked for.
    expect(rect).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    expect(tips.store.getState().tip?.key).toBe('a');

    frames.shift()?.(0);
    expect(rect).toHaveBeenCalledTimes(1);
    expect(tip.style.transform).toBe('translate(56px,66px)');
  });
});
