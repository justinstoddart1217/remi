import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TwoStepConfirmButton } from './TwoStepConfirmButton';

describe('TwoStepConfirmButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (timeout?: number) => {
    const onConfirm = vi.fn();
    render(
      <TwoStepConfirmButton
        label="Remove project"
        armedLabel="Click again to remove ManCo pack automation and its history"
        onConfirm={onConfirm}
        timeout={timeout}
      />,
    );
    return onConfirm;
  };

  it('arms on the first click and confirms on the second', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));
    expect(onConfirm).not.toHaveBeenCalled();
    const armed = screen.getByRole('button', { name: /Click again to remove/ });
    expect(armed).toHaveAttribute('data-armed', 'true');
    fireEvent.click(armed);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove project' })).toHaveAttribute('data-armed', 'false');
  });

  it('disarms by itself after the timeout (4s by default)', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByRole('button')).toHaveTextContent(/Click again/);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button')).toHaveTextContent('Remove project');
    fireEvent.click(screen.getByRole('button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('honours a shorter timeout (Textbook 3.5s)', () => {
    setup(3500);
    fireEvent.click(screen.getByRole('button'));
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.getByRole('button')).toHaveTextContent('Remove project');
  });
});
