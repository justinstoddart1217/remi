import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { Schemas, SettingsOut } from '../../api';
import { DEFAULT_APPEARANCE, useUi } from '../../stores/ui';
import { buildCalendarDays } from '../../test/fixtures/calendar';
import { createTestQueryClient, errorResponse, fixturePlan, fixtureSettings, server, setupMockApi } from '../../test/msw';
import SettingsScreen from '.';

const mock = setupMockApi();

afterEach(() => {
  useUi.getState().setAppearance(DEFAULT_APPEARANCE);
});

function serveCalendar() {
  server.use(
    http.get('*/api/calendar', ({ request }) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from') ?? '2026-10-05';
      const to = url.searchParams.get('to') ?? '2027-12-31';
      return HttpResponse.json({ from, to, region: 'GB-ENG', days: buildCalendarDays(from, to) });
    }),
  );
}

/** Answers PATCH /settings with the patched settings; returns the bodies it saw. */
function servePatch(): Schemas['SettingsPatch'][] {
  const bodies: Schemas['SettingsPatch'][] = [];
  server.use(
    http.patch('*/api/settings', async ({ request }) => {
      const body = (await request.json()) as Schemas['SettingsPatch'];
      bodies.push(body);
      const entity: SettingsOut = { ...mock.api.state.settings, ...(body as Partial<SettingsOut>) };
      mock.api.state.settings = entity;
      return HttpResponse.json({ plan: fixturePlan({ settings: entity }), movements: [], entity });
    }),
  );
  return bodies;
}

function renderSettings(hash = '') {
  serveCalendar();
  const client = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/app/today', element: <p>Today screen</p> },
      { path: '/', element: <p>Home screen</p> },
    ],
    { initialEntries: ['/app/today', `/settings${hash}`], initialIndex: 1 },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

describe('Settings', () => {
  it('shows every section with what is saved', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit your setup' })).toBeInTheDocument();
    for (const title of ['The move', 'Your working day', 'Fixed Income rotation', 'Tell Remi', 'Appearance']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Hours a day')).toHaveValue('8');
    expect(screen.getByRole('radio', { name: 'England & Wales' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText('Simple reading works offline. Nothing leaves this computer unless you choose a provider.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Key project: / })).toBeInTheDocument();
    });
  });

  it('says what leaves this computer for the chosen provider, not only for none', async () => {
    mock.api.state.settings = fixtureSettings({ aiProvider: 'ollama' });
    renderSettings();
    const ai = await screen.findByRole('region', { name: 'Tell Remi' });
    expect(within(ai).getByText('Ollama reads your check-ins on this computer, so nothing leaves it.')).toBeInTheDocument();
    expect(within(ai).queryByText(/unless you choose a provider/)).not.toBeInTheDocument();
    expect(within(ai).getByText('On this computer only. Remi refuses any other address.')).toBeInTheDocument();
  });

  it('puts focus on the page heading when it arrives', async () => {
    renderSettings();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Edit your setup' });
    await waitFor(() => {
      expect(h1).toHaveFocus();
    });
  });

  it("shows a failed key save under the key field, and 'Not saved' in the header", async () => {
    const reason =
      'The macOS Keychain is not available to Remi. Install the keyring extra (uv sync --extra keyring) or set REMI_ANTHROPIC_API_KEY.';
    mock.api.state.settings = fixtureSettings({ aiProvider: 'anthropic', aiKeyConfigured: false });
    server.use(http.put('*/api/settings/ai-key', () => errorResponse(409, 'CONFLICT', reason)));
    renderSettings();
    const key = await screen.findByLabelText('Anthropic API key');
    fireEvent.change(key, { target: { value: 'sk-ant-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    const ai = screen.getByRole('region', { name: 'Tell Remi' });
    await waitFor(() => {
      expect(within(ai).getByRole('status')).toHaveTextContent(/^Not saved$/);
    });
    expect(within(ai).getByRole('alert')).toHaveTextContent(reason);
  });

  it('saves the key project from its menu', async () => {
    const bodies = servePatch();
    renderSettings();
    const button = await screen.findByRole('button', { name: /^Key project: / });
    fireEvent.click(button);
    const list = screen.getByRole('listbox', { name: 'Key project' });
    fireEvent.click(within(list).getByText('None'));
    await waitFor(() => {
      expect(bodies).toEqual([{ keyProjectId: null }]);
    });
    const move = screen.getByRole('region', { name: 'The move' });
    await waitFor(() => {
      expect(within(move).getByRole('status')).toHaveTextContent('Saved');
    });
  });

  it('applies an accent at once and saves its hex pair', async () => {
    const bodies = servePatch();
    renderSettings();
    fireEvent.click(await screen.findByRole('radio', { name: /Mint and navy/ }));
    expect(useUi.getState().appearance.accent).toBe('mint');
    await waitFor(() => {
      expect(bodies).toEqual([{ accentPc: '#34C1A3', accentFi: '#1F4E79' }]);
    });
  });

  it('puts the appearance back when the save fails', async () => {
    server.use(
      http.patch('*/api/settings', () =>
        HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'Nope', field: null }, { status: 500 }),
      ),
    );
    renderSettings();
    const display = await screen.findByRole('radiogroup', { name: 'Display face for goals' });
    fireEvent.click(within(display).getByRole('radio', { name: 'Off' }));
    expect(useUi.getState().appearance.serif).toBe(false);
    await waitFor(() => {
      expect(useUi.getState().appearance.serif).toBe(true);
    });
    const appearance = screen.getByRole('region', { name: 'Appearance' });
    expect(within(appearance).getByRole('status')).toHaveTextContent('Not saved');
  });

  it('follows the saved appearance', async () => {
    mock.api.state.settings = fixtureSettings({ accentPc: '#026E62', accentFi: '#5B7FA8', motionPreference: 'reduced' });
    renderSettings();
    await screen.findByRole('heading', { level: 1, name: 'Edit your setup' });
    await waitFor(() => {
      expect(useUi.getState().appearance).toEqual({ accent: 'deep', serif: true, motion: 'reduced' });
    });
  });

  it('goes back on Escape, but not from inside a field', async () => {
    const { router } = renderSettings();
    const hours = await screen.findByLabelText('Hours a day');
    fireEvent.keyDown(hours, { key: 'Escape' });
    expect(router.state.location.pathname).toBe('/settings');
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today');
    });
  });
});
