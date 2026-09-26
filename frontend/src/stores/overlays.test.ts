import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleGlobalKeydown } from '../lib/keyboard';
import { DRAWER_LAYER, focusReturnTarget, PALETTE_LAYER, useOverlays } from './overlays';

function key(init: KeyboardEventInit & { target?: EventTarget }): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.target) Object.defineProperty(e, 'target', { value: init.target });
  return e;
}

const app = { isApp: () => true };

function resetOverlays() {
  const st = useOverlays.getState();
  st.closePalette();
  st.closeDrawer();
  for (const id of useOverlays.getState().stack) st.removeLayer(id);
}

describe('overlays and the Escape order', () => {
  afterEach(resetOverlays);

  it('closes only the topmost layer per Escape, in reverse open order', () => {
    const closePanel = vi.fn(() => {
      useOverlays.getState().removeLayer('calendar-panel');
    });
    const st = useOverlays.getState();
    st.openDrawer('ret');
    st.pushLayer('calendar-panel', closePanel);
    st.openPalette();
    expect(useOverlays.getState().stack).toEqual([DRAWER_LAYER, 'calendar-panel', PALETTE_LAYER]);

    const e1 = key({ key: 'Escape' });
    handleGlobalKeydown(e1, app);
    expect(e1.defaultPrevented).toBe(true);
    expect(useOverlays.getState().palette.open).toBe(false);
    expect(useOverlays.getState().drawer.open).toBe(true);
    expect(closePanel).not.toHaveBeenCalled();

    handleGlobalKeydown(key({ key: 'Escape' }), app);
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(useOverlays.getState().drawer.open).toBe(true);

    handleGlobalKeydown(key({ key: 'Escape' }), app);
    expect(useOverlays.getState().drawer.open).toBe(false);
    expect(useOverlays.getState().stack).toEqual([]);

    const e4 = key({ key: 'Escape' });
    handleGlobalKeydown(e4, app);
    expect(e4.defaultPrevented).toBe(false);
  });

  it('ignores an Escape that something else already handled', () => {
    useOverlays.getState().openPalette();
    const e = key({ key: 'Escape' });
    e.preventDefault();
    handleGlobalKeydown(e, app);
    expect(useOverlays.getState().palette.open).toBe(true);
  });

  it('toggles the palette with ⌘K or Ctrl+K, even while typing, on app routes only', () => {
    const input = document.createElement('input');
    const e = key({ key: 'k', metaKey: true, target: input });
    handleGlobalKeydown(e, app);
    expect(e.defaultPrevented).toBe(true);
    expect(useOverlays.getState().palette.open).toBe(true);

    handleGlobalKeydown(key({ key: 'K', ctrlKey: true }), app);
    expect(useOverlays.getState().palette.open).toBe(false);

    const outside = key({ key: 'k', metaKey: true });
    handleGlobalKeydown(outside, { isApp: () => false });
    expect(outside.defaultPrevented).toBe(false);
    expect(useOverlays.getState().palette.open).toBe(false);
  });

  it('opening the drawer closes the palette and starts a new session', () => {
    const st = useOverlays.getState();
    st.openPalette('+6h returns');
    expect(useOverlays.getState().palette).toEqual({ open: true, query: '+6h returns', index: 0 });
    const before = useOverlays.getState().drawer.session;
    st.openDrawer('ret', { scopeH: 6 });
    const { drawer, palette, stack } = useOverlays.getState();
    expect(palette.open).toBe(false);
    expect(drawer).toEqual({ open: true, projectId: 'ret', session: before + 1, prefill: { scopeH: 6 } });
    expect(stack).toEqual([DRAWER_LAYER]);
    st.closeDrawer();
    expect(useOverlays.getState().drawer).toMatchObject({ open: false, projectId: 'ret', prefill: { scopeH: 6 } });
  });

  it('typing resets the palette selection', () => {
    const st = useOverlays.getState();
    st.openPalette();
    st.setPaletteIndex(4);
    st.setPaletteQuery('ti');
    expect(useOverlays.getState().palette.index).toBe(0);
  });
});

describe('where focus returns when a layer closes', () => {
  afterEach(() => {
    resetOverlays();
    document.body.innerHTML = '';
  });

  function button(name: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = name;
    document.body.appendChild(b);
    return b;
  }

  it('records the trigger when the palette or the drawer opens', () => {
    const search = button('Jump to or add');
    search.focus();
    useOverlays.getState().openPalette();
    expect(focusReturnTarget(PALETTE_LAYER)).toBe(search);
    // Re-opening an open palette keeps its trigger (focus is in the palette by then).
    button('elsewhere').focus();
    useOverlays.getState().openPalette('x');
    expect(focusReturnTarget(PALETTE_LAYER)).toBe(search);
    useOverlays.getState().closePalette();

    const tell = button('Tell Remi');
    tell.focus();
    useOverlays.getState().openDrawer(null);
    expect(focusReturnTarget(DRAWER_LAYER)).toBe(tell);
  });

  it("takes the palette's trigger for a drawer opened from a palette row, and keeps it for a new session", () => {
    const before = button('Workspace');
    useOverlays.getState().openDrawer('ret', null, { returnFocusTo: before });
    expect(focusReturnTarget(DRAWER_LAYER)).toBe(before);
    button('in the drawer').focus();
    useOverlays.getState().openDrawer('manco');
    expect(useOverlays.getState().drawer.session).toBeGreaterThan(0);
    expect(focusReturnTarget(DRAWER_LAYER)).toBe(before);
  });

  it('has no target when nothing was focused', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    useOverlays.getState().openDrawer(null);
    expect(focusReturnTarget(DRAWER_LAYER)).toBeNull();
  });
});
