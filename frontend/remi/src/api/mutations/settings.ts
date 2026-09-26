/**
 * First-run setup, settings, and the write-only Anthropic key.
 *
 * Setup and settings answer `SettingsMutationOut` (the plan plus the settings entity): the plan
 * commits as usual, the settings cache takes the entity, and everything else is invalidated
 * because settings shape every read model. The AI key routes answer `AiStatusOut`, not the
 * plan: its `keySet` is copied into the cached plan and settings (`aiKeyConfigured`).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import type { SetupStatus } from '../../app/useSetupStatus';
import { api, unwrap } from '../client';
import type { RemiApiError, Schemas } from '../client';
import { keys } from '../keys';
import type { AiStatusOut, PlanOut, SettingsOut } from '../types';
import { commitPlanMutation, usePlanMutation } from './core';

function storeSettings(queryClient: QueryClient, settings: SettingsOut): void {
  queryClient.setQueryData<SettingsOut>(keys.settings, settings);
}

/**
 * `POST /setup`: complete first-run setup in one transaction. SetupGate lets the app through
 * straight away; the wizard navigates on.
 */
export function useCompleteSetup() {
  return usePlanMutation({
    mutationFn: (body: Schemas['SetupIn']) => unwrap(api.POST('/setup', { body })),
    invalidate: 'all',
    force: true,
    after: (queryClient, out) => {
      storeSettings(queryClient, out.entity);
      queryClient.setQueryData<SetupStatus>(keys.setup.status, (prev) => ({
        required: false,
        source: 'api',
        data: prev?.data ? { ...prev.data, needsSetup: false, missing: [] } : null,
      }));
    },
  });
}

/** `PATCH /settings`: plan-shaping changes re-derive the plan and may move forecasts. */
export function useUpdateSettings() {
  return usePlanMutation({
    mutationFn: (patch: Schemas['SettingsPatch']) => unwrap(api.PATCH('/settings', { body: patch })),
    invalidate: 'all',
    after: (queryClient, out) => {
      storeSettings(queryClient, out.entity);
    },
  });
}

export type UiPrefsPatch = Schemas['UiPrefsPatch'];
type UiPrefs = SettingsOut['uiPrefs'];

/** What each preference resets to when a patch sends `null` (services/views.py). */
const UI_PREF_DEFAULTS: UiPrefs = {
  collapsedPageIds: [],
  lastTextbookPageId: null,
  textbookSidebarOpen: true,
  timelineZoom: '3m',
};

/** The server's merge (services/settings.py `_merged_prefs`): a sent key replaces, `null` resets. */
export function mergeUiPrefs(prefs: UiPrefs, patch: UiPrefsPatch): UiPrefs {
  const next: Record<string, unknown> = { ...prefs };
  for (const [key, value] of Object.entries(patch) as [keyof UiPrefs, unknown][]) {
    if (value === undefined) continue;
    next[key] = value ?? UI_PREF_DEFAULTS[key];
  }
  return next as UiPrefs;
}

const UI_PREFS_MUTATION = ['settings', 'uiPrefs'] as const;

/**
 * `PATCH /settings {uiPrefs}`: small view preferences (Textbook sidebar and folds, the last
 * page, Timeline zoom). They shape no read model, so nothing is invalidated:
 * - the cached settings take the change at once (optimistic), so a toggle never waits;
 * - the answer's plan is committed as usual (it keeps the revision in step) and its settings
 *   entity is stored, unless a later preferences save is still in flight (that one lands last);
 * - a failed save refetches the settings, so the screen shows what is really saved.
 */
export function useUpdateUiPrefs() {
  const queryClient = useQueryClient();
  return useMutation<Schemas['SettingsMutationOut'], RemiApiError, UiPrefsPatch>({
    mutationKey: UI_PREFS_MUTATION,
    mutationFn: (uiPrefs) => unwrap(api.PATCH('/settings', { body: { uiPrefs } })),
    onMutate: async (uiPrefs) => {
      await queryClient.cancelQueries({ queryKey: keys.settings, exact: true });
      queryClient.setQueryData<SettingsOut>(keys.settings, (old) =>
        old ? { ...old, uiPrefs: mergeUiPrefs(old.uiPrefs, uiPrefs) } : old,
      );
    },
    onSuccess: async (out) => {
      await commitPlanMutation(queryClient, out);
      if (queryClient.isMutating({ mutationKey: UI_PREFS_MUTATION }) <= 1) storeSettings(queryClient, out.entity);
    },
    onError: () => {
      if (queryClient.isMutating({ mutationKey: UI_PREFS_MUTATION }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: keys.settings, exact: true });
      }
    },
  });
}

/** Mirrors a new AI status into every cache that shows `aiKeyConfigured`. */
export function storeAiStatus(queryClient: QueryClient, status: AiStatusOut): void {
  queryClient.setQueryData<AiStatusOut>(keys.ai.status, status);
  queryClient.setQueryData<PlanOut>(keys.plan, (plan) =>
    plan && plan.settings.aiKeyConfigured !== status.keySet
      ? { ...plan, settings: { ...plan.settings, aiKeyConfigured: status.keySet } }
      : plan,
  );
  queryClient.setQueryData<SettingsOut>(keys.settings, (settings) =>
    settings && settings.aiKeyConfigured !== status.keySet ? { ...settings, aiKeyConfigured: status.keySet } : settings,
  );
  void queryClient.invalidateQueries({ queryKey: keys.setup.status });
}

/**
 * `PUT /settings/ai-key`: store the Anthropic key in the keychain. It is never read back.
 *
 * The key is this mutation's `variables`, so the mutation is garbage-collected at once
 * (`gcTime: 0`): it leaves the MutationCache as soon as no component observes it (unmount, or
 * the next `mutate`). A form that stays mounted should call `reset()` once it has shown the
 * outcome; `aiKeyConfigured` / `keySet` in the caches already carry the success.
 */
export function usePutAiKey() {
  const queryClient = useQueryClient();
  return useMutation<AiStatusOut, RemiApiError, { apiKey: string }>({
    mutationFn: ({ apiKey }) => unwrap(api.PUT('/settings/ai-key', { body: { apiKey } })),
    gcTime: 0,
    onSuccess: (status) => {
      storeAiStatus(queryClient, status);
    },
  });
}

/** `DELETE /settings/ai-key`: forget the stored key. */
export function useDeleteAiKey() {
  const queryClient = useQueryClient();
  return useMutation<AiStatusOut, RemiApiError>({
    mutationFn: () => unwrap(api.DELETE('/settings/ai-key')),
    onSuccess: (status) => {
      storeAiStatus(queryClient, status);
    },
  });
}
