import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { createTestQueryClient, fixturePlan, fixtureProject, fixtureRotation, setupMockApi } from '../../test/msw';
import TransitionScreen from '.';
import { COPY } from './model';

const mock = setupMockApi();

function renderTransition() {
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/app/transition', element: <TransitionScreen /> },
      { path: '/app/projects', element: <p>Projects page</p> },
      { path: '/settings', element: <p>Settings page</p> },
    ],
    { initialEntries: ['/app/transition'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

const fiColumn = () => screen.getByRole('region', { name: 'Fixed Income ramp up' });

describe('Transition screen', () => {
  it('with no Fixed Income project, says where onboarding items live and links to Projects', async () => {
    mock.api.state.plan = fixturePlan({ projects: [fixtureProject()], rotation: fixtureRotation({ segments: [] }) });
    const { router } = renderTransition();
    await screen.findByText(COPY.noOnboardingHost);
    const fi = fiColumn();
    // No dead '+ Add': there is no project to hold an item.
    expect(within(fi).queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
    fireEvent.click(within(fi).getByRole('button', { name: COPY.startFiProject }));
    expect(router.state.location.pathname).toBe('/app/projects');
  });

  it('with a Fixed Income project, offers the add and the plain empty line', async () => {
    const fion = fixtureProject({ id: 'fion', domain: 'fi', name: 'FI onboarding', short: 'onboarding' });
    mock.api.state.plan = fixturePlan({ projects: [fixtureProject(), fion] });
    renderTransition();
    await screen.findByText(COPY.noOnboarding);
    expect(within(fiColumn()).getByRole('button', { name: /^Add/ })).toBeInTheDocument();
    expect(screen.queryByText(COPY.noOnboardingHost)).not.toBeInTheDocument();
  });

  it("names the region's holidays in the strip legend", async () => {
    const plan = fixturePlan();
    mock.api.state.plan = { ...plan, calendar: { ...plan.calendar, region: 'ZA' } };
    renderTransition();
    expect(await screen.findByText('One block per remaining business day; public holidays left out.')).toBeInTheDocument();
  });

  it("marks 'Set up the rotation' as a link away, like the same link on Routines", async () => {
    mock.api.state.plan = fixturePlan({ rotation: fixtureRotation({ segments: [] }) });
    renderTransition();
    const link = await screen.findByRole('button', { name: new RegExp(COPY.setUpRotation) });
    expect(link.querySelector('[class*="arrow"]')).not.toBeNull();
  });
});
