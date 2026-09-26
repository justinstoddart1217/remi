/**
 * The shell around the screens: the top bar (tabs, status line, clock, Settings link, pinned-date
 * flag), where focus goes after palette and drawer journeys (arch-frontend-core §8), and the page
 * title per route. The screens are probes with an h1, so nothing here depends on a screen's own
 * content; the top bar and the palette read the msw mock API's fixture plan (project 'ret',
 * "Returns pipeline").
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerDrawerContent } from '../DrawerHost';
import type { DrawerContentProps } from '../DrawerHost/registry';
import { useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import { setupMockApi } from '../../test/msw';
import { renderApp } from '../../test/renderApp';
import { PINNED_DATE_TEXT } from '../HeaderBar/headerModel';

function probe(name: string) {
  return function Probe() {
    return <h1 tabIndex={-1}>{name}</h1>;
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
vi.mock('../../screens/settings', () => ({ default: probe('Settings') }));

/** The drawer's content: a composer that takes focus when the drawer opens. */
function Composer({ open }: DrawerContentProps) {
  return open ? <textarea aria-label="Your update" autoFocus /> : null;
}

const mock = setupMockApi();

afterEach(() => {
  act(() => {
    useOverlays.getState().closePalette();
    useOverlays.getState().closeDrawer();
  });
  useUi.setState({ screenLocations: {}, lastWorkspaceId: null, headingFocusPending: false });
  vi.unstubAllEnvs();
});

async function shell(path = '/app/today') {
  const utils = renderApp(path);
  // The plan is read once the top bar shows the date line.
  await screen.findByText('Mon 5 Oct · BD3 ·');
  return utils;
}

async function openPaletteFrom(el: HTMLElement) {
  el.focus();
  act(() => {
    useOverlays.getState().openPalette();
  });
  const input = screen.getByRole('combobox');
  await waitFor(() => {
    expect(input).toHaveFocus();
  });
  return input;
}

describe('the top bar', () => {
  it('is one column: the bar over <main>, with no left rail', async () => {
    await shell();
    const app = document.querySelector('[data-screen-label="Remi app"]');
    const header = screen.getByRole('banner');
    expect(app).toContainElement(header);
    expect(header.nextElementSibling?.tagName).toBe('MAIN');
    expect(header.parentElement?.parentElement).toBe(app);
  });

  it('has the seven screen tabs as buttons in nav "Screens", Projects lit on the workspace', async () => {
    const { router } = await shell();
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'todayToday',
      'notesNotes',
      'view_timelineTimeline',
      'calendar_monthCalendar',
      'stacksProjects',
      'repeatRoutines',
      'arrow_forwardTransition',
    ]);
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(within(nav).getByRole('button', { name: 'Timeline' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/timeline');
    });
    expect(within(nav).getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Today' })).not.toHaveAttribute('aria-current');

    await act(() => router.navigate('/app/projects/ret'));
    expect(within(nav).getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows date · BD · verdict over the countdown, both going to Transition', async () => {
    const { router } = await shell();
    const countdown = screen.getByRole('button', { name: /business days to Fixed Income/ });
    expect(countdown).toHaveAttribute('title', 'Transition');
    expect(countdown).toHaveTextContent('Mon 5 Oct · BD3 ·Move on track, narrowly61business days to Fixed Income');
    fireEvent.click(countdown);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/transition');
    });
  });

  it("shows the business timezone's city over the live clock", async () => {
    await shell();
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('London')).toBeInTheDocument();
    expect(within(banner).getByText(/^\d{2}:\d{2}:\d{2}$/).tagName).toBe('TIME');
  });

  it('names the round buttons and opens the palette and the drawer', async () => {
    await shell();
    const banner = screen.getByRole('banner');
    fireEvent.click(within(banner).getByRole('button', { name: 'Search or add' }));
    expect(useOverlays.getState().palette.open).toBe(true);
    act(() => {
      useOverlays.getState().closePalette();
    });
    fireEvent.click(within(banner).getByRole('button', { name: 'Tell Remi' }));
    expect(useOverlays.getState().drawer).toMatchObject({ open: true, projectId: null });
  });

  it('has an always-visible Settings link', async () => {
    const { router } = await shell();
    const link = within(screen.getByRole('banner')).getByRole('link', { name: 'Settings' });
    expect(link).toHaveAttribute('href', '/settings');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings');
    });
  });
});

describe('the pinned-date flag', () => {
  it('flags a pinned business date (REMI_TODAY) in a built app', async () => {
    vi.stubEnv('DEV', false);
    expect(mock.api.state.plan?.today.overridden).toBe(true);
    await shell();
    const flag = screen.getByText(PINNED_DATE_TEXT);
    expect(flag.closest('header')).not.toBeNull();
    expect(flag).toHaveAttribute('title', expect.stringContaining('REMI_TODAY is set, so Remi is treating Mon 5 Oct as today'));
  });

  it('keeps the prototype header when the date is real, and on the dev server (tests, parity)', async () => {
    const { unmount } = await shell();
    expect(screen.queryByText(PINNED_DATE_TEXT)).toBeNull();
    unmount();

    vi.stubEnv('DEV', false);
    const plan = mock.api.state.plan;
    if (!plan) throw new Error('no plan');
    mock.api.state.plan = { ...plan, today: { ...plan.today, overridden: false } };
    await shell();
    expect(screen.queryByText(PINNED_DATE_TEXT)).toBeNull();
  });
});

describe('focus after the palette', () => {
  it('opening a project from ⌘K focuses the workspace heading', async () => {
    const { router } = await shell('/app/notes');
    const input = await openPaletteFrom(screen.getByRole('heading', { name: 'Notes' }));
    fireEvent.change(input, { target: { value: 'returns' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/app/projects/ret');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Workspace' })).toHaveFocus();
    });
  });

  it('a drawer opened from ⌘K returns focus to what was focused before ⌘K', async () => {
    const unregister = registerDrawerContent(Composer);
    try {
      await shell();
      const trigger = screen.getByRole('button', { name: /business days to Fixed Income/ });
      const input = await openPaletteFrom(trigger);
      fireEvent.change(input, { target: { value: 'tell remi about returns' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      const composer = await screen.findByRole('textbox', { name: 'Your update' });
      composer.focus();
      expect(useOverlays.getState().drawer.open).toBe(true);

      act(() => {
        useOverlays.getState().closeDrawer();
      });
      expect(trigger).toHaveFocus();
    } finally {
      act(() => {
        unregister();
      });
    }
  });

  it('a quick add (+6h) from ⌘K returns focus there too', async () => {
    const unregister = registerDrawerContent(Composer);
    try {
      await shell();
      const trigger = screen.getByRole('button', { name: /Tell Remi/ });
      const input = await openPaletteFrom(trigger);
      fireEvent.change(input, { target: { value: '+6h returns' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      (await screen.findByRole('textbox', { name: 'Your update' })).focus();
      expect(useOverlays.getState().drawer.prefill).toEqual({ scopeH: 6 });

      act(() => {
        useOverlays.getState().closeTop();
      });
      expect(trigger).toHaveFocus();
    } finally {
      act(() => {
        unregister();
      });
    }
  });

  it('the header button still gets focus back from its own drawer', async () => {
    const unregister = registerDrawerContent(Composer);
    try {
      await shell();
      const tell = screen.getByRole('button', { name: /Tell Remi/ });
      tell.focus();
      fireEvent.click(tell);
      (await screen.findByRole('textbox', { name: 'Your update' })).focus();
      act(() => {
        useOverlays.getState().closeDrawer();
      });
      expect(tell).toHaveFocus();
    } finally {
      act(() => {
        unregister();
      });
    }
  });
});

describe('document.title', () => {
  it('names every route, the workspace by its project', async () => {
    const { router } = await shell('/app/today');
    await waitFor(() => {
      expect(document.title).toBe('Today · Remi');
    });
    await act(() => router.navigate('/app/timeline'));
    expect(document.title).toBe('Timeline · Remi');
    await act(() => router.navigate('/app/projects/ret'));
    expect(document.title).toBe('Returns pipeline · Remi');
    await act(() => router.navigate('/settings'));
    await waitFor(() => {
      expect(document.title).toBe('Settings · Remi');
    });
    await act(() => router.navigate('/'));
    expect(document.title).toBe('Remi');
  });
});
