import { render } from '@testing-library/react';
import { act, StrictMode, useLayoutEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyedTimers, useTimers } from './timers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('KeyedTimers', () => {
  it('restarts a key that is set again', () => {
    const t = new KeyedTimers();
    const fn = vi.fn();
    t.set('a', 100, fn);
    vi.advanceTimersByTime(60);
    t.set('a', 100, fn);
    vi.advanceTimersByTime(60);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.size).toBe(0);
  });

  it('re-arms suspended timers for their remaining time, unless set again meanwhile', () => {
    const t = new KeyedTimers();
    const a = vi.fn();
    const b = vi.fn();
    t.set('a', 100, a);
    t.set('b', 100, b);
    vi.advanceTimersByTime(40);
    t.suspend();
    vi.advanceTimersByTime(200);
    expect(a).not.toHaveBeenCalled();
    const b2 = vi.fn();
    t.set('b', 500, b2);
    t.resume();
    vi.advanceTimersByTime(60);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(440);
    expect(b2).toHaveBeenCalledTimes(1);
  });
});

/** Arms a flash once per mount key, from a layout effect that skips its StrictMode replay. */
function Flash() {
  const timers = useTimers();
  const handled = useRef(false);
  const [on, setOn] = useState(false);
  useLayoutEffect(() => {
    if (handled.current) return;
    handled.current = true;
    setOn(true);
    timers.set('flash', 1600, () => {
      setOn(false);
    });
  }, [timers]);
  return <span data-testid="flash">{on ? 'on' : 'off'}</span>;
}

describe('useTimers', () => {
  it('keeps a timer through StrictMode’s simulated unmount and remount', () => {
    const { getByTestId } = render(
      <StrictMode>
        <Flash />
      </StrictMode>,
    );
    expect(getByTestId('flash')).toHaveTextContent('on');
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(getByTestId('flash')).toHaveTextContent('off');
  });

  it('never fires after a real unmount', () => {
    const fn = vi.fn();
    function Arm() {
      const timers = useTimers();
      useLayoutEffect(() => {
        timers.set('x', 100, fn);
      }, [timers]);
      return null;
    }
    const { unmount } = render(<Arm />);
    unmount();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
