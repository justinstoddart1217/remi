/**
 * Plan helpers for the workspace (Workspace.dc.html:536-548, :595-596): horizon split, focus
 * keys for freshly added lines, and the new-milestone offsets.
 */

import type { MilestoneOut } from '../../api';

/** Business days ahead for a new Now / Next milestone's date (Workspace.dc.html:595-596). */
export const NEW_NOW_BD = 9;
export const NEW_NEXT_BD = 20;

/** data-fk values: the prototype's focus keys, by id instead of list position. */
export const msKey = (id: string) => `ms:${id}`;
export const taskKey = (id: string) => `task:${id}`;

export const byOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

/** The Now and Next milestones, each in its own order ('explicit' ones are not in the plan). */
export function horizons(milestones: readonly MilestoneOut[]): { now: MilestoneOut[]; next: MilestoneOut[] } {
  return {
    now: milestones.filter((m) => m.horizon === 'now').sort(byOrder),
    next: milestones.filter((m) => m.horizon === 'next').sort(byOrder),
  };
}

/** The field with this data-fk inside `root`, or null. */
export function findField(root: ParentNode | null | undefined, fk: string): HTMLInputElement | HTMLTextAreaElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-fk]')) {
    if (el.getAttribute('data-fk') === fk) return el;
  }
  return null;
}
