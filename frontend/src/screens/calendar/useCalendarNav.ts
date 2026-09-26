import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useScreenRoute } from '../../app/screenLocation';
import { paths } from '../../app/screens';
import { useIsActiveScreen } from '../../lib/arrival';
import { asIsoDate } from '../../lib/calendar';
import type { IsoDate, IsoMonth } from '../../lib/calendar';
import { isIsoMonth, SWAP_MS } from './model';
import { initialNav, navReducer } from './nav';
import type { NavBounds, NavState } from './nav';

/** Marks the URL writes this hook makes itself, so they are not read back as deep links. */
interface SyncState {
  calendarSync: true;
}

function isSyncState(value: unknown): value is SyncState {
  return typeof value === 'object' && value !== null && 'calendarSync' in value;
}

export interface CalendarNav extends NavState {
  /** True while the grid is fading to another month. */
  fading: boolean;
  go: (delta: number) => void;
  thisMonth: () => void;
  toggle: (iso: IsoDate) => void;
  step: (iso: IsoDate) => void;
  close: () => void;
  /** Jump straight to a month known to load (after a link past the server's range). */
  land: (month: IsoMonth) => void;
}

/**
 * The Calendar's month and selected day, kept in step with `/app/calendar/<YYYY-MM>?day=<iso>`.
 *
 * - A navigation to the screen (a deep link, the rail, Back) is applied during render, so the
 *   URL write below never sees a stale state.
 * - Every change is written back with `replace` (other query parameters such as `frame` are
 *   kept), so the rail returns to the same month and day and a reload restores them. The
 *   screen stays mounted while hidden, so the day stays open for when the user comes back
 *   (the prototype's `sel` persisted the same way).
 * - The month swap runs SWAP_MS after the last header click.
 */
export function useCalendarNav(bounds: NavBounds): CalendarNav {
  const route = useScreenRoute();
  const active = useIsActiveScreen();
  const location = useLocation();
  const navigate = useNavigate();

  const routeMonth = isIsoMonth(route.params.month) ? route.params.month : null;
  const routeDay = asIsoDate(route.searchParams.get('day'));

  const reducer = useMemo(() => navReducer(bounds), [bounds]);
  const [state, dispatch] = useReducer(reducer, null, () => initialNav(bounds, routeMonth, routeDay));

  // A new navigation to this screen: apply its month and day (render-phase, see above).
  const [seenKey, setSeenKey] = useState(route.key);
  if (active && route.key !== seenKey) {
    setSeenKey(route.key);
    if (!isSyncState(location.state)) dispatch({ type: 'route', month: routeMonth, day: routeDay });
  }

  // Today's month moved on, or the server's range end became known.
  useEffect(() => {
    dispatch({ type: 'bounds' });
  }, [bounds]);

  // The debounced swap: the new month renders SWAP_MS after the last click.
  useEffect(() => {
    if (state.target === state.shown) return;
    const id = setTimeout(() => {
      dispatch({ type: 'swap' });
    }, SWAP_MS);
    return () => {
      clearTimeout(id);
    };
  }, [state.target, state.shown]);

  // Write the state back to the URL while the screen is showing.
  useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(location.search);
    if (state.sel) params.set('day', state.sel);
    else params.delete('day');
    const query = params.toString();
    const pathname = paths.calendar(state.target);
    const want = `${pathname}${query ? `?${query}` : ''}`;
    if (want === `${location.pathname}${location.search}`) return;
    const sync: SyncState = { calendarSync: true };
    void navigate(`${want}${location.hash}`, { replace: true, state: sync });
  }, [active, state.target, state.sel, location.pathname, location.search, location.hash, navigate]);

  const go = useCallback((delta: number) => {
    dispatch({ type: 'go', delta });
  }, []);
  const thisMonth = useCallback(() => {
    dispatch({ type: 'thisMonth' });
  }, []);
  const toggle = useCallback((iso: IsoDate) => {
    dispatch({ type: 'toggle', iso });
  }, []);
  const step = useCallback((iso: IsoDate) => {
    dispatch({ type: 'step', iso });
  }, []);
  const close = useCallback(() => {
    dispatch({ type: 'close' });
  }, []);

  const land = useCallback((month: IsoMonth) => {
    dispatch({ type: 'land', month });
  }, []);

  return { ...state, fading: state.target !== state.shown, go, thisMonth, toggle, step, close, land };
}
