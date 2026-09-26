import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a checkbox with aria-checked and an accessible name', () => {
    render(<Checkbox checked={false} aria-label="Toggle task" />);
    const box = screen.getByRole('checkbox', { name: 'Toggle task' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box).toHaveAttribute('type', 'button');
  });

  it('reports the next value and reflects the checked state', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} aria-label="Fund" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox checked onChange={onChange} aria-label="Fund" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('uses its visible label as the name, and hides the box and glyph', () => {
    const { container } = render(<Checkbox checked>Allianz Credit Opportunities</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Allianz Credit Opportunities' })).toBeChecked();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveAttribute('data-checked', 'true');
  });

  it('does not toggle when a click handler prevents default', () => {
    const onChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onChange={onChange}
        aria-label="Locked"
        onClick={(e) => {
          e.preventDefault();
        }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
