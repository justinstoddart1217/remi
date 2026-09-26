import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BusinessClock } from './BusinessClock';
import { clockCity, clockZone, DEFAULT_CLOCK_TZ, formatClock, isTimeZone, msToNextSecond } from './clock';

// Mon 5 Oct 2026 09:30:00 in London (BST, UTC+1): the parity runs' pinned browser clock.
const PINNED = new Date('2026-10-05T08:30:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('formatClock', () => {
  it('is the 24-hour wall-clock time in the zone', () => {
    expect(formatClock(PINNED, 'Europe/London')).toBe('09:30:00');
    expect(formatClock(PINNED, 'Africa/Johannesburg')).toBe('10:30:00');
    expect(formatClock(PINNED, 'America/New_York')).toBe('04:30:00');
    expect(formatClock(new Date('2026-10-04T23:00:05.000Z'), 'Europe/London')).toBe('00:00:05');
  });

  it("falls back to the design's zone for one the browser does not know", () => {
    expect(formatClock(PINNED, 'Mars/Olympus_Mons')).toBe('09:30:00');
  });
});

describe('clockCity', () => {
  it("is the zone's last segment with spaces for underscores", () => {
    expect(clockCity('Europe/London')).toBe('London');
    expect(clockCity('Africa/Johannesburg')).toBe('Johannesburg');
    expect(clockCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(clockCity('UTC')).toBe('UTC');
  });
});

describe('clockZone', () => {
  it('takes the first zone the browser knows: the plan, Settings, then Europe/London', () => {
    expect(clockZone('Africa/Johannesburg', 'Europe/London')).toBe('Africa/Johannesburg');
    expect(clockZone(null, 'Africa/Johannesburg')).toBe('Africa/Johannesburg');
    expect(clockZone('Not/AZone', undefined)).toBe(DEFAULT_CLOCK_TZ);
    expect(clockZone()).toBe('Europe/London');
    expect(isTimeZone('')).toBe(false);
  });
});

describe('msToNextSecond', () => {
  it('waits to the next whole second, a full second when on one', () => {
    expect(msToNextSecond(1_000)).toBe(1000);
    expect(msToNextSecond(1_250)).toBe(750);
    expect(msToNextSecond(1_999)).toBe(1);
  });
});

describe('BusinessClock', () => {
  it('shows the city over the time and ticks every second', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-05T08:30:00.400Z'));
    const { unmount } = render(<BusinessClock tz="Europe/London" />);
    expect(screen.getByText('London')).toBeInTheDocument();
    const time = screen.getByText('09:30:00');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '09:30:00');

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('09:30:01')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByText('09:31:00')).toBeInTheDocument();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('follows a change of business timezone', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(PINNED);
    const { rerender } = render(<BusinessClock tz="Europe/London" />);
    rerender(<BusinessClock tz="Africa/Johannesburg" />);
    expect(screen.getByText('Johannesburg')).toBeInTheDocument();
    expect(screen.getByText('10:30:00')).toBeInTheDocument();
  });
});
