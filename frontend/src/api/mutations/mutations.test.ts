import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLASH_MS, MOVED_MS, usePlanMoves } from '../../stores/planMoves';
import { useOverlays } from '../../stores/overlays';
import {
  errorResponse,
  fixtureAiStatus,
  fixturePlan,
  fixturePlanAfterScope,
  fixtureMovement,
  fixtureSettings,
  renderWithClient,
  server,
  setupMockApi,
} from '../../test/msw';
import { keys } from '../keys';
import type { PlanOut, SettingsOut } from '../types';
import { APPLY_DELAY_MS, useApplyCheckin } from './checkins';
import { usePlan } from '../queries/plan';
import { RemiApiError } from '../client';
import { commitPlanMutation, isStaleWrite, STALE_WRITE_MESSAGE, staleWriteMessage } from './core';
import { useUpdateTask } from './milestones';
import { useUpdatePage } from './textbook';
import { useCreateProject, useDeleteProject, useUpdateProject } from './projects';
import { useDeleteRoutine, usePutRunTick } from './routines';
import { mergeUiPrefs, usePutAiKey, useUpdateUiPrefs } from './settings';

const mock = setupMockApi();

const FAKE: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
};

beforeEach(() => {
  usePlanMoves.getState().reset();
});

afterEach(() => {
  usePlanMoves.getState().reset();
  useOverlays.getState().closeDrawer();
  vi.useRealTimers();
});

function applyAnswer(plan: PlanOut) {
  return {
    plan,
    movements: [fixtureMovement()],
    entity: { batchId: 'b1', checkinIds: ['c1'], projectIds: ['ret'], routineIds: [] },
  };
}

describe('check-in apply → plan moves', () => {
  it('closes the drawer at once, applies after 220ms, then flashes 1100ms and shows the chip 5200ms', async () => {
    vi.useFakeTimers(FAKE);
    const before = fixturePlan();
    const after = fixturePlanAfterScope(before);
    server.use(http.post('*/api/checkins/apply', () => HttpResponse.json(applyAnswer(after))));

    const { result, client } = renderWithClient(() => useApplyCheckin());
    client.setQueryData(keys.plan, before);
    client.setQueryData(keys.day.detail('2026-10-05'), { cached: true });
    act(() => {
      useOverlays.getState().openDrawer('ret');
    });
    expect(useOverlays.getState().drawer.open).toBe(true);

    // What the cache holds whenever the plan-moves store changes.
    const seen: { revision: number | undefined; flash: boolean }[] = [];
    const unsubscribe = usePlanMoves.subscribe((state) => {
      seen.push({ revision: client.getQueryData<PlanOut>(keys.plan)?.revision, flash: state.flash.ret === true });
    });

    let applied: Promise<unknown> = Promise.resolve();
    act(() => {
      applied = result.current.mutateAsync({ changes: [{ type: 'scope_add', projectId: 'ret', hours: 6, text: '+6h returns' }], source: 'simple' });
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useOverlays.getState().drawer.open).toBe(false);

    // The answer is back well before 220ms, but nothing moves yet.
    await act(() => vi.advanceTimersByTimeAsync(APPLY_DELAY_MS - 20));
    expect(client.getQueryData<PlanOut>(keys.plan)).toBe(before);
    expect(usePlanMoves.getState().flash).toEqual({});

    await act(() => vi.advanceTimersByTimeAsync(20));
    await act(() => applied);
    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(2);
    expect(client.getQueryData<PlanOut>(keys.plan)?.projects[0]?.forecastDate).toBe('2026-12-07');
    // The plan was in the cache before the moves started.
    expect(seen[0]).toEqual({ revision: 2, flash: true });
    expect(usePlanMoves.getState().moved.ret?.label).toBe('+3 BD');
    // Dependent reads were invalidated after the commit.
    expect(client.getQueryState(keys.day.detail('2026-10-05'))?.isInvalidated).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(FLASH_MS));
    expect(usePlanMoves.getState().flash.ret).toBeUndefined();
    expect(usePlanMoves.getState().moved.ret).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(MOVED_MS - FLASH_MS));
    expect(usePlanMoves.getState().moved.ret).toBeUndefined();
    unsubscribe();
  });

  it('applies nothing and plays nothing when apply fails', async () => {
    vi.useFakeTimers(FAKE);
    server.use(http.post('*/api/checkins/apply', () => errorResponse(422, 'VALIDATION_FAILED', 'Unknown task.', 'changes')));
    const before = fixturePlan();
    const { result, client } = renderWithClient(() => useApplyCheckin());
    client.setQueryData(keys.plan, before);

    let outcome: unknown = null;
    act(() => {
      result.current
        .mutateAsync({ changes: [], source: 'ai' })
        .then(() => (outcome = 'ok'))
        .catch((e: unknown) => (outcome = e));
    });
    await act(() => vi.advanceTimersByTimeAsync(APPLY_DELAY_MS + 10));
    expect(outcome).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', field: 'changes' });
    expect(client.getQueryData(keys.plan)).toBe(before);
    expect(usePlanMoves.getState().moved).toEqual({});
  });
});

describe('plan mutations', () => {
  it('commit: cancel the plan refetch, one setQueryData, start moves, then invalidate', async () => {
    const { client } = renderWithClient(() => null);
    const before = fixturePlan();
    client.setQueryData(keys.plan, before);
    const order: string[] = [];
    const cancel = vi.spyOn(client, 'cancelQueries').mockImplementation(() => {
      order.push('cancel');
      return Promise.resolve();
    });
    const set = vi.spyOn(client, 'setQueryData');
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(() => {
      order.push('invalidate');
      return Promise.resolve();
    });
    const unsubscribe = usePlanMoves.subscribe(() => order.push('moves'));
    set.mockImplementation((...args: Parameters<typeof client.setQueryData>) => {
      order.push('set');
      return client.getQueryCache().build(client, { queryKey: args[0] }).setData(args[1]);
    });

    await commitPlanMutation(client, { plan: fixturePlanAfterScope(before), movements: [fixtureMovement()] }, { invalidate: [keys.home] });

    expect(order).toEqual(['cancel', 'set', 'moves', 'invalidate']);
    expect(cancel).toHaveBeenCalledWith({ queryKey: keys.plan, exact: true });
    expect(set).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.home });
    unsubscribe();
  });

  it('never rolls the plan back to an older revision (unless forced)', async () => {
    const { client } = renderWithClient(() => null);
    const newer = fixturePlan({ revision: 5 });
    client.setQueryData(keys.plan, newer);
    await commitPlanMutation(client, { plan: fixturePlan({ revision: 4 }), movements: [] });
    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(5);
    await commitPlanMutation(client, { plan: fixturePlan({ revision: 1 }), movements: [] }, { force: true });
    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(1);
  });

  it('create project: POSTs with X-Remi-Client, commits the plan, keeps shared subtrees', async () => {
    const before = fixturePlan();
    const after = { ...fixturePlanAfterScope(before), counts: { ...before.counts, projects: 2 } };
    let body: unknown = null;
    let clientHeader: string | null = null;
    server.use(
      http.post('*/api/projects', async ({ request }) => {
        body = await request.json();
        clientHeader = request.headers.get('X-Remi-Client');
        return HttpResponse.json({ plan: after, movements: [], entity: after.projects[0] }, { status: 201 });
      }),
    );
    const { result, client } = renderWithClient(() => useCreateProject());
    client.setQueryData(keys.plan, before);

    await act(() => result.current.mutateAsync({ domain: 'fi', name: null }));

    expect(body).toEqual({ domain: 'fi', name: null });
    expect(clientHeader).toBe('1');
    const cached = client.getQueryData<PlanOut>(keys.plan);
    expect(cached?.counts.projects).toBe(2);
    expect(cached?.routines).toBe(before.routines);
    expect(usePlanMoves.getState().flash).toEqual({});
  });

  it('delete project: surfaces the error envelope and leaves the plan alone', async () => {
    server.use(http.delete('*/api/projects/:projectId', () => errorResponse(404, 'NOT_FOUND', 'No such project.')));
    const before = fixturePlan();
    const { result, client } = renderWithClient(() => useDeleteProject());
    client.setQueryData(keys.plan, before);
    await act(async () => {
      await result.current.mutateAsync({ projectId: 'gone' }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
    expect(client.getQueryData(keys.plan)).toBe(before);
  });

  it('delete project: drops the project\'s own reads instead of refetching them (no 404)', async () => {
    const before = fixturePlan();
    const after = { ...before, revision: 2, projects: before.projects.filter((p) => p.id !== 'ret') };
    let snapshotFetches = 0;
    server.use(
      http.delete('*/api/projects/:projectId', () => HttpResponse.json({ plan: after, movements: [] })),
      http.get('*/api/projects/:projectId/snapshots', () => {
        snapshotFetches += 1;
        return errorResponse(404, 'NOT_FOUND', 'No such project.');
      }),
    );
    const { result, client } = renderWithClient(() => useDeleteProject());
    client.setQueryData(keys.plan, before);
    client.setQueryData(keys.projects.snapshots('ret'), []);
    client.setQueryData(keys.projects.snapshots('manco'), []);
    client.setQueryData(keys.projects.detail('ret'), { id: 'ret' });

    await act(() => result.current.mutateAsync({ projectId: 'ret' }));

    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(2);
    expect(client.getQueryState(keys.projects.snapshots('ret'))).toBeUndefined();
    expect(client.getQueryState(keys.projects.detail('ret'))).toBeUndefined();
    // Other projects' reads are still refreshed as usual.
    expect(client.getQueryState(keys.projects.snapshots('manco'))?.isInvalidated).toBe(true);
    expect(snapshotFetches).toBe(0);
  });

  it('checklist tick: PUTs to the run item and refreshes the day and month snapshot', async () => {
    const before = fixturePlan();
    const after = { ...before, revision: 2 };
    let path = '';
    let body: unknown = null;
    server.use(
      http.put('*/api/routines/:routineId/runs/:iso/items/:itemId', async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({
          plan: after,
          movements: [],
          entity: {
            routineId: 'r-ret',
            occurrenceDate: '2026-10-05',
            completed: false,
            completedAt: null,
            completedOn: null,
            done: false,
            itemCount: 3,
            tickedItemIds: ['i1'],
          },
        });
      }),
    );
    const { result, client } = renderWithClient(() => usePutRunTick());
    client.setQueryData(keys.plan, before);
    client.setQueryData(keys.day.detail('2026-10-05'), { cached: true });
    client.setQueryData(keys.monthSnapshot.detail(null), { cached: true });
    client.setQueryData(keys.textbook.tree, { cached: true });

    await act(() => result.current.mutateAsync({ routineId: 'r-ret', iso: '2026-10-05', itemId: 'i1', done: true }));

    expect(path).toBe('/api/routines/r-ret/runs/2026-10-05/items/i1');
    expect(body).toEqual({ done: true });
    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(2);
    expect(client.getQueryState(keys.day.detail('2026-10-05'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.monthSnapshot.detail(null))?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.textbook.tree)?.isInvalidated).toBe(false);
  });
  it('renaming a project or deleting a routine refreshes the notes (tags are resolved from names)', async () => {
    const before = fixturePlan();
    const after = { ...before, revision: 2 };
    server.use(
      http.patch('*/api/projects/:projectId', () => HttpResponse.json({ plan: after, movements: [], entity: after.projects[0] })),
      http.delete('*/api/routines/:routineId', () => HttpResponse.json({ plan: { ...after, revision: 3 }, movements: [] })),
    );
    const { result, client } = renderWithClient(() => ({ rename: useUpdateProject(), remove: useDeleteRoutine() }));
    const seed = () => {
      client.setQueryData(keys.notes.day('2026-10-05'), { cached: true });
      client.setQueryData(keys.notes.recent(null), { cached: true });
      client.setQueryData(keys.notes.tags('ret'), { cached: true });
      client.setQueryData(keys.aliases, { cached: true });
    };
    const stale = () =>
      [keys.notes.day('2026-10-05'), keys.notes.recent(null), keys.notes.tags('ret'), keys.aliases].map(
        (key) => client.getQueryState(key)?.isInvalidated,
      );
    client.setQueryData(keys.plan, before);

    seed();
    await act(() => result.current.rename.mutateAsync({ projectId: 'ret', patch: { name: 'Returns engine' } }));
    expect(stale()).toEqual([true, true, true, true]);

    seed();
    await act(() => result.current.remove.mutateAsync({ routineId: 'r-ret' }));
    expect(stale()).toEqual([true, true, true, true]);
  });

  it('the AI key does not outlive the component in the mutation cache', async () => {
    server.use(http.put('*/api/settings/ai-key', () => HttpResponse.json(fixtureAiStatus({ keySet: true }))));
    const { result, client, unmount } = renderWithClient(() => usePutAiKey());
    await act(() => result.current.mutateAsync({ apiKey: 'sk-ant-secret' }));
    unmount();
    await waitFor(() => {
      expect(client.getMutationCache().getAll()).toHaveLength(0);
    });
  });

  it('UI prefs: optimistic, no invalidation, and the answer\'s settings stored', async () => {
    const before = fixturePlan();
    const settings = fixtureSettings();
    let body: unknown = null;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch('*/api/settings', async ({ request }) => {
        body = await request.json();
        await gate;
        const entity: SettingsOut = { ...settings, uiPrefs: { ...settings.uiPrefs, textbookSidebarOpen: false } };
        return HttpResponse.json({ plan: { ...before, revision: 2 }, movements: [], entity });
      }),
    );
    const { result, client } = renderWithClient(() => useUpdateUiPrefs());
    client.setQueryData(keys.plan, before);
    client.setQueryData(keys.settings, settings);
    client.setQueryData(keys.day.detail('2026-10-05'), { cached: true });
    client.setQueryData(keys.textbook.tree, { cached: true });

    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = result.current.mutateAsync({ textbookSidebarOpen: false });
    });
    await waitFor(() => {
      expect(client.getQueryData<SettingsOut>(keys.settings)?.uiPrefs.textbookSidebarOpen).toBe(false);
    });
    release();
    await act(() => done);

    expect(body).toEqual({ uiPrefs: { textbookSidebarOpen: false } });
    expect(client.getQueryData<PlanOut>(keys.plan)?.revision).toBe(2);
    expect(client.getQueryData<SettingsOut>(keys.settings)?.uiPrefs.textbookSidebarOpen).toBe(false);
    expect(client.getQueryState(keys.day.detail('2026-10-05'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(keys.textbook.tree)?.isInvalidated).toBe(false);
  });

  it('UI prefs: a null resets a preference to its default, as the server does', () => {
    const prefs = { collapsedPageIds: ['a'], lastTextbookPageId: 'p', textbookSidebarOpen: false, timelineZoom: '2w' as const };
    expect(mergeUiPrefs(prefs, { collapsedPageIds: ['b'], lastTextbookPageId: null })).toEqual({
      collapsedPageIds: ['b'],
      lastTextbookPageId: null,
      textbookSidebarOpen: false,
      timelineZoom: '2w',
    });
    expect(mergeUiPrefs(prefs, { textbookSidebarOpen: null, timelineZoom: null })).toMatchObject({
      textbookSidebarOpen: true,
      timelineZoom: '3m',
    });
  });
});

describe('stale writes (another tab deleted or changed the thing)', () => {
  it('a 404 refetches the plan at once, so the deleted item leaves the screen', async () => {
    const before = fixturePlan();
    // Another tab deleted the Returns pipeline project (and its tasks) since this tab read the plan.
    const after: PlanOut = { ...before, revision: before.revision + 1, projects: before.projects.filter((p) => p.id !== 'ret') };
    server.use(http.patch('*/api/tasks/:taskId', () => errorResponse(404, 'NOT_FOUND', 'No such task.')));
    const { result } = renderWithClient(() => ({ plan: usePlan(), update: useUpdateTask() }));
    await waitFor(() => {
      expect(result.current.plan.data?.revision).toBe(before.revision);
    });
    mock.api.state.plan = after;
    const reads = mock.api.requestsTo('/api/plan', 'GET').length;

    await act(async () => {
      await result.current.update.mutateAsync({ taskId: 'ret-1', patch: { done: true } }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.plan.data?.revision).toBe(after.revision);
    });
    expect(mock.api.requestsTo('/api/plan', 'GET').length).toBe(reads + 1);
    expect(result.current.plan.data?.projects.some((p) => p.id === 'ret')).toBe(false);
    expect(result.current.update.error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('a refused value that is not stale (422) does not refetch', async () => {
    server.use(http.patch('*/api/tasks/:taskId', () => errorResponse(422, 'VALIDATION_ERROR', 'Hours must be positive.')));
    const { result } = renderWithClient(() => ({ plan: usePlan(), update: useUpdateTask() }));
    await waitFor(() => {
      expect(result.current.plan.data).toBeDefined();
    });
    const reads = mock.api.requestsTo('/api/plan', 'GET').length;
    await act(async () => {
      await result.current.update.mutateAsync({ taskId: 'ret-1', patch: { hours: -1 } }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.update.isError).toBe(true);
    });
    expect(mock.api.requestsTo('/api/plan', 'GET').length).toBe(reads);
  });

  it('a textbook write to a page deleted elsewhere refetches the textbook reads on screen', async () => {
    server.use(http.patch('*/api/textbook/pages/:pageId', () => errorResponse(404, 'NOT_FOUND', 'No such page.')));
    const { result, client } = renderWithClient(() => useUpdatePage());
    client.setQueryData(keys.textbook.tree, { sections: [] });
    await act(async () => {
      await result.current.mutateAsync({ pageId: 'gone', title: 'Renamed' }).catch(() => undefined);
    });
    await waitFor(() => {
      expect(client.getQueryState(keys.textbook.tree)?.isInvalidated).toBe(true);
    });
  });

  it('names the stale cases and gives them their own copy', () => {
    const err = (status: number, code: string) => new RemiApiError({ status, code, message: 'x' });
    expect(isStaleWrite(err(404, 'NOT_FOUND'))).toBe(true);
    expect(isStaleWrite(err(409, 'VERSION_CONFLICT'))).toBe(true);
    expect(isStaleWrite(err(412, 'HTTP_ERROR'))).toBe(true);
    expect(isStaleWrite(err(422, 'VALIDATION_ERROR'))).toBe(false);
    expect(isStaleWrite(err(0, 'NETWORK_ERROR'))).toBe(false);
    expect(isStaleWrite(new Error('boom'))).toBe(false);
    expect(staleWriteMessage(err(404, 'NOT_FOUND'))).toBe(STALE_WRITE_MESSAGE);
    expect(staleWriteMessage(err(409, 'VERSION_CONFLICT'))).toBe(STALE_WRITE_MESSAGE);
    // A refused value keeps the server's reason ("Ticking opens on the day of the run").
    expect(staleWriteMessage(err(409, 'RUN_NOT_EDITABLE'))).toBeNull();
    expect(staleWriteMessage(err(500, 'HTTP_ERROR'))).toBeNull();
  });
});
