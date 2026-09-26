import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from './SidePanel';

describe('SidePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const view = (item: string | null) => (
    <SidePanel item={item} width={460} label="Project">
      {(name) => <p>{name}</p>}
    </SidePanel>
  );

  it('keeps its last content mounted through the exit, then unmounts it', () => {
    const { rerender, container } = render(view('Returns pipeline'));
    const panel = container.querySelector('aside');
    expect(panel).toHaveAttribute('data-open', 'true');
    rerender(view(null));
    expect(panel).toHaveAttribute('data-open', 'false');
    expect(screen.getByText('Returns pipeline')).toBeInTheDocument();
    if (!panel) throw new Error('no panel');
    fireEvent.transitionEnd(panel, { propertyName: 'transform' });
    expect(screen.queryByText('Returns pipeline')).not.toBeInTheDocument();
  });

  it('falls back to a timer when no transitionend arrives', () => {
    const { rerender } = render(view('ManCo'));
    rerender(view(null));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText('ManCo')).not.toBeInTheDocument();
  });
});
