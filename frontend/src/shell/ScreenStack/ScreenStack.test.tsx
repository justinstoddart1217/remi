/**
 * The keep-mounted cross-fade (ScreenStack) and the first-run gate, tested on their structure.
 * The screens themselves are replaced by probes that count their mounts and show their route,
 * so these tests never depend on a screen's content; the shell around them (header, rail) reads
 * the msw mock API's fixture plan.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOOT_QUIET_MS, BOOT_TEXT } from '../../app/BootFallback';
import { RESTART_HINT, START_HINT } from '../../app/SetupGate';
import { useScreenRoute } from '../../app/screenLocation';
import { useIsActiveScreen } from '../../lib/arrival';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { errorResponse, server, setupMockApi } from '../../test/msw';
import { renderApp } from '../../test/renderApp';

/** Mounts per probe, by name. */
const mounts = new Map<string, number>();

/** A stand-in screen: counts its mounts, shows its name and its (latched) route params. */
function probe(name: string) {
  return function Probe() {
    const route = useScreenRoute();
    const active = useIsActiveScreen();
    useEffect(() => {
      mounts.set(name, (mounts.get(name) ?? 0) + 1);
    }, []);
    return (
      <div data-probe={name} data-active={active ? '' : undefined}>
        <h1 tabIndex={-1}>{name}</h1>
        <span data-testid={`params:${name}`}>{JSON.stringify(route.params)}</span>
      </div>
    );
  };
}

vi.mock('../../screens/today', () => ({ default: probe('Today') }));
vi.mock('../../screens/notes', () => ({ default: probe('Notes') }));
vi.mock('../../screens/timeline', () => ({ default: probe('Timeline') }));
vi.mock('../../screens/calendar', () => ({ default: probe('Calendar') }));
vi.mock('../../screens/projects', () => ({ default: probe('Projects') }));
vi.mock('../../screens/workspace', () => ({ default: probe('Workspace') }));
vi.mock('../../screens/routines', () => ({ default: probe('Routines') }));
vi.mock('../../screens/transition', () => ({ default: probe('Transition') }));
vi.mock('../../screens/home', () => ({ default: probe('Home') }));
vi.mock('../../screens/setup', () => ({ default: probe('Setup') }));

const LABELS = ['Today', 'Notes', 'Timeline', 'Calendar', 'Projects', 'Project workspace', 'Routines', 'Transition'];

function sections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('main > section')];
}

function section(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`main > section[data-screen-label="${label}"]`);
  if (!el) throw new Error(`No section ${label}`);
  return el;
}

const mock = setupMockApi();

beforeEach(() => {
  mounts.clear();
});

afterEach(() => {
  useUi.setState({ instant: false, lastWorkspaceId: null, screenLocations: {} });
  useOverlays.getState().closePalette();
});

describe('ScreenStack', () => {
  it('keeps all eight screens mounted and cross-fades between them by route', async () => {
    const { router } = renderApp('/app/today');
    await waitFor(() => {
      expect(sections()).toHaveLength(8);
    });

    expect(sections().map((s) => s.dataset.screenLabel)).toEqual(LABELS);
    expect(document.querySelector('[data-screen-label="Remi app"]')).not.toBeNull();

    const today = section('Today');
    expect(today.dataset.state).toBe('active');
    expect(today).not.toHaveAttribute('inert');
    for (const label of LABELS.slice(1)) {
      expect(section(label).dataset.state).toBe('idle');
      expect(section(label)).toHaveAttribute('inert');
    }
    expect(section('Notes').dataset.overflow).toBe('hidden');
    expect(section('Timeline').dataset.overflow).toBe('hidden');
    // The redesign's Calendar section scrolls vertically only.
    expect(section('Calendar').dataset.overflow).toBe('y');
    for (const label of ['Today', 'Projects', 'Project workspace', 'Routines', 'Transition']) {
      expect(section(label).dataset.overflow).toBe('auto');
    }
    // Each screen knows whether it is the active one.
    expect(today.querySelector('[data-probe="Today"]')).toHaveAttribute('data-active');
    expect(section('Timeline').querySelector('[data-probe="Timeline"]')).not.toHaveAttribute('data-active');

    const todayProbe = today.querySelector('[data-probe="Today"]');
    await act(() => router.navigate('/app/timeline'));

    expect(section('Timeline').dataset.state).toBe('active');
    expect(section('Timeline')).not.toHaveAttribute('inert');
    expect(section('Today').dataset.state).toBe('idle');
    expect(section('Today')).toHaveAttribute('inert');
    // Same DOM nodes: nothing was unmounted, every screen mounted exactly once.
    expect(section('Today')).toBe(today);
    expect(today.querySelector('[data-probe="Today"]')).toBe(todayProbe);
    expect(sections()).toHaveLength(8);
    expect([...mounts.values()]).toEqual(Array.from({ length: 8 }, () => 1));
  });

  it('shows the workspace for /app/projects/:id, keeps Projects lit, and latches the project while hidden', async () => {
    const { router } = renderApp('/app/projects/ret');
    await waitFor(() => {
      expect(section('Project workspace').dataset.state).toBe('active');
    });
    expect(useUi.getState().lastWorkspaceId).toBe('ret');
    expect(screen.getByTitle('Projects')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('params:Workspace')).toHaveTextContent('{"projectId":"ret"}');

    await act(() => router.navigate('/app/today'));
    // Hidden, the workspace keeps its project and its route.
    expect(useUi.getState().lastWorkspaceId).toBe('ret');
    expect(section('Project workspace').dataset.state).toBe('idle');
    expect(screen.getByTestId('params:Workspace')).toHaveTextContent('{"projectId":"ret"}');
    expect(screen.getByTitle('Today')).toHaveAttribute('aria-current', 'page');
    expect(mounts.get('Workspace')).toBe(1);
  });

  it('switches off the cross-fade with data-instant', async () => {
    renderApp('/app/today');
    await waitFor(() => {
      expect(sections()).toHaveLength(8);
    });
    const main = document.querySelector('main');
    expect(main).not.toHaveAttribute('data-instant');
    act(() => {
      useUi.getState().setInstant(true);
    });
    expect(main).toHaveAttribute('data-instant');
  });

  it('redirects /app to Today', async () => {
    const { router } = renderApp('/app');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/today');
    });
  });
});

describe('SetupGate', () => {
  it('sends a first run to /setup, which loads its own chunk', async () => {
    mock.api.state.plan = null;
    const { router } = renderApp('/app/today');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/setup');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Setup' })).toBeInTheDocument();
    expect(document.querySelector('main')).toBeNull();
  });

  it('lets the app through when setup is complete', async () => {
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('lets the app through when the setup route does not exist yet (501)', async () => {
    server.use(http.get('*/api/setup', () => errorResponse(501, 'NOT_IMPLEMENTED')));
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('shows nothing while the status is on its way, then "Starting Remi…" if it is slow', async () => {
    server.use(http.get('*/api/setup', () => new Promise<never>(() => undefined)));
    const started = Date.now();
    renderApp('/app/today');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    expect(document.querySelector('main')).toBeNull();
    await waitFor(() => {
      expect(status).toHaveTextContent(BOOT_TEXT);
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(BOOT_QUIET_MS - 20);
    expect(document.querySelector('main')).toBeNull();
  });

  it('says how to start Remi when there is no server at all, with the browser\'s words under Details', async () => {
    server.use(http.get('*/api/setup', () => HttpResponse.error()));
    renderApp('/');
    // The status is retried twice (about 3s) before it counts as unreachable.
    const alert = await screen.findByRole('alert', undefined, { timeout: 6000 });
    expect(alert).toHaveTextContent('Remi couldn’t reach its server on this computer.');
    expect(alert).toHaveTextContent(START_HINT);
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.textContent).toMatch(/fetch/i);
  }, 10_000);

  it('shows an error with Try again when the status cannot be read, instead of the empty app', async () => {
    let fail = true;
    server.use(
      http.get('*/api/setup', () => (fail ? errorResponse(403, 'FORBIDDEN', 'Blocked by the origin check.') : undefined)),
    );
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Remi couldn’t reach its server on this computer.');
    expect(alert).toHaveTextContent(RESTART_HINT);
    expect(alert.querySelector('details')).toHaveTextContent('403 · Blocked by the origin check.');
    expect(screen.queryByRole('heading', { level: 1, name: 'Home' })).not.toBeInTheDocument();

    fail = false;
    act(() => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });
});
