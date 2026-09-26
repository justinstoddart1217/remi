import { useMemo } from 'react';

import { useCalendarRange } from '../../../api';
import type { PickerCalendar } from '../../../components';
import { useCalendarIndex as useIndexOverDays } from '../../../lib/calendar';
import type { CalendarIndex } from '../../../lib/calendar';
import type { HolidayRegion } from '../model';
import { pickerCalendar, pickerRange } from './pickerCalendar';

/**
 * Calendar days for the move-date picker: `GET /calendar` from today for about three years in
 * the region being chosen (it works before setup). Null until the days arrive.
 */
export function usePickerCalendar(
  today: string | null | undefined,
  region: HolidayRegion | null | undefined,
): { index: CalendarIndex | null; picker: PickerCalendar | null } {
  const range = today ? pickerRange(today) : null;
  const query = useCalendarRange(
    { from: range?.from, to: range?.to, holidayRegion: region ?? null },
    { enabled: range !== null && region != null },
  );
  const index = useIndexOverDays(query.data?.days);
  const ready = query.data !== undefined;
  return useMemo(
    () => (ready ? { index, picker: pickerCalendar(index) } : { index: null, picker: null }),
    [ready, index],
  );
}
