import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Roll } from './Roll';
import { tokenize } from './tokenize';

/** The Roll's root in a rendered tree. */
function rollIn(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-roll]');
  if (!root) throw new Error('no Roll');
  return root;
}

const curs = (v: string) => tokenize(v).parts.map((p) => p.cur);
const idx = (v: string) => tokenize(v).parts.map((p) => p.i);

describe('tokenize', () => {
  it('rolls a weekday date in 6 columns', () => {
    const t = tokenize('Wed 2 Dec');
    expect(t.family).toBe('dateW');
    expect(curs('Wed 2 Dec')).toEqual(['Wed', ' ', '', '2', ' ', 'Dec']);
    // Wed is WD[2]; blank tens is DIG[0]; '2' is DIG[3]; Dec is MON[11].
    expect(idx('Wed 2 Dec')).toEqual([2, 0, 0, 3, 0, 11]);
  });

  it('rolls a date without a weekday in 4 columns', () => {
    const t = tokenize('5 Oct');
    expect(t.family).toBe('date');
    expect(curs('5 Oct')).toEqual(['', '5', ' ', 'Oct']);
    expect(idx('5 Oct')).toEqual([0, 6, 0, 9]);
    expect(curs('27 Nov')).toEqual(['2', '7', ' ', 'Nov']);
  });

  it('always gives numbers 7 columns: sign, 3 digits, dot, decimal, suffix', () => {
    expect(tokenize('+3 BD').family).toBe('num');
    expect(curs('+3 BD')).toEqual(['+', '', '', '3', '', '', ' BD']);
    expect(idx('+3 BD')).toEqual([1, 0, 0, 4, 0, 0, 0]);
    expect(curs('3.5')).toEqual(['', '', '', '3', '.', '5', '']);
    expect(idx('3.5')).toEqual([0, 0, 0, 4, 1, 6, 0]);
    expect(curs('17')).toEqual(['', '', '1', '7', '', '', '']);
  });

  it('normalises a hyphen to U+2212', () => {
    expect(curs('-2 BD')[0]).toBe('−');
    expect(tokenize('-2 BD').parts[0]?.i).toBe(2);
    expect(curs('−2 BD')[0]).toBe('−');
  });

  it('falls back to one static column for anything else', () => {
    for (const v of ['Not yet', 'Late Mar 2027', 'On target', '0.75', '1,234', 'Wednesday 2 December']) {
      const t = tokenize(v);
      expect(t.family).toBe('static');
      expect(t.parts).toEqual([{ cells: [v], cur: v, i: 0 }]);
    }
  });

  it('is memoised', () => {
    expect(tokenize('Fri 27 Nov')).toBe(tokenize('Fri 27 Nov'));
  });
});

describe('Roll', () => {
  it('reads as plain text in its sentence, not as an image, with the value once', () => {
    const { container, queryByRole } = render(
      <p>
        <Roll value="5" /> of 12 funds
      </p>,
    );
    const root = rollIn(container);
    expect(root).toHaveAttribute('data-roll', 'num');
    expect(queryByRole('img')).toBeNull();
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-label');
    // The sizer is the text node, then the aria-hidden strip: the value appears once as text.
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toHaveTextContent('5');
    expect(root.children[0]).not.toHaveAttribute('aria-hidden');
    expect(root.children[1]).toHaveAttribute('aria-hidden', 'true');
    expect(root.children[1]?.children).toHaveLength(7);
    expect(container.querySelector('[class*="srOnly"]')).toBeNull();
  });

  it('names a button whose content is a date Roll', () => {
    const { getByRole } = render(
      <button type="button" title="Change the start date">
        <Roll value="Mon 14 Sep" />
      </button>,
    );
    expect(getByRole('button', { name: 'Mon 14 Sep' })).toBeInTheDocument();
  });

  it('reads a label instead of the value, and has a decorative mode and data-* hooks', () => {
    const { container, getByRole, rerender } = render(
      <button type="button">
        <Roll value="+3 BD" label="3 business days later" data-parity="delta" />
      </button>,
    );
    expect(getByRole('button', { name: '3 business days later' })).toBeInTheDocument();
    const root = rollIn(container);
    expect(root).toHaveAttribute('data-parity', 'delta');
    // The sizer (the value) stays first for the parity harness but is hidden from assistive tech.
    expect(root.children[0]).toHaveTextContent('+3 BD');
    expect(root.children[0]).toHaveAttribute('aria-hidden', 'true');
    expect(root.children[2]).toHaveTextContent('3 business days later');
    rerender(
      <button type="button">
        <Roll value="+3 BD" decorative />
      </button>,
    );
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.children).toHaveLength(2);
    expect(getByRole('button')).toHaveAccessibleName('');
  });

  it('keeps column nodes across a same-family change and moves the reel', () => {
    const { container, rerender } = render(<Roll value="Fri 27 Nov" />);
    const strip = container.querySelector('[data-roll] > [aria-hidden="true"]');
    const first = strip?.children[0];
    const reel = () => strip?.children[0]?.children[1] as HTMLElement | undefined;
    expect(reel()?.style.transform).toBe('translateY(-5em)');
    rerender(<Roll value="Wed 2 Dec" />);
    expect(strip?.children[0]).toBe(first);
    expect(reel()?.style.transform).toBe('translateY(-2.5em)');
  });

  it('remounts the columns when the format family changes', () => {
    const { container, rerender } = render(<Roll value="Not yet" />);
    const first = container.querySelector('[aria-hidden="true"]')?.children[0];
    rerender(<Roll value="Wed 2 Dec" />);
    expect(container.querySelector('[aria-hidden="true"]')?.children[0]).not.toBe(first);
  });
});
