import { useCallback, useEffect, useRef, useState } from 'react';

import { isReducedMotion } from '../../../lib/reducedMotion';

/** Keys that scroll the page (outside a field), and so end a jump's hold on the rail. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);

function isFieldTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"]') !== null
  );
}

/** A control that takes Space for itself (it presses the control, it does not scroll). */
function isPressTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      'button, summary, [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], [role="menuitem"], [role="tab"]',
    ) !== null
  );
}

/** Whether a key press scrolls the page (and so hands the rail back to the scroll position). */
function scrollsPage(e: KeyboardEvent): boolean {
  if (!SCROLL_KEYS.has(e.key) || e.defaultPrevented || isFieldTarget(e.target)) return false;
  return !(e.key === ' ' && isPressTarget(e.target));
}

/**
 * Which section is in view: the last one whose top has passed 35% of the viewport (the first
 * one until then), or the last section once the page cannot scroll further.
 *
 * `jump(id)` scrolls a section to the top, focuses its heading and marks it current. Focus
 * moving into a section (a click on a field, Tab) marks that section current in the same way.
 * The mark holds until the reader scrolls (wheel, touch, a scroll key, the scrollbar) or focus
 * moves into another section, so a section near the bottom that cannot reach the top, or one
 * the reader is typing in, still reads as current.
 */
export function useScrollSpy(ids: readonly string[]) {
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  const pinned = useRef<string | null>(null);
  const key = ids.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    const measure = () => {
      if (pinned.current !== null) return;
      const line = window.innerHeight * 0.35;
      let hit: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) hit = id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && window.scrollY > 0) hit = list[list.length - 1] ?? hit;
      setCurrent((prev) => (prev === hit ? prev : hit));
    };
    // The reader scrolls: the page decides again (at the end, that is the last section).
    const release = () => {
      if (pinned.current === null) return;
      pinned.current = null;
      measure();
    };
    const onKey = (e: KeyboardEvent) => {
      if (pinned.current !== null && scrollsPage(e)) release();
    };
    // A press on the page's own scrollbar lands on <html>.
    const onPointer = (e: PointerEvent) => {
      if (e.target === document.documentElement) release();
    };
    // Focus inside a section marks it current, every time (not only after a jump), so moving
    // back into the section above takes the rail back with it.
    const onFocus = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      const section = list.find((id) => document.getElementById(id)?.contains(target));
      if (!section) return;
      pinned.current = section;
      setCurrent((prev) => (prev === section ? prev : section));
    };
    const first = requestAnimationFrame(measure);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('focusin', onFocus);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('focusin', onFocus);
    };
  }, [key]);

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    pinned.current = id;
    setCurrent(id);
    el.scrollIntoView({ behavior: isReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, []);

  return { current, jump };
}
