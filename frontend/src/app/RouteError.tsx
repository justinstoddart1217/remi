import { isRouteErrorResponse, useRouteError } from 'react-router';

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
    <ErrorNotice inset title="Remi couldn’t show this page." action={<a href="/">Back to home</a>}>
      {detail}
    </ErrorNotice>
  );
}
