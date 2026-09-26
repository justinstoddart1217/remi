import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { DayOut } from '../../api';
import { useHover } from '../../stores/hover';
import { useOverlays } from '../../stores/overlays';
import { createTestQueryClient, errorResponse, fixturePlan, server, setupMockApi } from '../../test/msw';
import CalendarScreen from '.';

const mock = setupMockApi();

function day(iso: string, overrides: Partial<DayOut> = {}): DayOut {
  return {
    day: iso,
    isToday: iso === '2026-10-05',
    aheadBd: 0,
    w: 1,
    bdm: 3,
    monthBds: 22,
    holiday: null,
    load: null,
    bauRows: [],
    focusBlocks: [],
    nextRunAfter: null,
    ...overrides,
  };
}

function renderCalendar(path = '/app/calendar') {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/app/calendar/:month?', element: <CalendarScreen /> },
      { path: '/app/today/:day?', element: <p>Today page</p> },
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

const panel = () => screen.getByRole('complementary', { name: 'Day plan', hidden: true });
const cell = (label: RegExp) => screen.getByRole('button', { name: label });

afterEach(() => {
  useHover.getState().clear();
  useOverlays.setState({ stack: [], drawer: { open: false, projectId: null, session: 0, prefill: null } });
});

describe('Calendar screen', () => {
  it('shows today’s month with business-day numbers, chips, bars and meters', async () => {
    const { router } = renderCalendar();
    expect(await screen.findByRole('heading', { level: 1, name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByText('22 business days')).toBeInTheDocument();
    const today = cell(/^Monday 5 October, BD3/);
    expect(within(today).getByText('Monthly returns run · 6h')).toBeInTheDocument();
    expect(within(today).getByText('returns 2h')).toBeInTheDocument();
    expect(within(today).getByText('8h')).toBeInTheDocument();
    expect(within(today).getByTitle('Returns pipeline · 2h')).toBeInTheDocument();
    // The URL carries the month, so the rail returns here.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/calendar/2026-10');
    });
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveAttribute('data-end', 'true');
  });

  it('switches months with the fade and clears the day', async () => {
    const { router } = renderCalendar('/app/calendar/2026-10?day=2026-10-14');
    expect(await screen.findByRole('heading', { level: 1, name: 'October 2026' })).toBeInTheDocument();
    const aside = panel();
    expect(aside).toHaveAttribute('data-open', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(document.querySelector('[data-fading="true"]')).not.toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByText('21 business days · 1 overloaded')).toBeInTheDocument();
    expect(aside).toHaveAttribute('data-open', 'false');
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/app/calendar/2026-11');
    });
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'October 2026' })).toBeInTheDocument();
  });

  it('opens a day from a deep link, with the overload and what is due', async () => {
    server.use(http.get('*/api/day/:iso', ({ params }) => HttpResponse.json(day(String(params.iso), { aheadBd: 22 }))));
    renderCalendar('/app/calendar/2026-11?day=2026-11-04');
    expect(await screen.findByRole('heading', { level: 1, name: 'November 2026' })).toBeInTheDocument();
    const aside = panel();
    expect(aside).toHaveAttribute('data-open', 'true');
    expect(within(aside).getByText('22 business days ahead')).toBeInTheDocument();
    expect(within(aside).getByRole('heading', { level: 2, name: 'Wednesday 4 November', hidden: true })).toBeInTheDocument();
    expect(within(aside).getByText('BD3 of November')).toBeInTheDocument();
    expect(within(aside).getByText('9.5h planned · 1.5h over')).toBeInTheDocument();
    expect(within(aside).getByText('BAU · Private Credit')).toBeInTheDocument();
    expect(within(aside).getByText('Monthly returns run')).toBeInTheDocument();
    expect(cell(/^Wednesday 4 November/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists the tasks the plan expects on a day, and opens the project', async () => {
    server.use(
      http.get('*/api/day/:iso', ({ params }) =>
        HttpResponse.json(
          day(String(params.iso), {
            focusBlocks: [
              {
                projectId: 'ret',
                hours: 2,
                offsetH: 0,
                emptyReason: null,
                nextMilestone: null,
                tasks: [
                  { id: 't1', text: 'Parse the extract', hours: 0.5, done: false, doneOn: null, dueDate: null, milestoneId: 'm1' },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const { router } = renderCalendar('/app/calendar/2026-10?day=2026-10-05');
    const aside = await waitFor(() => panel());
    expect(await within(aside).findByText('Parse the extract')).toBeInTheDocument();
    expect(within(aside).getByText('Today')).toBeInTheDocument();
    expect(within(aside).getByText('8h of 8h · 0h free')).toBeInTheDocument();
    fireEvent.click(within(aside).getByRole('button', { name: /Returns pipeline/, hidden: true }));
    expect(await screen.findByText('Workspace page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/projects/ret');
  });

  it('toggles a day on click, steps business days and closes from the Escape stack', async () => {
    server.use(http.get('*/api/day/:iso', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    renderCalendar();
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    fireEvent.click(cell(/^Friday 9 October/));
    const aside = panel();
    expect(aside).toHaveAttribute('data-open', 'true');
    expect(within(aside).getByText('4 business days ahead')).toBeInTheDocument();
    expect(useOverlays.getState().stack).toContain('calendar-panel');

    fireEvent.click(within(aside).getByRole('button', { name: 'Next day', hidden: true }));
    expect(within(aside).getByText('Monday 12 October')).toBeInTheDocument();
    fireEvent.click(within(aside).getByRole('button', { name: 'Previous day', hidden: true }));
    expect(within(aside).getByText('Friday 9 October')).toBeInTheDocument();

    fireEvent.click(cell(/^Saturday 10 October/));
    expect(within(aside).getByText('Weekend. Nothing is planned.')).toBeInTheDocument();
    expect(within(aside).getByText('Not a business day')).toBeInTheDocument();
    expect(within(aside).queryByRole('button', { name: 'Open the day’s plan in Today', hidden: true })).toBeNull();

    act(() => {
      useOverlays.getState().closeTop();
    });
    expect(aside).toHaveAttribute('data-open', 'false');
    expect(useOverlays.getState().stack).not.toContain('calendar-panel');

    fireEvent.click(cell(/^Wednesday 14 October/));
    fireEvent.click(cell(/^Wednesday 14 October/));
    expect(aside).toHaveAttribute('data-open', 'false');
  });

  it('steps from the last business day of a month into the next', async () => {
    server.use(http.get('*/api/day/:iso', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    renderCalendar('/app/calendar/2026-10?day=2026-10-30');
    const aside = await waitFor(() => panel());
    fireEvent.click(within(aside).getByRole('button', { name: 'Next day', hidden: true }));
    expect(screen.getByRole('heading', { level: 1, name: 'November 2026' })).toBeInTheDocument();
    expect(within(aside).getByText('Monday 2 November')).toBeInTheDocument();
  });

  it('opens the day in Today', async () => {
    server.use(http.get('*/api/day/:iso', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    const { router } = renderCalendar('/app/calendar/2026-11?day=2026-11-04');
    const aside = await waitFor(() => panel());
    fireEvent.click(within(aside).getByRole('button', { name: 'Open the day’s plan in Today', hidden: true }));
    expect(await screen.findByText('Today page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/today/2026-11-04');
  });

  it('shows a holiday and the free-day copy', async () => {
    const plan = fixturePlan();
    mock.api.state.plan = {
      ...plan,
      loads: { ...plan.loads, '2026-12-24': { items: [], bau: 0, proj: 0, total: 0, free: 8, capacity: 8, over: false } },
    };
    server.use(http.get('*/api/day/:iso', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    renderCalendar('/app/calendar/2026-12?day=2026-12-25');
    const aside = await waitFor(() => panel());
    expect(within(aside).getByText('Bank holiday')).toBeInTheDocument();
    expect(within(aside).getByText('Christmas Day. Nothing is planned, and business-day numbers skip it.')).toBeInTheDocument();
    fireEvent.click(within(aside).getByRole('button', { name: 'Previous day', hidden: true }));
    expect(within(aside).getByText('Thursday 24 December')).toBeInTheDocument();
    expect(within(aside).getByText('Nothing planned. A free day.')).toBeInTheDocument();
    expect(within(aside).getByText('0h of 8h · 8h free')).toBeInTheDocument();
  });

  it('dims everything else while a project is hovered', async () => {
    renderCalendar();
    await screen.findByRole('heading', { level: 1, name: 'October 2026' });
    const bar = within(cell(/^Monday 5 October/)).getByTitle('Returns pipeline · 2h');
    fireEvent.mouseEnter(bar);
    expect(useHover.getState().key).toEqual({ type: 'project', id: 'ret' });
    expect(bar).toHaveAttribute('data-dim', 'false');
    const chip = within(cell(/^Monday 5 October/)).getByText('Monthly returns run · 6h');
    // BauChip dims itself to --linked-dim through [data-dim].
    expect(chip).toHaveAttribute('data-dim', '');
    fireEvent.mouseLeave(bar);
    expect(useHover.getState().key).toBeNull();
  });

  it('reads months past the plan window from the calendar and loads endpoints', async () => {
    server.use(
      http.get('*/api/calendar', ({ request }) => {
        const url = new URL(request.url);
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        const days = [];
        for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          const w = d.getUTCDay();
          days.push({ iso, w, bd: w > 0 && w < 6, bdm: null, hol: null, week: 1 });
        }
        return HttpResponse.json({ from, to, region: 'GB-ENG', days });
      }),
      http.get('*/api/loads', () =>
        HttpResponse.json({
          from: '2027-02-01',
          to: '2027-02-28',
          capacity: 8,
          loads: { '2027-02-15': { items: [], bau: 0, proj: 0, total: 3, free: 5, capacity: 8, over: false } },
        }),
      ),
    );
    renderCalendar('/app/calendar/2027-02');
    expect(await screen.findByRole('heading', { level: 1, name: 'February 2027' })).toBeInTheDocument();
    const feb15 = await screen.findByRole('button', { name: /^Monday 15 February, 3h planned/ });
    expect(within(feb15).getByText('3h')).toBeInTheDocument();
  });

  it('says so when the plan cannot be read', async () => {
    mock.api.state.plan = null;
    server.use(http.get('*/api/plan', () => errorResponse(500, 'INTERNAL', 'Boom')));
    renderCalendar();
    expect(await screen.findByText(/The plan could not be loaded\./, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
