import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { ScreenActivityContext } from '../../lib/arrival';
import { useHover } from '../../stores/hover';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { createTestQueryClient, fixturePlan, fixtureProject, fixtureRotation, setupMockApi } from '../../test/msw';
import TimelineScreen from '.';
import s from './Timeline.module.css';

const mock = setupMockApi();

function renderTimeline(path = '/app/timeline') {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/app/timeline', element: <TimelineScreen /> },
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

/** The Timeline as one ScreenStack section: `stack.setActive` shows or hides it, as a route change does. */
const stack: { setActive: (active: boolean) => void } = { setActive: () => undefined };
function StackedTimeline() {
  const [active, set] = useState(true);
  useEffect(() => {
    stack.setActive = set;
  }, []);
  return (
    <ScreenActivityContext.Provider value={{ screen: 'timeline', active }}>
      <TimelineScreen />
    </ScreenActivityContext.Provider>
  );
}

function panel() {
  return screen.findByRole('complementary', { name: 'Project details', hidden: true });
}

afterEach(() => {
  useUi.setState({ zoom: '3m', zoomWeek: 0 });
  useHover.getState().clear();
  useOverlays.setState({ stack: [], drawer: { open: false, projectId: null, session: 0, prefill: null } });
});

describe('Timeline screen', () => {
  it('lays out the window, the lanes and the empty Fixed Income lanes', async () => {
    renderTimeline();
    expect(await screen.findByText('28 Sep 2026 – 15 Jan 2027 · 77 business days')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Three months' })).toBeInTheDocument();
    for (const label of ['Private Credit · BAU', 'Private Credit · Projects', 'Fixed Income · BAU', 'Fixed Income · Projects']) {
      expect(screen.getByRole('heading', { level: 2, name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('Monthly returns run')).toBeInTheDocument();
    expect(screen.getByText('BD3 · 6h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Returns pipeline: Wed 2 Dec, \+3 BD/ })).toBeInTheDocument();
    expect(screen.getByText('No rotation set up.')).toBeInTheDocument();
    expect(screen.getByText('No Fixed Income projects yet.')).toBeInTheDocument();
    expect(screen.getByText('FI move · Mon 4 Jan')).toBeInTheDocument();
  });

  it('shows the start-empty copy for a plan with nothing in it', async () => {
    mock.api.state.plan = fixturePlan({ projects: [], routines: [], loads: {} });
    renderTimeline();
    expect(await screen.findByText('No routines yet.')).toBeInTheDocument();
    expect(screen.getByText('No Private Credit projects yet.')).toBeInTheDocument();
    expect(screen.getByText('No Fixed Income projects yet.')).toBeInTheDocument();
  });

  it('dims everything else and shows the tip while a row is hovered', async () => {
    renderTimeline();
    const row = await screen.findByRole('button', { name: /^Returns pipeline:/ });
    fireEvent.mouseEnter(row, { clientX: 500, clientY: 500 });
    expect(useHover.getState().key).toEqual({ type: 'project', id: 'ret' });
    expect(row).toHaveAttribute('data-hovered', 'true');
    const routine = screen.getByText('Monthly returns run').closest('[data-dim]');
    expect(routine).toHaveAttribute('data-dim', 'true');
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveTextContent('Forecast Wed 2 Dec · target Fri 27 Nov');
    fireEvent.mouseLeave(row);
    expect(useHover.getState().key).toBeNull();
    expect(routine).toHaveAttribute('data-dim', 'false');
  });

  it('names the BAU rows it puts in the tab order, and describes them by their tip', async () => {
    renderTimeline();
    const routine = await screen.findByRole('group', { name: /^Monthly returns run, / });
    expect(routine).toHaveAttribute('tabindex', '0');
    const desc = document.getElementById(routine.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toMatch(/business day/);
    // Hidden from the page's own text: only assistive tech reads it.
    expect(desc).toHaveAttribute('hidden');
  });

  it('carries the parity anchors the harness drives (parity/README.md, driver contract)', async () => {
    const segment = (id: string, order: number, start: string, end: string) => ({
      id,
      order,
      code: id.toUpperCase(),
      country: id === 'de' ? 'Germany' : 'France',
      pass: 'Build' as const,
      loop: 1,
      lengthBd: 5,
      start,
      end,
    });
    mock.api.state.plan = fixturePlan({
      rotation: fixtureRotation({
        startDate: '2026-10-12',
        segments: [segment('de', 0, '2026-10-12', '2026-10-16'), segment('fr', 1, '2026-10-19', '2026-10-23')],
      }),
    });
    renderTimeline();
    const row = await screen.findByRole('button', { name: /^Returns pipeline:/ });
    // The shell's screen stack adds the [data-screen-label="Timeline"] region around the screen.
    const region = document.body;
    expect(region.querySelector('[data-parity="timeline-row:ret"]')).toBe(row);
    // The bar anchor is the forecast bar itself, in the row's lane, after the ghost bar.
    const bar = row.querySelector<HTMLElement>('[data-parity="timeline-bar:ret"]');
    expect(bar?.parentElement).toBe(row.children[1]);
    expect(bar?.previousElementSibling).toBe(row.children[1]?.firstElementChild);
    expect(bar?.style.top).toBe('26px');
    expect(bar?.style.height).toBe('10px');
    // The rotation lane is the row's track (the prototype's row.children[1]), one anchor per stop.
    const lane = region.querySelector('[data-parity="timeline-rotation"]');
    expect(lane).toBe(screen.getByText('Fixed Income rotation').parentElement?.parentElement?.children[1]);
    const segs = lane?.querySelectorAll('[data-parity="timeline-rotation-segment"]') ?? [];
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveAttribute('title', 'Germany · Build · Mon 12 Oct – Fri 16 Oct');
    // The rotation row is a named, described group (it is a tab stop that shows a tip).
    const rotation = screen.getByRole('group', { name: /^Fixed Income rotation, / });
    expect(document.getElementById(rotation.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/Germany → France/);
  });

  it('reverts to the shortened project tip when the pointer leaves a milestone (Timeline.dc.html:337)', async () => {
    const base = fixtureProject();
    mock.api.state.plan = fixturePlan({
      projects: [
        fixtureProject({
          derived: {
            ...base.derived,
            milestones: [
              { name: 'Feed connected', date: '2026-10-15', passed: false, done: false, horizon: 'now', milestoneId: null },
            ],
          },
        }),
      ],
    });
    renderTimeline();
    const row = await screen.findByRole('button', { name: /^Returns pipeline:/ });
    fireEvent.mouseEnter(row, { clientX: 500, clientY: 500 });
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip).toHaveTextContent('Confidence 3/5');
    const diamond = row.querySelector(`.${s.milestone ?? 'milestone'}`);
    expect(diamond).not.toBeNull();
    if (!diamond) return;
    fireEvent.mouseEnter(diamond, { clientX: 520, clientY: 500 });
    expect(tip).toHaveTextContent('Feed connected');
    expect(tip).toHaveTextContent('Milestone');
    // Onto the lane, still inside the row (React derives leave events from mouseout's relatedTarget).
    fireEvent.mouseLeave(diamond, { clientX: 530, clientY: 500, relatedTarget: row.children[1] });
    expect(tip).toHaveTextContent('Returns pipeline+3 BDForecast Wed 2 Dec · target Fri 27 Nov');
    expect(tip).not.toHaveTextContent('Confidence');
  });

  it('opens the project panel on click and closes it from the Escape stack', async () => {
    renderTimeline();
    fireEvent.click(await screen.findByRole('button', { name: /^Returns pipeline:/ }));
    const aside = await panel();
    expect(aside).toHaveAttribute('data-open', 'true');
    expect(within(aside).getByText('The monthly returns run end to end without me.')).toBeInTheDocument();
    expect(within(aside).getByText('3 of 5')).toBeInTheDocument();
    expect(within(aside).getByText(/No milestones yet\./)).toBeInTheDocument();
    act(() => {
      useOverlays.getState().closeTop();
    });
    expect(aside).toHaveAttribute('data-open', 'false');
    expect(within(aside).getByText('The monthly returns run end to end without me.')).toBeInTheDocument();
  });

  it('leaves its open panel alone while another screen is showing: Escape there is not spent on it', async () => {
    const client = createTestQueryClient();
    const router = createMemoryRouter([{ path: '/app/timeline', element: <StackedTimeline /> }], {
      initialEntries: ['/app/timeline'],
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Returns pipeline:/ }));
    const aside = await panel();
    expect(useOverlays.getState().stack).toContain('timeline-panel');
    act(() => {
      stack.setActive(false);
    });
    // Another screen is showing: the hidden panel is off the Escape stack, so Escape closes nothing.
    expect(useOverlays.getState().stack).not.toContain('timeline-panel');
    act(() => {
      useOverlays.getState().closeTop();
    });
    act(() => {
      stack.setActive(true);
    });
    expect(aside).toHaveAttribute('data-open', 'true');
    expect(useOverlays.getState().stack).toContain('timeline-panel');
  });

  it('opens the panel from a deep link, and Tell Remi opens the drawer on the project', async () => {
    renderTimeline('/app/timeline?panel=ret');
    const aside = await panel();
    const tell = await within(aside).findByRole('button', { name: 'Tell Remi', hidden: true });
    expect(aside).toHaveAttribute('data-open', 'true');
    fireEvent.click(tell);
    expect(useOverlays.getState().drawer).toMatchObject({ open: true, projectId: 'ret' });
  });

  it('goes to the workspace', async () => {
    const { router } = renderTimeline('/app/timeline?panel=ret');
    fireEvent.click(await within(await panel()).findByRole('button', { name: 'Open workspace', hidden: true }));
    expect(await screen.findByText('Workspace page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/projects/ret');
  });

  it('zooms to two weeks and pans a week at a time', async () => {
    renderTimeline();
    fireEvent.click(await screen.findByRole('radio', { name: '2 weeks' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Two weeks' })).toBeInTheDocument();
    expect(screen.getByText('5 Oct – 16 Oct · 10 business days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText('12 Oct – 23 Oct · 10 business days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByText('5 Oct – 16 Oct · 10 business days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '3 months' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Three months' })).toBeInTheDocument();
  });
});
