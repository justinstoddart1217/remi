import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { renderApp, stubSetupApi } from '../../test/renderApp';
import { buildPalette, clampIndex, parseQuickAdd, PALETTE_MAX_ITEMS, stepIndex } from './model';
import { registerPaletteProvider } from './registry';
import type { PaletteActions, PaletteContext, PaletteProvider } from './types';

const noop = () => undefined;
const actions: PaletteActions = { go: noop, openProject: noop, openCheckIn: noop, navigate: noop, close: noop };

function ctx(query: string): PaletteContext {
  const q = query.trim().toLowerCase();
  return { query, q, quickAdd: parseQuickAdd(q), queryClient: new QueryClient(), actions };
}

function many(id: string, order: number, n: number, group = 'Projects'): PaletteProvider {
  return {
    id,
    order,
    items: () => Array.from({ length: n }, (_, i) => ({ key: String(i), group, label: `${id} ${String(i)}`, run: noop })),
  };
}

describe('palette model', () => {
  it('parses quick add like the prototype', () => {
    expect(parseQuickAdd('+6h returns')).toEqual({ hours: 6, rest: 'returns' });
    expect(parseQuickAdd('returns 2.5h')).toEqual({ hours: 2.5, rest: 'returns' });
    expect(parseQuickAdd('+4 h manco')).toEqual({ hours: 4, rest: 'manco' });
    expect(parseQuickAdd('hello')).toBeNull();
  });

  it('orders providers, caps at 16 items and groups by first appearance', () => {
    const model = buildPalette([many('b', 30, 12, 'Projects'), many('a', 10, 6, 'Quick add')], ctx(''));
    expect(model.flat).toHaveLength(PALETTE_MAX_ITEMS);
    expect(model.groups.map((g) => g.label)).toEqual(['Quick add', 'Projects']);
    expect(model.groups[1]?.rows).toHaveLength(10);
    expect(model.flat.map((r) => r.index)).toEqual([...Array(16).keys()]);
  });

  it('clamps selection without wrapping', () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(0, 0)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it('uses the empty text from the first provider that has one', () => {
    const quiet: PaletteProvider = { id: 'q', order: 5, items: () => [], emptyText: () => 'Nothing here.' };
    expect(buildPalette([quiet], ctx('zzz')).emptyText).toBe('Nothing here.');
    expect(buildPalette([many('x', 1, 0)], ctx('zzz')).emptyText).toBe(
      'Nothing matches that. Try a project name, a screen, or “+4h manco”.',
    );
  });
});

describe('CommandPalette', () => {
  beforeEach(() => {
    stubSetupApi();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useOverlays.getState().closePalette();
    useUi.setState({ screenLocations: {} });
  });

  async function openPalette() {
    const utils = renderApp('/app/today');
    // The shell is up once its top bar is (no dependency on a screen's own content).
    fireEvent.click(await screen.findByRole('button', { name: 'Search or add' }));
    const input = screen.getByRole('combobox');
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    return { ...utils, input };
  }

  function selectedLabel(): string | null {
    return document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? null;
  }

  it('lists the screens, moves the selection with clamping and runs it with Enter', async () => {
    const { input, router } = await openPalette();
    expect(screen.getAllByRole('option')).toHaveLength(7);
    expect(screen.getByText('Jump to')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'ti' } });
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Timeline', 'Routines', 'Transition']);
    expect(selectedLabel()).toBe('Timeline');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selectedLabel()).toBe('Timeline');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedLabel()).toBe('Transition');

    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Routines' }));
    expect(selectedLabel()).toBe('Routines');

    fireEvent.change(input, { target: { value: 'tim' } });
    expect(selectedLabel()).toBe('Timeline');
    fireEvent.change(input, { target: { value: 'ti' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/routines');
    });
    expect(useOverlays.getState().palette.open).toBe(false);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows the empty state and hides screens in quick-add mode', async () => {
    const { input } = await openPalette();
    fireEvent.change(input, { target: { value: '+6h returns' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nothing matches that. Try a project name, a screen, or “+4h manco”.')).toBeInTheDocument();
  });

  it('takes rows from registered providers, capped at 16', async () => {
    const unregister = registerPaletteProvider(many('test', 30, 20));
    try {
      await openPalette();
      const options = screen.getAllByRole('option');
      // 7 'Jump to' rows (order 20) then the first 9 of the 20 test rows (order 30).
      expect(options).toHaveLength(16);
      expect(options[7]?.textContent).toBe('test 0');
      expect(options[15]?.textContent).toBe('test 8');
    } finally {
      act(() => {
        unregister();
      });
    }
  });
});
