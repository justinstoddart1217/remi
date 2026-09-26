/**
 * The palette's content (Remi.dc.html paletteGroups), as providers for the palette registry.
 * The built-in 'Jump to' (order 20) comes from ../builtins; these add, in the prototype's order:
 *
 *   10 Quick add   '<n>h' anywhere in the query: "Add 6h of scope to Returns pipeline", hint
 *                  'check-in'. Opens Tell Remi on that project, prefilled with the scope.
 *   30 Projects    project names, hint the forecast ('Wed 2 Dec' / 'Not yet').
 *   40 Tell Remi   "Tell Remi about {short}", hint the last check-in ('2 days ago').
 *   50 Create      "New Private Credit project" / "New Fixed Income project".
 *   55 Setup       "Edit setup" (→ /settings).
 *   60 Create      "Reset to sample data" (dev builds only, and only when asked for).
 *
 * Everything but Quick add hides in quick-add mode. The palette shows the first 16 rows.
 * Projects and routines come from the cached plan (`GET /plan`); nothing is fetched here.
 */

import type { QueryClient } from '@tanstack/react-query';

import { api, commitPlanMutation, keys, NAMED_ENTITY_READS, unwrap } from '../../../api';
import type { PlanOut, ProjectDomain, ProjectOut } from '../../../api';
import { paths } from '../../../app/screens';
import { DOMAIN_ACCENT } from '../../../components/shared/domain';
import { s, since } from '../../../lib/format';
import { workspaceGoalPath } from '../../../screens/workspace/focus';
import type { PaletteActions, PaletteContext, PaletteItem, PaletteProvider } from '../types';

export const GROUP = {
  quickAdd: 'Quick add',
  projects: 'Projects',
  tellRemi: 'Tell Remi',
  create: 'Create',
  setup: 'Setup',
} as const;

/** The plan as last read (the palette reads, never fetches). */
export function planOf(queryClient: QueryClient): PlanOut | undefined {
  return queryClient.getQueryData<PlanOut>(keys.plan);
}

function projectsOf(ctx: PaletteContext): readonly ProjectOut[] {
  return planOf(ctx.queryClient)?.projects ?? [];
}

/** 'Wed 2 Dec', or 'Not yet' while the project is in Define. */
export function forecastHint(project: ProjectOut): string {
  return project.forecastDate ? s(project.forecastDate) : 'Not yet';
}

// ------------------------------------------------------------------------------ empty text

/**
 * The quick-add example for the no-match copy: the first word of a real project's short name
 * ("ManCo automation" → "manco"). The prototype's example names the second project, so the
 * example differs from the input placeholder's "+6h returns"; with one planned project it
 * names that one. Only projects with a forecast can take quick-add scope.
 */
export function quickAddExample(projects: readonly ProjectOut[]): string | null {
  const planned = projects.filter((p) => p.forecastDate != null);
  const project = planned[1] ?? planned[0];
  const word = project?.short.trim().split(/\s+/)[0]?.toLowerCase();
  if (!word) return null;
  return word;
}

/** "Nothing matches that. …" with a real project's short name, or no example without one. */
export function noMatchText(projects: readonly ProjectOut[]): string {
  const example = quickAddExample(projects);
  return example
    ? `Nothing matches that. Try a project name, a screen, or “+4h ${example}”.`
    : 'Nothing matches that. Try a project name or a screen.';
}

// ------------------------------------------------------------------------------ providers

export const quickAddProvider: PaletteProvider = {
  id: 'quick-add',
  order: 10,
  items: (ctx) => {
    const { quickAdd, actions } = ctx;
    if (!quickAdd) return [];
    return projectsOf(ctx)
      .filter((p) => p.forecastDate != null && (!quickAdd.rest || `${p.name} ${p.short}`.toLowerCase().includes(quickAdd.rest)))
      .map(
        (p): PaletteItem => ({
          key: p.id,
          group: GROUP.quickAdd,
          label: `Add ${String(quickAdd.hours)}h of scope to ${p.short}`,
          hint: 'check-in',
          dot: DOMAIN_ACCENT[p.domain],
          run: () => {
            actions.openCheckIn(p.id, { scopeH: quickAdd.hours });
          },
        }),
      );
  },
  // Before the plan is read there is nothing to say about projects, so the frame's default copy
  // stays; a read plan names a real project, or drops the example when none is planned.
  emptyText: (ctx) => {
    const plan = planOf(ctx.queryClient);
    return plan ? noMatchText(plan.projects) : null;
  },
};

export const projectsProvider: PaletteProvider = {
  id: 'projects',
  order: 30,
  items: (ctx) => {
    const { q, quickAdd, actions } = ctx;
    if (quickAdd) return [];
    return projectsOf(ctx)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map(
        (p): PaletteItem => ({
          key: p.id,
          group: GROUP.projects,
          label: p.name,
          hint: forecastHint(p),
          dot: DOMAIN_ACCENT[p.domain],
          run: () => {
            actions.openProject(p.id);
          },
        }),
      );
  },
};

export const tellRemiProvider: PaletteProvider = {
  id: 'tell-remi',
  order: 40,
  items: (ctx) => {
    const { q, quickAdd, actions } = ctx;
    if (quickAdd) return [];
    return projectsOf(ctx)
      .filter(
        (p) =>
          !q ||
          `check in ${p.name}`.toLowerCase().includes(q) ||
          `tell remi about ${p.short}`.toLowerCase().includes(q),
      )
      .map(
        (p): PaletteItem => ({
          key: p.id,
          group: GROUP.tellRemi,
          label: `Tell Remi about ${p.short}`,
          hint: since(p.derived.sinceDays),
          dot: DOMAIN_ACCENT[p.domain],
          run: () => {
            actions.openCheckIn(p.id);
          },
        }),
      );
  },
};

const NEW_PROJECT: readonly { domain: ProjectDomain; label: string }[] = [
  { domain: 'pc', label: 'New Private Credit project' },
  { domain: 'fi', label: 'New Fixed Income project' },
];

/**
 * `POST /projects` (a new project in Define), then the new workspace with its goal focused
 * (the prototype's createProject → focusGoal). The palette has already closed, so a failure
 * has nowhere to show; the plan simply stays as it was.
 */
export async function createProject(queryClient: QueryClient, domain: ProjectDomain, actions: PaletteActions): Promise<void> {
  try {
    const out = await unwrap(api.POST('/projects', { body: { domain } }));
    await commitPlanMutation(queryClient, out, { invalidate: NAMED_ENTITY_READS });
    actions.navigate(workspaceGoalPath(paths.project(out.entity.id)));
  } catch {
    // Nothing to roll back: the plan was not touched.
  }
}

export const createProvider: PaletteProvider = {
  id: 'create',
  order: 50,
  items: ({ q, quickAdd, queryClient, actions }) => {
    // A project needs a plan to join: nothing to create into while the plan is unread.
    if (quickAdd || !planOf(queryClient)) return [];
    return NEW_PROJECT.filter(({ label }) => !q || label.toLowerCase().includes(q) || 'new project'.includes(q)).map(
      ({ domain, label }): PaletteItem => ({
        key: domain,
        group: GROUP.create,
        label,
        hint: '',
        dot: DOMAIN_ACCENT[domain],
        run: () => {
          void createProject(queryClient, domain, actions);
        },
      }),
    );
  },
};

/**
 * "Edit setup": the first-run choices live on the Settings page (ADR-0010). Matched on its
 * label, or as the start of "settings". Before setup the wizard is the place (and the plan is
 * unread), so the row waits for the plan.
 */
export const setupProvider: PaletteProvider = {
  id: 'edit-setup',
  order: 55,
  items: ({ q, quickAdd, queryClient, actions }) => {
    if (quickAdd || !planOf(queryClient)) return [];
    if (q && !'edit setup'.includes(q) && !'settings'.startsWith(q)) return [];
    return [
      {
        key: 'settings',
        group: GROUP.setup,
        label: 'Edit setup',
        hint: '',
        dot: 'var(--ink-faint)',
        run: () => {
          actions.navigate(paths.settings());
        },
      },
    ];
  },
};

/** `POST /dev/fixtures {design}`: back to the design's sample plan, then Today. */
export async function resetToSample(queryClient: QueryClient, actions: PaletteActions): Promise<void> {
  try {
    const out = await unwrap(api.POST('/dev/fixtures', { body: { fixture: 'design' } }));
    await commitPlanMutation(queryClient, out, { invalidate: 'all', force: true });
    actions.go('today');
  } catch {
    // The server has no fixtures outside dev and test: nothing changed.
  }
}

/** Dev builds only; shown only for a query that asks for it (as the prototype). */
export const devResetProvider: PaletteProvider = {
  id: 'dev-reset',
  order: 60,
  items: ({ q, quickAdd, queryClient, actions }) => {
    if (!import.meta.env.DEV || quickAdd || !q) return [];
    if (!'reset sample data'.includes(q) && !'reset to sample data'.includes(q)) return [];
    return [
      {
        key: 'reset',
        group: GROUP.create,
        label: 'Reset to sample data',
        hint: 'clears your edits',
        dot: 'var(--ink-faint)',
        run: () => {
          void resetToSample(queryClient, actions);
        },
      },
    ];
  },
};

export const paletteProviders: readonly PaletteProvider[] = [
  quickAddProvider,
  projectsProvider,
  tellRemiProvider,
  createProvider,
  setupProvider,
  devResetProvider,
];
