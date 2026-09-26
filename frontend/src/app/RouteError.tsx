import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { ErrorNotice } from '../components/ErrorBoundary';

/** Route-level error element (a failed lazy route or a render error outside a screen boundary). */
export function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <ErrorNotice inset title="Remi couldn’t show this page." action={
        // A full load, under the base path: the error may be a chunk that failed to load.
        <Link to="/" reloadDocument>
          Back to home
        </Link>
      }>
      {detail}
    </ErrorNotice>
  );
}
