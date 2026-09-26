import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import type { RemiApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorBoundary';
import { BootFallback } from './BootFallback';
import { paths } from './screens';
import s from './SetupGate.module.css';
import { useSetupStatus } from './useSetupStatus';

export const UNREACHABLE_TITLE = 'Remi couldn’t reach its server on this computer.';

/** No answer at all: the server is not running (or stopped). */
export const START_HINT = 'If Remi has stopped, start it again with launch.command (launch.bat on Windows), then try again.';

/** An answer, but not the setup status (a 5xx, the origin check, a proxy page). */
export const RESTART_HINT =
  'It answered, but not in the way Remi expected. Restarting Remi with launch.command (launch.bat on Windows) usually fixes this.';

/** What to do about a status that could not be read, then the technical words, folded away. */
function Unreachable({ error }: { error: RemiApiError }) {
  const detail = error.status > 0 ? `${String(error.status)} · ${error.message}` : error.message;
  return (
    <>
      <p className={s.hint}>{error.status === 0 ? START_HINT : RESTART_HINT}</p>
      <details className={s.details}>
        <summary>Details</summary>
        <p className={s.detailsText}>{detail}</p>
      </details>
    </>
  );
}

/**
 * Sends a first run to /setup (decision 6: the app starts empty). While the status loads it
 * shows the boot fallback (nothing for 300ms, then "Starting Remi…"), so the empty app never
 * flashes before the redirect and a slow server is not a blank page. Leaving /setup once it is
 * complete is the wizard's job.
 *
 * When the status cannot be read at all (the server is down, a 5xx after the retries), the
 * gate shows an error with Try again instead of letting the app through: a fresh install
 * would otherwise show the start-empty screens as if they were the plan. The notice says how
 * to start Remi, with the browser's own words ("Failed to fetch") under Details. A route that
 * does not exist yet (404/501) is not an error; useSetupStatus counts it as "not required".
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const status = useSetupStatus();
  const { pathname } = useLocation();
  if (status.isPending) return <BootFallback />;
  // A failed refetch keeps the last answer (TanStack keeps `data`), so only a status never read
  // shows the error.
  if (status.data === undefined) {
    return (
      <ErrorNotice
        inset
        title={UNREACHABLE_TITLE}
        action={
          <Button
            variant="outline"
            size="s"
            disabled={status.isFetching}
            onClick={() => {
              void status.refetch();
            }}
          >
            {status.isFetching ? 'Trying…' : 'Try again'}
          </Button>
        }
      >
        <Unreachable error={status.error} />
      </ErrorNotice>
    );
  }
  if (status.data.required && pathname !== paths.setup()) return <Navigate to={paths.setup()} replace />;
  return children;
}
