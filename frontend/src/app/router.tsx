import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, redirect } from 'react-router';
import type { RouteObject } from 'react-router';

import HomeScreen from '../screens/home';
import { AppShell } from '../shell/AppShell';
import { BootFallback } from './BootFallback';
import { RootLayout } from './RootLayout';
import { RouteError } from './RouteError';
import type { ScreenHandle, ScreenId } from './screens';
import { paths } from './screens';

/**
 * A route whose screen is its own chunk (react-router `lazy`): the module's default export.
 * Home and the app shell (with its eight screens, which ScreenStack keeps mounted) stay in the
 * entry chunk so they render at once; the Textbook (with KaTeX), Setup, Settings and the
 * dev-only Foundations pages load on first visit. A navigation to one waits for its chunk, so
 * the previous page stays on screen meanwhile (served from 127.0.0.1, that is a few ms).
 */
function lazyScreen(load: () => Promise<{ default: ComponentType }>): NonNullable<RouteObject['lazy']> {
  return async () => ({ Component: (await load()).default });
}

/**
 * Foundations and its component library are dev-only routes (decision 5). In production
 * `import.meta.env.DEV` is false, so the routes and their chunks are dropped from the build.
 * `/dev/foundations` is the parity driver's alias.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      { path: 'foundations', lazy: lazyScreen(() => import('../screens/foundations')) },
      { path: 'dev/foundations', lazy: lazyScreen(() => import('../screens/foundations')) },
      { path: 'foundations/library', lazy: lazyScreen(() => import('../screens/foundations/LibraryPage')) },
      { path: 'dev/foundations/library', lazy: lazyScreen(() => import('../screens/foundations/LibraryPage')) },
    ]
  : [];

/** An app-shell child route: validates the path and names the screen; ScreenStack renders it. */
function screen(path: string, id: ScreenId): RouteObject {
  const handle: ScreenHandle = { screen: id };
  return { path, handle, element: null };
}

/** The route table (exported for tests, which use a memory router). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    HydrateFallback: BootFallback,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'setup', lazy: lazyScreen(() => import('../screens/setup')) },
      { path: 'settings', lazy: lazyScreen(() => import('../screens/settings')) },
      {
        path: 'app',
        element: <AppShell />,
        children: [
          // AppShell renders no <Outlet>, so these redirect in loaders rather than elements.
          { index: true, loader: () => redirect(paths.today()) },
          screen('today/:day?', 'today'),
          screen('notes/:day?', 'notes'),
          screen('timeline', 'timeline'),
          screen('calendar/:month?', 'calendar'),
          screen('projects', 'projects'),
          screen('projects/:projectId', 'workspace'),
          screen('routines', 'routines'),
          screen('transition', 'transition'),
          { path: '*', loader: () => redirect(paths.today()) },
        ],
      },
      { path: 'textbook/:pageId?', lazy: lazyScreen(() => import('../screens/textbook')) },
      ...devRoutes,
      { path: '*', element: <Navigate to={paths.home()} replace /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
