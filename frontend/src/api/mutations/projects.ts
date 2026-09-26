/**
 * Project mutations: create, edit, delete, replan (rate / work left / start), and the
 * data-only BAU-day hours and per-day overrides. Each commits the returned plan
 * (see ./core) and plays the plan moves.
 */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import { keys } from '../keys';
import { NAMED_ENTITY_READS, PLAN_READS, usePlanMutation } from './core';

export interface ProjectRef {
  projectId: string;
}

/** `POST /projects`: a new project in Define (no forecast). `entity` is the new project. */
export function useCreateProject() {
  return usePlanMutation({
    mutationFn: (body: Schemas['ProjectCreate']) => unwrap(api.POST('/projects', { body })),
    invalidate: NAMED_ENTITY_READS,
  });
}

/** `PATCH /projects/{id}`: text, target or data-only fields. Absent keys are unchanged. */
export function useUpdateProject() {
  return usePlanMutation({
    mutationFn: ({ projectId, patch }: ProjectRef & { patch: Schemas['ProjectPatch'] }) =>
      unwrap(api.PATCH('/projects/{projectId}', { params: { path: { projectId } }, body: patch })),
    invalidate: NAMED_ENTITY_READS,
  });
}

/**
 * `DELETE /projects/{id}`: the project and its history. The project's own reads (its
 * snapshots, its detail, a replan preview) are removed rather than refetched: they would 404.
 */
export function useDeleteProject() {
  return usePlanMutation({
    mutationFn: ({ projectId }: ProjectRef) =>
      unwrap(api.DELETE('/projects/{projectId}', { params: { path: { projectId } } })),
    invalidate: NAMED_ENTITY_READS,
    remove: ({ projectId }) => [
      keys.projects.snapshots(projectId),
      keys.projects.detail(projectId),
      ['projects', 'replan-preview', projectId],
    ],
  });
}

/** `POST /projects/{id}/replan`: refit the forecast after a rate, work-left or start edit. */
export function useReplanProject() {
  return usePlanMutation({
    mutationFn: ({ projectId, input }: ProjectRef & { input: Schemas['ReplanIn'] }) =>
      unwrap(api.POST('/projects/{projectId}/replan', { params: { path: { projectId } }, body: input })),
    invalidate: PLAN_READS,
  });
}

/** `PUT /projects/{id}/bau-day-hours`: the project's hours on routine days (data only). */
export function usePutBauDayHours() {
  return usePlanMutation({
    mutationFn: ({ projectId, body }: ProjectRef & { body: Schemas['BauDayHoursPut'] }) =>
      unwrap(api.PUT('/projects/{projectId}/bau-day-hours', { params: { path: { projectId } }, body })),
    invalidate: PLAN_READS,
  });
}

/** `PUT /projects/{id}/overrides/{iso}`: the project's hours on one day (data only). */
export function usePutHourOverride() {
  return usePlanMutation({
    mutationFn: ({ projectId, iso, hours }: ProjectRef & { iso: string; hours: number }) =>
      unwrap(api.PUT('/projects/{projectId}/overrides/{iso}', { params: { path: { projectId, iso } }, body: { hours } })),
    invalidate: PLAN_READS,
  });
}

/** `DELETE /projects/{id}/overrides/{iso}`: clear one day's override (data only). */
export function useDeleteHourOverride() {
  return usePlanMutation({
    mutationFn: ({ projectId, iso }: ProjectRef & { iso: string }) =>
      unwrap(api.DELETE('/projects/{projectId}/overrides/{iso}', { params: { path: { projectId, iso } } })),
    invalidate: PLAN_READS,
  });
}
