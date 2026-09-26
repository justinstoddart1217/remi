import { describe, expect, it } from 'vitest';

import { canvasStyle, computeStage, FRAME_1920, FRAME_2560, MIN_FIT, parseFrameParam, toLocal } from './stage';

describe('stage', () => {
  it("fits the window at scale 1 by default (the prototype's 'Fit window')", () => {
    expect(computeStage(1920, 1080, null)).toEqual({ w: 1920, h: 1080, s: 1, x: 0, y: 0, mode: 'fit' });
    expect(computeStage(2560, 1440, null)).toMatchObject({ w: 2560, h: 1440, s: 1, mode: 'fit' });
  });

  it('never scales below its minimum: the canvas keeps 1440×720 at scale 1 and the window scrolls', () => {
    expect(computeStage(1280, 800, null)).toEqual({ w: 1440, h: 800, s: 1, x: 0, y: 0, mode: 'fit' });
    expect(computeStage(1440, 700, null)).toEqual({ w: 1440, h: 720, s: 1, x: 0, y: 0, mode: 'fit' });
    expect(computeStage(1024, 600, null)).toMatchObject({ w: MIN_FIT.w, h: MIN_FIT.h, s: 1 });
    // A MacBook Air window (1440×900 screen less the browser's chrome) lays out without scrolling.
    expect(computeStage(1440, 760, null)).toEqual({ w: 1440, h: 760, s: 1, x: 0, y: 0, mode: 'fit' });
  });

  // Browser zoom Z shrinks the CSS viewport to W/Z × H/Z. On screen, text is its CSS size × s × Z,
  // so it must grow with Z; a scaled fallback made s = (W/Z)/1920 and the zoom cancelled out.
  it.each([
    [1440, 900],
    [1280, 800],
    [1920, 1080],
  ])('lets browser zoom enlarge the text in a %i×%i window', (w, h) => {
    const onScreen = (zoom: number) => computeStage(w / zoom, h / zoom, null).s * zoom;
    const sizes = [1, 1.1, 1.25, 1.5, 2].map(onScreen);
    expect(sizes).toEqual([1, 1.1, 1.25, 1.5, 2]);
  });

  it("places 'Fit window' in the letterbox with minimum sizes, and a frame in design pixels", () => {
    expect(canvasStyle(computeStage(1280, 800, null))).toEqual({ inset: 0, minWidth: 1440, minHeight: 720, transform: 'scale(1)' });
    expect(canvasStyle(computeStage(1600, 1000, FRAME_1920))).toEqual({
      left: 0,
      top: 50,
      width: 1920,
      height: 1080,
      transform: `scale(${String(1600 / 1920)})`,
    });
  });

  it('centres and rounds a fixed frame like the prototype', () => {
    expect(computeStage(1600, 1000, FRAME_1920)).toEqual({ w: 1920, h: 1080, s: 1600 / 1920, x: 0, y: 50, mode: 'frame' });
    expect(computeStage(2560, 1440, FRAME_1920).s).toBeCloseTo(1.3333, 3);
    expect(computeStage(1920, 1080, FRAME_2560)).toMatchObject({ s: 0.75, x: 0, y: 0 });
  });

  it('parses only the two design frames', () => {
    expect(parseFrameParam('?frame=1920x1080')).toBe(FRAME_1920);
    expect(parseFrameParam('?frame=2560%C3%971440')).toBe(FRAME_2560);
    expect(parseFrameParam('?frame=800x600')).toBeNull();
    expect(parseFrameParam('')).toBeNull();
  });

  it('maps pointer positions back to unscaled pixels', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetWidth', { value: 1000 });
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 500, height: 300, right: 600, bottom: 350, x: 100, y: 50, toJSON: () => ({}) });
    expect(toLocal({ clientX: 350, clientY: 150 }, el)).toEqual({ x: 500, y: 200, k: 2 });
  });
});
