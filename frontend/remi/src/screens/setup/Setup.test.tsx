import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { Schemas } from '../../api';
import { buildCalendarDays } from '../../test/fixtures/calendar';
import { createTestQueryClient, fixturePlan, fixtureSettings, server, setupMockApi } from '../../test/msw';
import SetupScreen from '.';

setupMockApi({ plan: null });

function serveSetup(): Schemas['SetupIn'][] {
  const bodies: Schemas['SetupIn'][] = [];
  server.use(
    http.get('*/api/calendar', ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from') ?? '2026-10-05';
      const to = url.searchParams.get('to') ?? '2027-12-31';
      return HttpResponse.json({ from, to, region: 'GB-ENG', days: buildCalendarDays(from, to) });
    }),
    http.get('*/api/setup/countdown', ({ request }) => {
      const moveDate = new URL(request.url).searchParams.get('moveDate') ?? '';
      return HttpResponse.json({ today: '2026-10-05', moveDate, snapped: false, countdownBd: 61 });
    }),
    http.post('*/api/setup', async ({ request }) => {
      bodies.push((await request.json()) as Schemas['SetupIn']);
      const entity = fixtureSettings();
      return HttpResponse.json({ plan: fixturePlan({ settings: entity }), movements: [], entity }, { status: 201 });
    }),
  );
  return bodies;
}

function renderSetup() {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/setup', element: <SetupScreen /> },
      { path: '/', element: <p>Home screen</p> },
      { path: '/settings', element: <p>Settings screen</p> },
    ],
    { initialEntries: ['/setup'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('Setup wizard', () => {
  it('waits for a move date, then starts an empty plan and goes Home', async () => {
    const bodies = serveSetup();
    const router = renderSetup();

    expect(await screen.findByRole('heading', { level: 1, name: 'Set up your plan' })).toBeInTheDocument();
    expect(screen.getByText('First run')).toBeInTheDocument();
    const start = screen.getByRole('button', { name: /Start with an empty plan/ });
    expect(start).toBeDisabled();
    expect(screen.getByText('Choose your move date to start.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');

    const trigger = screen.getByRole('button', { name: 'Move date: not chosen yet' });
    await waitFor(() => {
      expect(trigger).toBeEnabled();
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Move date' });
    for (let i = 0; i < 3; i++) fireEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mon 4 Jan' }));

    await waitFor(() => {
      expect(start).toBeEnabled();
    });
    fireEvent.click(start);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(bodies).toEqual([
      {
        moveDate: '2027-01-04',
        timezone: 'Europe/London',
        holidayRegion: 'GB-ENG',
        capacityHoursPerDay: 8,
        aiProvider: 'none',
        aiModel: null,
        motionPreference: 'system',
        rotation: null,
      },
    ]);
  });

  it('holds the start while a rotation country is unfinished', async () => {
    serveSetup();
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: /Add the first country/ }));
    expect(screen.getByText('Needs a country and its two-letter code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start with an empty plan/ })).toBeDisabled();
    // The rail agrees with the editor's totals line: the blank stop is named, not counted.
    expect(screen.getByText('1 unfinished stop, not counted')).toBeInTheDocument();
    const rail = screen.getByRole('navigation');
    expect(within(rail).getByText('1 unfinished stop')).toBeInTheDocument();
    expect(within(rail).queryByText(/1 country/)).not.toBeInTheDocument();
  });

  it('keeps the rotation list to its stops: the add button sits beside it, not in it', async () => {
    serveSetup();
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: /Add the first country/ }));
    const list = screen.getByRole('list', { name: 'Rotation, in order' });
    expect([...list.children].map((c) => c.getAttribute('role'))).toEqual(['listitem']);
    expect(within(list).queryByRole('button', { name: /Add a country/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a country/ })).toBeInTheDocument();
  });
});
