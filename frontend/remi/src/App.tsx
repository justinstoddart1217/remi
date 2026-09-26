import { RouterProvider } from 'react-router';

import { Providers } from './app/providers';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router';

const queryClient = createQueryClient();
const router = createAppRouter();

/** The app: providers around the data router (routes in app/router.tsx). */
export function App() {
  return (
    <Providers client={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}
