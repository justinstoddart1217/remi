import { memo } from 'react';

import { clockCity, formatClock, useNow } from './clock';
import s from './HeaderBar.module.css';

/**
 * The live clock (Remi.dc.html `LondonClock` and the span around it): the business timezone's
 * city in small mono caps over the time, 'HH:MM:SS', ticking every second. Its own component,
 * so each tick re-renders only these two spans. Not a live region: a clock that announced itself
 * every second would drown everything else.
 */
export const BusinessClock = memo(function BusinessClock({ tz }: { tz: string }) {
  const now = useNow();
  const time = formatClock(now, tz);
  return (
    <span className={s.clock}>
      <span className={s.clockCity}>{clockCity(tz)}</span>
      <time className={s.clockTime} dateTime={time}>
        {time}
      </time>
    </span>
  );
});
