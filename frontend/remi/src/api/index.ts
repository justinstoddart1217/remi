/**
 * The frontend data layer over the generated contract. Screens import from here:
 *
 *   import { usePlan, useProject, useDay, useApplyCheckin } from '../../api';
 *
 * - `client`: the openapi-fetch client (`api`), `RemiApiError` and helpers;
 * - `keys`: query keys;
 * - `queries/*`: one hook per read endpoint, plus selectors over `GET /plan`;
 * - `mutations/*`: one hook per mutation endpoint; plan mutations commit the returned plan
 *   and play the plan moves (see mutations/core.ts).
 */

export {
  api,
  API_BASE_URL,
  chartUrl,
  isAbortError,
  isRemiApiError,
  newParseId,
  RemiApiError,
  unwrap,
} from './client';
export type { ApiErrorCode, ApiPaths, ClientErrorCode, Schemas, ServerErrorCode } from './client';
export { keys } from './keys';
export type { CalendarParams, EventParams, OccurrenceParams, PageParams, RangeParams } from './keys';
export type * from './types';
export { PREVIEW_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';

export * from './queries/plan';
export * from './queries/calendar';
export * from './queries/day';
export * from './queries/projects';
export * from './queries/routines';
export * from './queries/checkins';
export * from './queries/notes';
export * from './queries/textbook';
export * from './queries/settings';
export * from './queries/activity';

export * from './mutations/core';
export * from './mutations/projects';
export * from './mutations/charter';
export * from './mutations/milestones';
export * from './mutations/readiness';
export * from './mutations/routines';
export * from './mutations/rotation';
export * from './mutations/checkins';
export * from './mutations/notes';
export * from './mutations/aliases';
export * from './mutations/calendar';
export * from './mutations/settings';
export * from './mutations/textbook';
export * from './mutations/dev';
