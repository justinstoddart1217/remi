/** Milestones and their tasks (Workspace plan, Today's checklist of tasks). */

import { api, unwrap } from '../client';
import type { Schemas } from '../client';
import type { WithDefaults } from '../types';
import { PLAN_READS, usePlanMutation } from './core';

/** `POST /projects/{id}/milestones`: add a Now or Next milestone. */
export function useCreateMilestone() {
  return usePlanMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: WithDefaults<Schemas['MilestoneCreate'], 'name'> }) =>
      unwrap(
        api.POST('/projects/{projectId}/milestones', {
          params: { path: { projectId } },
          body: { ...body, name: body.name ?? '' },
        }),
      ),
    invalidate: PLAN_READS,
  });
}

/** `PUT /projects/{id}/milestones/order`. */
export function useReorderMilestones() {
  return usePlanMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      unwrap(api.PUT('/projects/{projectId}/milestones/order', { params: { path: { projectId } }, body: { ids } })),
    invalidate: PLAN_READS,
  });
}

/** `PATCH /milestones/{id}`: rename, re-date or tick. */
export function useUpdateMilestone() {
  return usePlanMutation({
    mutationFn: ({ milestoneId, patch }: { milestoneId: string; patch: Schemas['MilestonePatch'] }) =>
      unwrap(api.PATCH('/milestones/{milestoneId}', { params: { path: { milestoneId } }, body: patch })),
    invalidate: PLAN_READS,
  });
}

/** `DELETE /milestones/{id}`: the milestone and its tasks. */
export function useDeleteMilestone() {
  return usePlanMutation({
    mutationFn: ({ milestoneId }: { milestoneId: string }) =>
      unwrap(api.DELETE('/milestones/{milestoneId}', { params: { path: { milestoneId } } })),
    invalidate: PLAN_READS,
  });
}

/** `POST /milestones/{id}/tasks`: add a task to a Now milestone. */
export function useCreateTask() {
  return usePlanMutation({
    mutationFn: ({ milestoneId, body }: { milestoneId: string; body: WithDefaults<Schemas['TaskCreate'], 'hours' | 'text'> }) =>
      unwrap(
        api.POST('/milestones/{milestoneId}/tasks', {
          params: { path: { milestoneId } },
          body: { ...body, hours: body.hours ?? 1, text: body.text ?? '' },
        }),
      ),
    invalidate: PLAN_READS,
  });
}

/** `PUT /milestones/{id}/tasks/order`. */
export function useReorderTasks() {
  return usePlanMutation({
    mutationFn: ({ milestoneId, ids }: { milestoneId: string; ids: string[] }) =>
      unwrap(api.PUT('/milestones/{milestoneId}/tasks/order', { params: { path: { milestoneId } }, body: { ids } })),
    invalidate: PLAN_READS,
  });
}

/** `PATCH /tasks/{id}`: edit or tick a task. */
export function useUpdateTask() {
  return usePlanMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Schemas['TaskPatch'] }) =>
      unwrap(api.PATCH('/tasks/{taskId}', { params: { path: { taskId } }, body: patch })),
    invalidate: PLAN_READS,
  });
}

/** `DELETE /tasks/{id}`. */
export function useDeleteTask() {
  return usePlanMutation({
    mutationFn: ({ taskId }: { taskId: string }) => unwrap(api.DELETE('/tasks/{taskId}', { params: { path: { taskId } } })),
    invalidate: PLAN_READS,
  });
}
