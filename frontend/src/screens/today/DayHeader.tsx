import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { Icon } from '../../components';
import { BrandBars, BrandFlow } from '../home/Brand';
import s from './Today.module.css';

export interface DayHeaderProps {
  kicker: string;
  title: string;
  /** 'BD3 of 22'; null on a weekend or holiday, which shows `dayOff` instead. */
  bdLine: string | null;
  dayOff: string;
  /** '8h working day'. */
  workingDay: string;
  verdict: string;
  /** Shows 'Back to today' (previewing another day). */
  onBack: (() => void) | null;
  style?: CSSProperties;
}

/**
 * Today.dc.html:14-29, the dark-teal hero: the bars graphic, the kicker (+ Back to today), the
 * long date, the BD → hours · verdict line, and the flowing strip along the bottom edge.
 */
export function DayHeader({ kicker, title, bdLine, dayOff, workingDay, verdict, onBack, style }: DayHeaderProps) {
  return (
    <div className={clsx(s.hero, s.arrive)} style={style}>
      <BrandBars />
      <div className={s.kickerRow}>
        <span className={s.kicker}>{kicker}</span>
        {onBack && (
          <button type="button" className={s.back} onClick={onBack}>
            <Icon name="chevron_left" className={s.backIcon} />
            Back to today
          </button>
        )}
      </div>
      <h1 className={s.title} tabIndex={-1}>
        {title}
      </h1>
      <div className={s.meta}>
        {bdLine ? <span className={s.metaBd}>{bdLine}</span> : <span className={s.metaBd}>{dayOff}</span>}
        <span className={s.arrow} aria-hidden="true">
          →
        </span>
        <span>{workingDay}</span>
        {verdict && (
          <>
            <span className={s.sep} aria-hidden="true">
              ·
            </span>
            <span className={s.verdict}>{verdict}</span>
          </>
        )}
      </div>
      <BrandFlow />
    </div>
  );
}
