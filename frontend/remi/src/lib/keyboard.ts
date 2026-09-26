/**
 * The global keyboard map: one window `keydown` listener, installed by RootLayout
 * (arch-frontend-core §8).
 *
 * - ⌘K / Ctrl+K (app routes only): preventDefault and toggle the palette, even while typing.
 * - Escape: close the topmost overlay layer (palette, drawer, side panels …), one per press.
 *   Anything that handles Escape first stops propagation so it never reaches this listener:
 *     1. InlineEditable fields revert (React's synthetic stopPropagation also stops the
 *        native event before it reaches window);
 *     2. the Workspace date picker (capture phase);
 *     3. Textbook's fullscreen chart, then its slash menu (as layers or local handlers).
 * - ⌘/Ctrl+Enter is handled on the drawer root by the check-in content, not here.
 */

import { useEffect, useRef } from 'react';

import { useOverlays } from '../stores/overlays';

/** ⌘K on macOS, Ctrl+K elsewhere. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k';
}

/** ⌘↵ / Ctrl+↵. */
export function isSubmitShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter';
}

/** Any of ⌘, Ctrl, Alt held (Shift is not a modifier for shortcuts like `1` / `2`). */
export function hasModifier(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

/** True when keystrokes on `target` are text entry (inputs, textareas, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLSelectElement) return !target.disabled;
  if (target instanceof HTMLInputElement) {
    const nonText = ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'];
    return !nonText.includes(target.type) && !target.readOnly && !target.disabled;
  }
  return false;
}

/**
 * Single-key shortcuts (Home's `1` / `2`) should be ignored with a modifier, on auto-repeat,
 * while typing, or during IME composition.
 */
export function shouldIgnorePlainKey(e: KeyboardEvent): boolean {
  return hasModifier(e) || e.repeat || e.isComposing || isEditableTarget(e.target);
}

export interface GlobalKeyEnv {
  /** True on /app routes, where the palette exists. */
  isApp: () => boolean;
}

/** The global handler, exported for tests. */
export function handleGlobalKeydown(e: KeyboardEvent, env: GlobalKeyEnv): void {
  if (e.isComposing) return;
  if (isPaletteShortcut(e)) {
    if (!env.isApp()) return;
    e.preventDefault();
    if (e.repeat) return;
    useOverlays.getState().togglePalette();
    return;
  }
  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;
    if (useOverlays.getState().closeTop()) e.preventDefault();
  }
}

/** Installs the global listener for the lifetime of the calling component (RootLayout). */
export function useGlobalKeys(isApp: boolean): void {
  const isAppRef = useRef(isApp);
  useEffect(() => {
    isAppRef.current = isApp;
  }, [isApp]);
  useEffect(() => {
    const env: GlobalKeyEnv = { isApp: () => isAppRef.current };
    const onKey = (e: KeyboardEvent) => {
      handleGlobalKeydown(e, env);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
