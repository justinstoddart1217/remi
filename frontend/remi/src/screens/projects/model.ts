/**
 * The Projects list's view model (Projects.dc.html renderVals): pure formatting over the
 * server's projects. Every number (status, delta, growth, staleness) comes from the API;
 * this only picks the copy and the colours.
 */

import type { ProjectDomain, ProjectOut } from '../../api';
import { delta, dm, num, s as short, since } from '../../lib/format';

export interface ProjectRowModel {
  id: string;
  domain: ProjectDomain;
  name: string;
  /** The goal sentence, or the empty-goal prompt. */
  goal: string;
  /** Goal in ink-muted: stale, or no goal yet. */
  goalMuted: boolean;
  stale: boolean;
  /** Calendar days since the last check-in (the stale badge). */
  sinceDays: number | null;
  /** Roll value: the forecast ('Wed 2 Dec') or 'Not yet' while in Define. */
  forecast: string;
  /** '+3 BD', 'On target', '−1 BD', or 'no plan' in Define. */
  chip: string;
  chipTone: 'risk' | 'neutral';
  /** 'target Fri 27 Nov' (or the fuzzy label, 'Late Mar 2027'). */
  target: string;
  /** '+17% · 70h', '0% · 40h', or '—' without a baseline. */
  growth: string;
  growthRisk: boolean;
  /** Widths of the scope bar's baseline and added parts ('85.714%'). */
  baseW: string;
  addW: string;
  confidence: number | null;
  /** 'Not yet' / 'Today' / 'Yesterday' / 'N days ago'. */
  sinceLabel: string;
  /** Arrival stagger index (PC rows first, then FI). */
  index: number;
}

export interface ProjectGroupModel {
  domain: ProjectDomain;
  label: string;
  note: string;
  /** Start-empty copy for a group with no projects (arch-frontend-screens §5). */
  empty: string;
  rows: ProjectRowModel[];
}

/** Projects.dc.html:75 (critique Projects:75). */
export const EMPTY_GOAL = 'No goal yet. Open the workspace to write what will be true when it is done.';

const GROUP_EMPTY: Record<ProjectDomain, string> = {
  pc: 'No Private Credit projects yet. Start one with + New project.',
  fi: 'No Fixed Income projects yet. Start one with + New project.',
};

/** The display target: the fuzzy label when set, else 'Fri 27 Nov'. */
export function targetText(p: Pick<ProjectOut, 'targetLabel' | 'targetDate'>): string {
  return p.targetLabel ?? short(p.targetDate);
}

/** Scope growth copy (critique Projects:82): '—' without a baseline, '0% · 40h' with no growth. */
export function growthText(baselineH: number, addedH: number, growthPct: number | null): string {
  if (!baselineH) return '—';
  const pct = growthPct != null && growthPct > 0 ? `+${String(growthPct)}%` : '0%';
  return `${pct} · ${num(baselineH + addedH)}h`;
}

function barWidths(baselineH: number, addedH: number): { baseW: string; addW: string } {
  if (!baselineH) return { baseW: '0%', addW: '0%' };
  const max = Math.max(1, baselineH + addedH);
  return { baseW: `${String((baselineH / max) * 100)}%`, addW: `${String((addedH / max) * 100)}%` };
}

export function projectRow(p: ProjectOut, index: number): ProjectRowModel {
  const d = p.derived;
  const define = d.status === 'define' || p.forecastDate == null;
  const goal = p.goal.trim();
  const growthPct = d.growthPct;
  return {
    id: p.id,
    domain: p.domain,
    name: p.name,
    goal: goal ? p.goal : EMPTY_GOAL,
    goalMuted: d.stale || !goal,
    stale: d.stale,
    sinceDays: d.sinceDays,
    forecast: define || p.forecastDate == null ? 'Not yet' : short(p.forecastDate),
    chip: define ? 'no plan' : delta(d.deltaBd),
    chipTone: d.status === 'risk' ? 'risk' : 'neutral',
    target: `target ${targetText(p)}`,
    growth: growthText(p.baselineHours, d.addedH, growthPct),
    growthRisk: growthPct != null && growthPct > 0,
    ...barWidths(p.baselineHours, d.addedH),
    confidence: p.confidence,
    sinceLabel: since(d.sinceDays),
    index,
  };
}

/**
 * The Private Credit note: 'Wind down by 4 Jan: automate or hand over · 1 past target'
 * (Projects.dc.html:98). The prototype's status clause assumes every project has a forecast;
 * Remi can have none (an empty plan) or Define projects without one (ADR-0007), so the clause
 * only claims what the forecasts show: nothing with no projects, 'no plan yet' when none has a
 * forecast, and 'none past target' when some are still in Define.
 */
export function pcNote(projects: readonly ProjectOut[], moveDate: string | null | undefined): string {
  const by = moveDate ? `by ${dm(moveDate)}` : 'before the move';
  const note = `Wind down ${by}: automate or hand over`;
  const pc = projects.filter((p) => p.domain === 'pc');
  if (pc.length === 0) return note;
  const atRisk = pc.filter((p) => p.derived.status === 'risk').length;
  const planned = pc.filter((p) => p.derived.status !== 'define').length;
  const clause =
    atRisk > 0
      ? `${String(atRisk)} past target`
      : planned === 0
        ? 'no plan yet'
        : planned < pc.length
          ? 'none past target'
          : 'all inside target';
  return `${note} · ${clause}`;
}

/** The header's helper line; the click hint only once there is a project to click. */
export function projectsHelper(count: number): string {
  return count > 0
    ? 'Private Credit first, then Fixed Income · click a project to open its workspace'
    : 'Private Credit first, then Fixed Income';
}

/**
 * Private Credit first, then Fixed Income, each in the plan's order. The arrival stagger
 * index runs on across the groups (the prototype's `i + 3` generalised to the PC count).
 */
export function projectGroups(projects: readonly ProjectOut[], moveDate: string | null | undefined): ProjectGroupModel[] {
  const pc = projects.filter((p) => p.domain === 'pc');
  const fi = projects.filter((p) => p.domain === 'fi');
  return [
    {
      domain: 'pc',
      label: 'Private Credit',
      note: pcNote(projects, moveDate),
      empty: GROUP_EMPTY.pc,
      rows: pc.map((p, i) => projectRow(p, i)),
    },
    {
      domain: 'fi',
      label: 'Fixed Income',
      note: 'Ready for day one, then build',
      empty: GROUP_EMPTY.fi,
      rows: fi.map((p, i) => projectRow(p, i + pc.length)),
    },
  ];
}

/** Row arrival delay: 40 + i × 30 ms (Projects.dc.html:73). */
export function rowDelayMs(index: number): number {
  return 40 + index * 30;
}
