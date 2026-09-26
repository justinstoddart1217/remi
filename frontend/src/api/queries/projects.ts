/**
 * Project reads outside the plan bundle: `GET /projects`, `GET /projects/{id}`, the history
 * scrubber's `GET /projects/{id}/snapshots`, and the Workspace's replan dry run
 * (`POST /projects/{id}/replan/preview`, debounced 150ms, previous result kept on screen).
 *
 * Screens normally read projects from the plan (`useProject`, `useProjects` in ./plan).
 */

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';

import { api, retryApi, unwrap } from '../client';
import type { RemiApiError } from '../client';
import { keys } from '../keys';
import type { ProjectOut, ProjectSnapshotOut, ReplanIn, ReplanPreviewOut } from '../types';
import { PREVIEW_DEBOUNCE_MS, useDebouncedValue } from '../useDebouncedValue';

export function projectsListQuery() {
  return queryOptions<ProjectOut[], RemiApiError>({
    queryKey: keys.projects.list,
    queryFn: ({ signal }) => unwrap(api.GET('/projects', { signal })),
    retry: retryApi,
  });
}

/** `GET /projects`. Prefer `useProjects()` (the plan) in screens. */
export function useProjectsQuery() {
  return useQuery(projectsListQuery());
}

export function projectQuery(projectId: string) {
  return queryOptions<ProjectOut, RemiApiError>({
    queryKey: keys.projects.detail(projectId),
    queryFn: ({ signal }) => unwrap(api.GET('/projects/{projectId}', { params: { path: { projectId } }, signal })),
    retry: retryApi,
  });
}

/** `GET /projects/{projectId}`. Prefer `useProject(id)` (the plan) in screens. */
export function useProjectQuery(projectId: string | null | undefined) {
  return useQuery({ ...projectQuery(projectId ?? ''), enabled: Boolean(projectId) });
}

export function snapshotsQuery(projectId: string) {
  return queryOptions<ProjectSnapshotOut[], RemiApiError>({
    queryKey: keys.projects.snapshots(projectId),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/projects/{projectId}/snapshots', { params: { path: { projectId } }, signal })),
    structuralSharing: true,
    retry: retryApi,
  });
}

/** Check-in snapshots for the Workspace history scrubber, oldest first. */
export function useSnapshots(projectId: string | null | undefined) {
  return useQuery({ ...snapshotsQuery(projectId ?? ''), enabled: Boolean(projectId) });
}

/**
 * What a replan would do, without saving. `input` null means no edit in progress. The request
 * waits for the input to settle for 150ms, and the last answer stays while the next loads.
 */
export function useReplanPreview(projectId: string | null | undefined, input: ReplanIn | null) {
  const settled = useDebouncedValue(input, PREVIEW_DEBOUNCE_MS);
  const id = projectId ?? '';
  return useQuery<ReplanPreviewOut, RemiApiError>({
    queryKey: keys.projects.replanPreview(id, settled ?? {}),
    queryFn: ({ signal }) =>
      unwrap(
        api.POST('/projects/{projectId}/replan/preview', {
          params: { path: { projectId: id } },
          body: settled ?? {},
          signal,
        }),
      ),
    enabled: Boolean(projectId) && settled !== null,
    placeholderData: keepPreviousData,
    retry: retryApi,
  });
}
