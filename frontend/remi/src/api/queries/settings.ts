/**
 * Settings, AI and setup reads: `GET /settings`, `GET /ai/status`, `GET /ai/audit`,
 * `GET /setup/countdown` (the wizard's live countdown) and `GET /health`. `GET /setup` is
 * `useSetupStatus` in app/useSetupStatus.ts (SetupGate).
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { isIsoDate } from '../../lib/calendar';
import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { compact, keys } from '../keys';
import type { PageParams } from '../keys';
import type { AiAuditPageOut, AiStatusOut, CountdownOut, HealthOut, SettingsOut } from '../types';

export function settingsQuery() {
  return queryOptions<SettingsOut, RemiApiError>({
    queryKey: keys.settings,
    queryFn: ({ signal }) => unwrap(api.GET('/settings', { signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** Settings (never includes an API key). Works before setup. */
export function useSettings() {
  return useQuery(settingsQuery());
}

export function aiStatusQuery() {
  return queryOptions<AiStatusOut, RemiApiError>({
    queryKey: keys.ai.status,
    queryFn: ({ signal }) => unwrap(api.GET('/ai/status', { signal })),
    retry: retryApi,
  });
}

/** Is the configured Tell Remi provider available? */
export function useAiStatus() {
  return useQuery(aiStatusQuery());
}

export function aiAuditQuery(params?: PageParams) {
  return queryOptions<AiAuditPageOut, RemiApiError>({
    queryKey: keys.ai.audit(params),
    queryFn: ({ signal }) => unwrap(api.GET('/ai/audit', { params: { query: compact(params) }, signal })),
    retry: retryApi,
  });
}

/** Provider calls, newest first (data only). */
export function useAiAudit(params?: PageParams) {
  return useQuery(aiAuditQuery(params));
}

export function setupCountdownQuery(moveDate: string, holidayRegion?: 'GB-ENG' | 'ZA' | null) {
  return queryOptions<CountdownOut, RemiApiError>({
    queryKey: keys.setup.countdown(moveDate, holidayRegion),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/setup/countdown', {
          params: { query: { moveDate, ...(holidayRegion ? { holidayRegion } : {}) } },
          signal,
        }),
      ),
    staleTime: 5 * 60_000,
    retry: retryApi,
  });
}

/**
 * Business days to a candidate move date (the wizard's live Roll). The last answer stays while
 * the next loads, so the Roll glides between values instead of blanking.
 */
export function useSetupCountdown(moveDate: string | null | undefined, holidayRegion?: 'GB-ENG' | 'ZA' | null) {
  const valid = moveDate != null && isIsoDate(moveDate);
  return useQuery({
    ...setupCountdownQuery(moveDate ?? '', holidayRegion),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
}

export function healthQuery() {
  return queryOptions<HealthOut, RemiApiError>({
    queryKey: keys.health,
    queryFn: ({ signal }) => unwrap(api.GET('/health', { signal })),
    retry: false,
  });
}

/** Liveness probe (identifies Remi). */
export function useHealth() {
  return useQuery(healthQuery());
}
