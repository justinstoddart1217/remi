import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useGlobalKeys } from '../lib/keyboard';
import { useHover } from '../stores/hover';
import { useDocumentTitle } from './documentTitle';
import { SetupGate } from './SetupGate';
import { useAppearance } from './useAppearance';

/**
 * The root route: applies appearance to :root, installs the one global keydown listener,
 * clears the linked highlight on route change and window blur, names the page for the route
 * (`document.title`), and gates first run.
 */
export function RootLayout() {
  const { pathname } = useLocation();
  useAppearance();
  useDocumentTitle();
  useGlobalKeys(pathname.startsWith('/app/') || pathname === '/app');

  useEffect(() => {
    useHover.getState().clear();
  }, [pathname]);

  useEffect(() => {
    const onBlur = () => {
      useHover.getState().clear();
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <SetupGate>
      <Outlet />
    </SetupGate>
  );
}
