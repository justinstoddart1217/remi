import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { texPlain, texRuns } from './textbookExcerpt';
import { ExcerptLineView } from './TextbookPreview';

describe('ExcerptLineView', () => {
  it('names a formula by its plain Unicode reading, on an element that can carry a name', () => {
    const tex = '\\Sigma^{-1} x_{t}^{2}';
    render(<ExcerptLineView line={{ kind: 'formula', text: texPlain(tex), runs: texRuns(tex) }} />);
    const formula = screen.getByRole('img', { name: 'Σ⁻¹ x_t²' });
    // The visible runs stay raised and lowered.
    expect(formula.querySelectorAll('sup')).toHaveLength(2);
    expect(formula.querySelectorAll('sub')).toHaveLength(1);
  });
});
