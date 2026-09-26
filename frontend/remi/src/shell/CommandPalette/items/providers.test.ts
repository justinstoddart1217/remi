import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { keys } from '../../../api';
import { fixturePlan, fixtureProject } from '../../../test/msw';
import { jumpToProvider } from '../builtins';
import { buildPalette, PALETTE_EMPTY_TEXT, parseQuickAdd, PALETTE_MAX_ITEMS } from '../model';
import type { PaletteActions, PaletteContext } from '../types';
import { forecastHint, noMatchText, paletteProviders, quickAddExample } from './providers';

const RET = fixtureProject({ id: 'ret', name: 'Returns pipeline automation', short: 'Returns pipeline', forecastDate: '2026-12-02' });
const MANCO = fixtureProject({ id: 'manco', name: 'ManCo pack automation', short: 'ManCo automation', forecastDate: '2026-12-11' });
const ALPHA = fixtureProject({ id: 'alpha', name: 'Alpha engine', short: 'Alpha', domain: 'fi', forecastDate: null });
const PROJECTS = [RET, MANCO, ALPHA];

function firstItem(model: ReturnType<typeof buildPalette>) {
  const row = model.flat[0];
  if (!row) throw new Error('no rows');
  return row.item;
}

function context(query: string, projects: typeof PROJECTS | null = PROJECTS) {
  const queryClient = new QueryClient();
  if (projects) queryClient.setQueryData(keys.plan, fixturePlan({ projects }));
  const actions: PaletteActions = { go: vi.fn(), openProject: vi.fn(), openCheckIn: vi.fn(), navigate: vi.fn(), close: vi.fn() };
  const q = query.trim().toLowerCase();
  const ctx: PaletteContext = { query, q, quickAdd: parseQuickAdd(q), queryClient, actions };
  return { ctx, actions, model: buildPalette([jumpToProvider, ...paletteProviders], ctx) };
}

describe('palette content', () => {
  it('lists Jump to, Projects, Tell Remi, Create and Setup for an empty query (16 at most)', () => {
    const { model } = context('');
    expect(model.groups.map((g) => g.label)).toEqual(['Jump to', 'Projects', 'Tell Remi', 'Create', 'Setup']);
    expect(model.flat.map((r) => r.item.label).slice(7, 10)).toEqual(['Returns pipeline automation', 'ManCo pack automation', 'Alpha engine']);
    const many = Array.from({ length: 6 }, (_, i) => fixtureProject({ id: `p${String(i)}`, name: `Project ${String(i)}`, short: `P${String(i)}` }));
    expect(context('', many).model.flat).toHaveLength(PALETTE_MAX_ITEMS);
  });

  it('hints forecasts, and "Not yet" in Define', () => {
    expect(forecastHint(RET)).toBe('Wed 2 Dec');
    expect(forecastHint(ALPHA)).toBe('Not yet');
  });

  it('quick add: "+6h returns" adds scope to matching planned projects and opens Tell Remi prefilled', () => {
    const { model, actions } = context('+6h returns');
    expect(model.groups.map((g) => g.label)).toEqual(['Quick add']);
    const item = firstItem(model);
    expect(item).toMatchObject({ label: 'Add 6h of scope to Returns pipeline', hint: 'check-in' });
    item.run();
    expect(actions.openCheckIn).toHaveBeenCalledWith('ret', { scopeH: 6 });
  });

  it('quick add skips projects without a forecast', () => {
    expect(context('+2h alpha').model.flat).toHaveLength(0);
  });

  it('"Tell Remi about X" opens the drawer on that project', () => {
    const { model, actions } = context('tell remi about manco');
    expect(model.flat.map((r) => r.item.label)).toEqual(['Tell Remi about ManCo automation']);
    firstItem(model).run();
    expect(actions.openCheckIn).toHaveBeenCalledWith('manco');
  });

  it('creates Private Credit and Fixed Income projects', () => {
    const { model } = context('new');
    expect(model.flat.map((r) => r.item.label)).toEqual(['New Private Credit project', 'New Fixed Income project']);
  });

  it('waits for the plan before offering Create and Edit setup', () => {
    expect(context('', null).model.flat.map((r) => r.item.group)).toEqual(Array(7).fill('Jump to'));
    expect(context('ti').model.flat.map((r) => r.item.label)).not.toContain('Edit setup');
    expect(context('sett').model.flat.map((r) => r.item.label)).toEqual(['Edit setup']);
  });

  it('"Edit setup" goes to Settings', () => {
    const { model, actions } = context('edit setup');
    expect(model.flat.map((r) => r.item.label)).toEqual(['Edit setup']);
    firstItem(model).run();
    expect(actions.navigate).toHaveBeenCalledWith('/settings');
  });

  it('shows "Reset to sample data" only in dev and only when asked for', () => {
    expect(context('').model.flat.some((r) => r.item.label === 'Reset to sample data')).toBe(false);
    expect(context('reset').model.flat.some((r) => r.item.label === 'Reset to sample data')).toBe(import.meta.env.DEV);
  });

  it('no-match copy names a real project, or drops the example without one', () => {
    expect(context('board minutes').model.emptyText).toBe('Nothing matches that. Try a project name, a screen, or “+4h manco”.');
    expect(quickAddExample([RET])).toBe('returns');
    expect(noMatchText([])).toBe('Nothing matches that. Try a project name or a screen.');
    expect(context('board minutes', []).model.emptyText).toBe('Nothing matches that. Try a project name or a screen.');
  });

  it('keeps the frame’s default no-match copy while the plan is unread', () => {
    expect(context('board minutes', null).model.emptyText).toBe(PALETTE_EMPTY_TEXT);
  });
});
