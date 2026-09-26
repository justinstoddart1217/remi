/**
 * The saved appearance reaches :root from the app root (RootLayout → useAppearance →
 * useSavedAppearance), without Settings ever mounting; and the pure mapping it relies on.
 */
import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { keys } from '../api/keys';
import { DEFAULT_APPEARANCE, useUi } from '../stores/ui';
import { fixtureSettings, setupMockApi } from '../test/msw';
import {
  ACCENT_PAIRS,
  accentById,
  accentFor,
  accentIdFor,
  appearanceFromSettings,
  DEFAULT_ACCENT_PAIR,
  hasAppearance,
} from './appearance';
import type { AccentId } from './appearance';
import { Providers } from './providers';
import { RootLayout } from './RootLayout';

const mock = setupMockApi();

function renderRoot() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ element: <RootLayout />, children: [{ path: '/', element: <p>child</p> }] }], {
    initialEntries: ['/'],
  });
  render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return client;
}

function clearRoot() {
  const ds = document.documentElement.dataset;
  delete ds.accent;
  delete ds.serif;
  delete ds.motion;
}

beforeEach(() => {
  useUi.getState().setAppearance(DEFAULT_APPEARANCE);
  clearRoot();
});

afterEach(() => {
  useUi.getState().setAppearance(DEFAULT_APPEARANCE);
  clearRoot();
});

describe('root appearance hydration', () => {
  it('applies the saved accent pair, serif and motion to :root on a cold load', async () => {
    mock.api.state.settings = fixtureSettings({
      accentPc: '#026e62',
      accentFi: '#5b7fa8',
      serifDisplay: false,
      motionPreference: 'reduced',
    });
    renderRoot();
    expect(await screen.findByText('child')).toBeInTheDocument();
    const root = document.documentElement;
    await waitFor(() => {
      expect(root.dataset.accent).toBe('deep');
    });
    expect(root.dataset.serif).toBe('off');
    expect(root.dataset.motion).toBe('reduced');
    expect(useUi.getState().appearance).toEqual({ accent: 'deep', serif: false, motion: 'reduced' });
  });

  it('keeps the design defaults for the default settings', async () => {
    renderRoot();
    expect(await screen.findByText('child')).toBeInTheDocument();
    const root = document.documentElement;
    await waitFor(() => {
      expect(root.dataset.accent).toBe('teal');
    });
    expect(root.dataset.serif).toBeUndefined();
    expect(root.dataset.motion).toBe('full');
  });

  it('follows a change to the saved settings (a save elsewhere, a refetch)', async () => {
    const client = renderRoot();
    expect(await screen.findByText('child')).toBeInTheDocument();
    const root = document.documentElement;
    await waitFor(() => {
      expect(root.dataset.accent).toBe('teal');
    });

    mock.api.state.settings = fixtureSettings({
      accentPc: '#34c1a3',
      accentFi: '#1F4E79',
      serifDisplay: false,
      motionPreference: 'full',
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.settings });
    });
    await waitFor(() => {
      expect(root.dataset.accent).toBe('mint');
    });
    expect(root.dataset.serif).toBe('off');
    expect(root.dataset.motion).toBe('full');

    mock.api.state.settings = fixtureSettings();
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.settings });
    });
    await waitFor(() => {
      expect(root.dataset.accent).toBe('teal');
    });
    expect(root.dataset.serif).toBeUndefined();
  });
});

describe('ACCENT_PAIRS', () => {
  it("is the redesign's three brand pairs, in its order, the first being tokens.css's own", () => {
    expect(ACCENT_PAIRS.map((a) => [a.id, a.pc, a.fi])).toEqual([
      ['teal', '#009D80', '#2F6B9A'],
      ['deep', '#026E62', '#5B7FA8'],
      ['mint', '#34C1A3', '#1F4E79'],
    ]);
    expect(DEFAULT_ACCENT_PAIR.id).toBe(DEFAULT_APPEARANCE.accent);
    expect(new Set(ACCENT_PAIRS.map((a) => a.name)).size).toBe(3);
    for (const pair of ACCENT_PAIRS) expect(pair.name).toMatch(/^[A-Z][a-z]+( [a-z]+)* and [a-z]+$/);
  });

  it('looks pairs up by id, the default for anything else', () => {
    expect(accentById('mint').pc).toBe('#34C1A3');
    expect(accentById('nope' as AccentId)).toBe(DEFAULT_ACCENT_PAIR);
    expect(accentFor('#026e62', '#5b7fa8').id).toBe('deep');
  });
});

describe('accentIdFor', () => {
  it('names the pair a stored pair matches, ignoring case', () => {
    expect(accentIdFor('#009D80', '#2F6B9A')).toBe('teal');
    expect(accentIdFor('#026e62', '#5b7fa8')).toBe('deep');
    expect(accentIdFor('#34C1A3', '#1f4e79')).toBe('mint');
  });

  it('falls back to the PC accent alone, then to the default', () => {
    expect(accentIdFor('#34c1a3', '#000000')).toBe('mint');
    expect(accentIdFor('#123456', '#654321')).toBe('teal');
    expect(accentIdFor(null, undefined)).toBe('teal');
  });

  it('reads a pre-redesign stand-in pair as the default', () => {
    expect(accentIdFor('#526e2a', '#47619c')).toBe('teal');
    expect(accentIdFor('#884b75', '#007187')).toBe('teal');
  });
});

describe('hasAppearance', () => {
  it('accepts a settings answer with the appearance fields', () => {
    expect(hasAppearance(fixtureSettings())).toBe(true);
  });

  it('rejects stubbed or odd replies', () => {
    expect(hasAppearance(null)).toBe(false);
    expect(hasAppearance(undefined)).toBe(false);
    expect(hasAppearance('settings')).toBe(false);
    expect(hasAppearance({})).toBe(false);
    expect(hasAppearance({ accentPc: '#009D80', accentFi: '#2F6B9A', serifDisplay: 'yes', motionPreference: 'system' })).toBe(false);
    expect(hasAppearance({ accentPc: '#009D80', accentFi: '#2F6B9A', serifDisplay: true, motionPreference: 'fast' })).toBe(false);
    expect(hasAppearance({ accentPc: '#009D80', accentFi: null, serifDisplay: true, motionPreference: 'system' })).toBe(false);
  });
});

describe('appearanceFromSettings', () => {
  it('maps the saved fields to the ui store appearance', () => {
    expect(
      appearanceFromSettings({ accentPc: '#34C1A3', accentFi: '#1F4E79', serifDisplay: true, motionPreference: 'system' }),
    ).toEqual({ accent: 'mint', serif: true, motion: 'system' });
    expect(
      appearanceFromSettings({ accentPc: '#009D80', accentFi: '#2F6B9A', serifDisplay: false, motionPreference: 'reduced' }),
    ).toEqual({ accent: 'teal', serif: false, motion: 'reduced' });
  });
});
