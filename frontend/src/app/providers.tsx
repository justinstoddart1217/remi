import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  client: QueryClient;
  children: ReactNode;
}

/** App-wide providers: the query cache and a last-resort error boundary. */
export function Providers({ client, children }: Props) {
  return (
    <ErrorBoundary label="Remi">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ErrorBoundary>
  );
}
