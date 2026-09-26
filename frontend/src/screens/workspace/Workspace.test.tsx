import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { CalendarIndex } from '../../lib/calendar';
import { buildCalendarDays } from '../../test/fixtures/calendar';
import { createTestQueryClient, fixtureProject, server, setupMockApi } from '../../test/msw';
import { Workspace } from './Workspace';

setupMockApi();

const cal = new CalendarIndex(buildCalendarDays('2026-09-01', '2027-03-31'));

function project() {
  return fixtureProject({
    milestones: [
      {
        id: 'm1',
        projectId: 'ret',
        name: 'Dry run',
        dueDate: '2026-10-16',
        done: false,
        doneOn: null,
        horizon: 'now',
        sortOrder: 0,
        tasks: [
          {
            id: 't1',
            milestoneId: 'm1',
            projectId: 'ret',
            text: 'Write the spec',
            hours: 2,
            done: false,
            doneOn: null,
            dueDate: null,
            sortOrder: 0,
          },
        ],
      },
    ],
  });
}

function renderWorkspace() {
  server.use(http.get('*/api/projects/:id/snapshots', () => HttpResponse.json([])));
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <Workspace project={project()} today="2026-10-05" cal={cal} goalFocusRequest={null} onBack={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Workspace', () => {
  it('names repeated controls by what they belong to, not by a bare date or verb', async () => {
    renderWorkspace();
    expect(await screen.findByRole('button', { name: /^Start date, / })).toHaveAttribute('title', 'Change the start date');
    expect(screen.getByRole('button', { name: /^Target date, / })).toHaveAttribute('title', 'Change the target date');
    expect(screen.getByRole('button', { name: 'Dry run, due Fri 16 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Done: Write the spec' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Hours for Write the spec' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Toggle task' })).not.toBeInTheDocument();
  });

  it('puts focus back on the date button when its picker closes', async () => {
    renderWorkspace();
    const target = await screen.findByRole('button', { name: /^Target date, / });
    target.focus();
    fireEvent.click(target);
    const dialog = await screen.findByRole('dialog', { name: 'Target date' });
    await waitFor(() => {
      expect(dialog).toHaveFocus();
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(target).toHaveFocus();
  });
});
