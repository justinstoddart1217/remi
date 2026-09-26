import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { useHover } from '../../stores/hover';
import {
  createTestQueryClient,
  errorResponse,
  fixturePlan,
  fixtureMutationOut,
  server,
  setupMockApi,
} from '../../test/msw';
import TodayScreen from '.';
import type { DayOut, MonthSnapshotOut, MonthSnapshotRowOut } from './types';

setupMockApi();

const FUNDS = ['Senior Direct Lending I', 'Senior Direct Lending II', 'Unitranche Partners'];

function dayOf(iso: string, ticked: ReadonlySet<string>, doneTasks: ReadonlySet<string>): DayOut {
  if (iso === '2026-10-06') {
    return {
      day: iso,
      isToday: false,
      aheadBd: 1,
      w: 2,
      bdm: 4,
      monthBds: 22,
      holiday: null,
      load: {
        items: [{ refType: 'project', refId: 'ret', domain: 'pc', h: 3, name: 'Returns pipeline' }],
        bau: 0,
        proj: 3,
        total: 3,
        free: 5,
        capacity: 8,
        over: false,
      },
      bauRows: [],
      focusBlocks: [],
      nextRunAfter: { routineId: 'r-ret', date: '2026-11-04', afterMove: false },
    };
  }
  const checklist = FUNDS.map((label, k) => ({ id: `f${String(k)}`, label, done: ticked.has(`f${String(k)}`) }));
  return {
    day: '2026-10-05',
    isToday: true,
    aheadBd: 0,
    w: 1,
    bdm: 3,
    monthBds: 22,
    holiday: null,
    load: {
      items: [
        { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
        { refType: 'project', refId: 'ret', domain: 'pc', h: 2, name: 'Returns pipeline' },
      ],
      bau: 6,
      proj: 2,
      total: 8,
      free: 0,
      capacity: 8,
      over: false,
    },
    bauRows: [
      {
        kind: 'routine',
        routineId: 'r-ret',
        rotation: null,
        name: 'Fund & security-level returns',
        short: 'Returns',
        domain: 'pc',
        hours: 6,
        stage: 0,
        run: {
          routineId: 'r-ret',
          occurrenceDate: '2026-10-05',
          completed: false,
          completedOn: null,
          completedAt: null,
          tickedItemIds: [...ticked],
          itemCount: 3,
          done: ticked.size === 3,
        },
        checklist,
        editable: true,
        done: ticked.size === 3,
      },
    ],
    focusBlocks: [
      {
        projectId: 'ret',
        hours: 2,
        offsetH: 0,
        tasks: [
          { id: 't1', milestoneId: 'm1', text: 'Parse and validate the extract', hours: 1.5, done: doneTasks.has('t1'), doneOn: null, dueDate: null },
          { id: 't2', milestoneId: 'm1', text: 'Map source files', hours: 0.5, done: false, doneOn: null, dueDate: null },
        ],
        emptyReason: null,
        nextMilestone: { milestoneId: 'm1', name: 'Security-level data feed connected', date: '2026-10-15', dueThisDay: false },
      },
    ],
    nextRunAfter: null,
  };
}

function monthRow(key: string, due: string, extra: Partial<MonthSnapshotRowOut> = {}): MonthSnapshotRowOut {
  const id = key.split(':')[1] ?? key;
  return {
    key,
    kind: 'task',
    text: `Task ${id}`,
    sub: 'Returns pipeline',
    due,
    done: false,
    doneOn: null,
    late: false,
    domain: 'pc',
    projectId: 'ret',
    routineId: null,
    occurrenceDate: null,
    taskId: id,
    milestoneId: null,
    hasChecklist: false,
    ...extra,
  };
}

const MONTH: MonthSnapshotOut = {
  month: '2026-10',
  from: '2026-10-01',
  to: '2026-10-30',
  today: '2026-10-05',
  totals: { total: 8, done: 1, late: 1 },
  bars: [
    { iso: '2026-10-01', plan: 0, done: 1, late: 0, past: true },
    { iso: '2026-10-02', plan: 1, done: 1, late: 0, past: true },
    { iso: '2026-10-05', plan: 2, done: 1, late: 1, past: true },
    { iso: '2026-10-06', plan: 8, done: 0, late: 0, past: false },
  ],
  rows: [
    monthRow('bau:r-ret:2026-10-05', '2026-10-05', {
      kind: 'bau',
      text: 'Fund & security-level returns',
      sub: 'BD3',
      routineId: 'r-ret',
      occurrenceDate: '2026-10-05',
      taskId: null,
      hasChecklist: true,
    }),
    monthRow('task:a', '2026-10-02', { late: true }),
    monthRow('task:b', '2026-10-15'),
    monthRow('task:c', '2026-10-16'),
    monthRow('task:d', '2026-10-16'),
    monthRow('task:e', '2026-10-16'),
    monthRow('task:f', '2026-10-16'),
    monthRow('task:g', '2026-10-15', { done: true, doneOn: '2026-10-01' }),
  ],
};

interface ApiState {
  puts: string[];
  ticked: Set<string>;
  doneTasks: Set<string>;
  failTasks: boolean;
}

function mockToday(): ApiState {
  const state: ApiState = { puts: [], ticked: new Set(['f0']), doneTasks: new Set(), failTasks: false };
  server.use(
    http.get('*/api/day/:iso', ({ params }) => HttpResponse.json(dayOf(String(params.iso), state.ticked, state.doneTasks))),
    http.get('*/api/month-snapshot', () => HttpResponse.json(MONTH)),
    http.put('*/api/routines/:rid/runs/:iso/items/:item', async ({ params, request }) => {
      const body = (await request.json()) as { done: boolean };
      state.puts.push(`${String(params.rid)}/${String(params.iso)}/${String(params.item)}:${String(body.done)}`);
      if (body.done) state.ticked.add(String(params.item));
      else state.ticked.delete(String(params.item));
      return HttpResponse.json(fixtureMutationOut(fixturePlan({ revision: 2 })));
    }),
    http.patch('*/api/tasks/:id', async ({ params, request }) => {
      if (state.failTasks) return errorResponse(501, 'NOT_IMPLEMENTED');
      const body = (await request.json()) as { done: boolean };
      if (body.done) state.doneTasks.add(String(params.id));
      return HttpResponse.json(fixtureMutationOut(fixturePlan({ revision: 3 })));
    }),
  );
  return state;
}

/** The value a Roll inside `el` reads as (its sizer text; the strip is aria-hidden). */
function rollValue(el: Element): string | null | undefined {
  return el.querySelector('[data-roll]')?.firstElementChild?.textContent;
}

function renderToday(path = '/app/today') {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/app/today/:day?', element: <TodayScreen /> },
      { path: '/app/routines', element: <p>Routines page</p> },
      { path: '/app/projects/:projectId', element: <p>Workspace page</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

afterEach(() => {
  useHover.getState().clear();
});

describe('Today screen', () => {
  it('shows the day: header, capacity, the checklist run, a focus block, the week and the month', async () => {
    mockToday();
    renderToday();
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    expect(screen.getByText('BD3 of 22')).toBeInTheDocument();
    expect(screen.getByText('Move on track, narrowly')).toBeInTheDocument();
    expect(screen.getByText('8h of 8h planned · 0h free')).toBeInTheDocument();
    expect(screen.getByText('BD3, monthly')).toBeInTheDocument();
    const runCount = screen.getByText('of 3 items').parentElement;
    if (!runCount) throw new Error('run count not found');
    // The Roll reads as plain text: its value, once (the rolling strip is aria-hidden).
    expect(rollValue(runCount)).toBe('1');
    expect(screen.getByRole('checkbox', { name: 'Senior Direct Lending I' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Next milestone: Security-level data feed connected · Thu 15 Oct')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('5–9 Oct · pick a day to preview it')).toBeInTheDocument();
    expect(await screen.findByText('October so far')).toBeInTheDocument();
    expect(screen.getByText('· 1 overdue')).toBeInTheDocument();
    expect(screen.getByText('overdue 1 BD')).toBeInTheDocument();
    expect(screen.getAllByText('today')).toHaveLength(2);
  });

  it('ticks a fund at once and keeps it once the server has it', async () => {
    const api = mockToday();
    renderToday();
    const fund = await screen.findByRole('checkbox', { name: 'Unitranche Partners' });
    fireEvent.click(fund);
    expect(fund).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(api.ticked.has('f2')).toBe(true);
    });
    const runCount = screen.getByText('of 3 items').parentElement;
    if (!runCount) throw new Error('run count not found');
    await waitFor(() => {
      expect(rollValue(runCount)).toBe('2');
    });
    expect(screen.getByRole('checkbox', { name: 'Unitranche Partners' })).toHaveAttribute('aria-checked', 'true');
    expect(api.puts).toEqual(['r-ret/2026-10-05/f2:true']);
  });

  it('reverts a task tick the server refuses, and says so', async () => {
    const api = mockToday();
    api.failTasks = true;
    renderToday();
    const task = await screen.findByRole('checkbox', { name: /Parse and validate the extract/ });
    fireEvent.click(task);
    expect(task).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(task).toHaveAttribute('aria-checked', 'false');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t save that. Try again.');
  });

  it('previews another day from the week strip, and comes back', async () => {
    mockToday();
    const { router } = renderToday();
    const tue = await screen.findByRole('button', { name: /^Tue 6,/ });
    fireEvent.click(tue);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today/2026-10-06');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tuesday 6 October' })).toBeInTheDocument();
    expect(screen.getByText('Tomorrow · preview')).toBeInTheDocument();
    expect(screen.getByText('Tuesday’s plan')).toBeInTheDocument();
    expect(screen.getByText('No BAU on this day. The next run is Wed 4 Nov.')).toBeInTheDocument();
    expect(screen.getByText('No focus blocks. Give a project hours a day and it appears here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Tue 6,/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/today');
  });

  it.each(['2026-10-10', 'garbage', '2026-10-05'])('falls back to today for %s in the URL, and says so in the address', async (seg) => {
    mockToday();
    const { router } = renderToday(`/app/today/${seg}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Monday 5 October' })).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today');
    });
    expect(router.state.historyAction).toBe('REPLACE');
    // Today's card is live again: picking another day and coming back works.
    fireEvent.click(screen.getByRole('button', { name: /^Tue 6,/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today/2026-10-06');
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Mon 5,/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today');
    });
  });

  it('with nothing due this month, says so once per group and adds no empty count of its own', async () => {
    mockToday();
    server.use(
      http.get('*/api/month-snapshot', () => HttpResponse.json({ ...MONTH, totals: { total: 0, done: 0, late: 0 }, bars: [], rows: [] })),
    );
    renderToday();
    expect(await screen.findByText('October so far')).toBeInTheDocument();
    expect(await screen.findAllByText('Nothing due this month.')).toHaveLength(2);
    expect(screen.queryByText('Nothing due yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/of 0 done/)).not.toBeInTheDocument();
  });

  it('expands and collapses a month group', async () => {
    mockToday();
    renderToday();
    const more = await screen.findByRole('button', { name: 'Show 1 more and 1 done' });
    expect(screen.queryByText('Task f')).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByText('Task f')).toBeInTheDocument();
    expect(screen.getByText('done 1 Oct')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Task f')).not.toBeInTheDocument();
  });

  it('dims everything but the hovered project, to the one --linked-dim value', async () => {
    mockToday();
    renderToday();
    await screen.findByText('Today’s plan');
    const row = (text: string) => screen.getByText(text, { exact: false }).closest('[class*="_row_"]');
    const block = row('Security-level data feed connected');
    const fundCard = row('BD3, monthly');
    if (!block || !fundCard) throw new Error('rows not found');
    act(() => {
      fireEvent.mouseEnter(block);
    });
    expect(useHover.getState().key).toEqual({ type: 'project', id: 'ret' });
    // [data-dim='true'] { opacity: var(--linked-dim) } (styles/motion.css), never a per-screen opacity.
    expect(fundCard).toHaveAttribute('data-dim', 'true');
    expect(fundCard).not.toHaveAttribute('style');
    expect(block).not.toHaveAttribute('data-dim');
    act(() => {
      fireEvent.mouseLeave(block);
    });
    expect(fundCard).not.toHaveAttribute('data-dim');
  });

  it('opens the routine and the workspace', async () => {
    mockToday();
    const { router } = renderToday();
    const plan = await screen.findByText('Today’s plan');
    const list = plan.closest('div')?.parentElement;
    if (!list) throw new Error('plan not found');
    fireEvent.click(within(list).getByRole('button', { name: /Routine/ }));
    await waitFor(() => {
      expect(router.state.location.pathname + router.state.location.search).toBe('/app/routines?focus=r-ret');
    });
  });
});
