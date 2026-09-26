import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BusinessDayDatePicker } from './BusinessDayDatePicker';
import type { PickerCalendar } from './BusinessDayDatePicker';

const HOL: Record<string, string> = { '2026-12-25': 'Christmas Day', '2026-12-28': 'Boxing Day (substitute day)' };
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const add = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const cal: PickerCalendar = {
  inRange: (d) => d >= '2026-11-01' && d <= '2027-01-31',
  isBd: (d) => dow(d) !== 0 && dow(d) !== 6 && !(d in HOL),
  holiday: (d) => HOL[d] ?? null,
  bdm: (d) => (cal.isBd(d) ? 1 : null),
  nextBD: (d) => {
    let x = d;
    while (!cal.isBd(x)) x = add(x, 1);
    return x;
  },
};

const setup = () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <BusinessDayDatePicker value="2026-12-18" today="2026-12-01" calendar={cal} x={0} y={0} onPick={onPick} onClose={onClose} label="Target" />,
  );
  return { onPick, onClose };
};

describe('BusinessDayDatePicker', () => {
  it('opens on the selected month, Monday first', () => {
    setup();
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    // 30 Nov 2026 is a Monday: the first cell of the grid.
    const days = screen.getAllByRole('button', { pressed: false });
    expect(days[0]).toHaveAttribute('aria-label', 'Mon 30 Nov');
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('18');
  });

  it('snaps a holiday or weekend pick forward to the next business day', () => {
    const { onPick, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fri 25 Dec · Christmas Day' }));
    expect(onPick).toHaveBeenCalledWith('2026-12-29');
    expect(onClose).toHaveBeenCalled();
  });

  it('stops month navigation at the end of the calendar range', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('January 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('closes on Escape in the capture phase without letting it reach other handlers', () => {
    const { onClose } = setup();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });
});
