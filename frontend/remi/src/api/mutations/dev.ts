/**
 * `POST /dev/fixtures` (only when the server runs with `REMI_ENV` dev or test): reset the
 * database to a named fixture. The palette's dev-only "Reset to sample data".
 */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import { usePlanMutation } from './core';

export type DevFixture = NonNullable<Schemas['DevFixturesIn']['fixture']>;

export function useLoadDevFixtures() {
  return usePlanMutation({
    mutationFn: (fixture: DevFixture = 'design') => unwrap(api.POST('/dev/fixtures', { body: { fixture } })),
    // Everything else (setup status included) is refetched.
    invalidate: 'all',
    // A reset may restart revisions; the fixture's plan always wins.
    force: true,
  });
}
