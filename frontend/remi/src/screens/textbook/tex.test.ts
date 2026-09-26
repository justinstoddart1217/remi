import { describe, expect, it } from 'vitest';

import { escapeHtml, renderTex } from './tex';

describe('renderTex', () => {
  it('renders display math with KaTeX', () => {
    const html = renderTex('\\frac{\\Delta P}{P}');
    expect(html).toContain('katex-display');
    expect(html).toContain('mfrac');
  });

  it('renders an empty formula as a thin space, not an error', () => {
    expect(renderTex('')).toContain('katex');
  });

  it('shows bad TeX in place instead of throwing', () => {
    expect(() => renderTex('\\frac{')).not.toThrow();
    expect(renderTex('\\frac{')).toContain('katex-error');
  });

  it('refuses links and raw HTML (trust: false)', () => {
    const html = renderTex('\\href{javascript:alert(1)}{x} \\htmlClass{evil}{y}');
    // The source TeX only appears escaped, in the MathML annotation.
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('class="evil"');
    expect(html).toContain('katex-mathml');
  });

  it('escapes markup in the TeX', () => {
    const html = renderTex('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
