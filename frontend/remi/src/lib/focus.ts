/**
 * Focus management helpers (arch-frontend-core §8):
 * - palette input at +30ms, focus back to where it was on close;
 * - drawer textarea at 380ms with the caret at the end, focus back to the trigger on close;
 * - palette and keyboard navigation focus the new screen's h1 (tabIndex -1);
 * - Notes composer 40ms after the day swap.
 */

/** Delays used by the prototype. */
export const FOCUS_DELAY = {
  palette: 30,
  drawer: 380,
  notesComposer: 40,
  editUpdate: 30,
} as const;

type FocusTarget = HTMLElement | null | undefined | (() => HTMLElement | null | undefined);

function resolve(target: FocusTarget): HTMLElement | null {
  const el = typeof target === 'function' ? target() : target;
  return el ?? null;
}

/** Focuses `target` after `delay` ms (0 = next task). Returns a cancel function. */
export function focusSoon(target: FocusTarget, delay = 0, options: FocusOptions = { preventScroll: true }): () => void {
  const id = setTimeout(() => {
    resolve(target)?.focus(options);
  }, delay);
  return () => {
    clearTimeout(id);
  };
}

/** Puts the caret at the end of a text field (the drawer's prefilled composer). */
export function placeCaretAtEnd(el: HTMLTextAreaElement | HTMLInputElement): void {
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // Some input types (email, number) have no selection API.
  }
}

/**
 * Remembers the focused element (or `target`, a trigger recorded earlier) and returns a
 * function that puts focus back there, if it is still in the document and not inert.
 */
export function captureFocus(target?: HTMLElement | null): () => void {
  const previous = target !== undefined ? target : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return () => {
    if (previous && previous !== document.body && previous.isConnected && !previous.closest('[inert]')) {
      previous.focus({ preventScroll: true });
    }
  };
}

/** Focuses the first h1 inside `root` (screens give it tabIndex -1). Returns true if found. */
export function focusScreenHeading(root: ParentNode | null | undefined): boolean {
  const h1 = root?.querySelector<HTMLElement>('h1');
  if (!h1) return false;
  if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1;
  h1.focus({ preventScroll: true });
  return true;
}

/** True when focus is inside `root`. */
export function containsFocus(root: Element | null | undefined): boolean {
  return !!root && root.contains(document.activeElement);
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab / Shift+Tab inside `root` (a modal card): from the last tabbable element Tab wraps
 * to the first, and from the first Shift+Tab wraps to the last. Call from the card's onKeyDown.
 */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest('[inert]'));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
