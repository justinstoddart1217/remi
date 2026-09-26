import katex from 'katex';

export const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * TeX to HTML with the bundled KaTeX (arch-frontend-screens §4): display mode,
 * `throwOnError: false` (bad TeX shows in red instead of breaking the page) and
 * `trust: false` (no \href, \url or \htmlClass). KaTeX escapes everything it emits; the
 * fallback escapes the raw TeX, which closes the prototype's injection path (:564).
 */
export function renderTex(tex: string, fallbackClass = ''): string {
  try {
    return katex.renderToString(tex || '\\;', { displayMode: true, throwOnError: false, trust: false });
  } catch {
    return `<span class="${escapeHtml(fallbackClass)}">${escapeHtml(tex)}</span>`;
  }
}
