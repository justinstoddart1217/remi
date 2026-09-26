import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link } from 'react-router';

import { Eyebrow } from '../../../components';
import { paths } from '../../../app/screens';
import { useArrival } from '../../../lib/arrival';
import { focusScreenHeading } from '../../../lib/focus';
import { plural } from '../../../lib/format';
import { useUi } from '../../../stores/ui';
import { arriveStyle } from './arrive';
import { BarsGraphic, BrandMark } from './Brand';
import s from './Frame.module.css';

export interface PageFrameProps {
  /** `data-screen-label` of the page ('Setup', 'Settings'). */
  screenLabel: string;
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  /** Right side of the header (after the wordmark). */
  headerRight?: ReactNode;
  /** The step rail beside the column. */
  rail?: ReactNode;
  /** Link the wordmark to Home (Settings); plain text on first run. */
  homeLink?: boolean;
  /** The caps line under REMI ('Workflow · Private Credit → Fixed Income'). */
  brandNote?: string;
  children: ReactNode;
}

/**
 * Arrival focus, as ScreenStack gives app screens: the page's h1 (tabIndex -1) takes focus
 * once it mounts, so ⌘K 'Edit setup' and the first-run redirect do not leave focus on
 * <body>. Anything that already holds focus by then (a hash jump to a section) keeps it.
 */
function useArrivalFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    useUi.getState().takeHeadingFocus();
    const frame = requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current && current !== document.body && current.isConnected) return;
      focusScreenHeading(root.current);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [root]);
}

/**
 * The Home frame for Setup and Settings (Remi Home.dc.html): a dark-teal band holding the
 * 96px header (the REMI bar mark and wordmark, Home's facts) and the hero, with the Ninety One
 * bars drifting on its right; the step cards and the rail rise over the band's foot. Arrival
 * plays once on mount (header fade, then the hero and cards rise with a 40ms stagger), and
 * the h1 takes focus.
 */
export function PageFrame({
  screenLabel,
  eyebrow,
  title,
  lead,
  headerRight,
  rail,
  homeLink = false,
  brandNote = 'Workflow · Private Credit → Fixed Income',
  children,
}: PageFrameProps) {
  const arrival = useArrival(true);
  const root = useRef<HTMLDivElement>(null);
  useArrivalFocus(root);
  const brand = (
    <>
      <BrandMark />
      <span className={s.brandWords}>
        <span className={s.wordmark}>Remi</span>
        <span className={s.brandNote}>{brandNote}</span>
      </span>
    </>
  );
  return (
    <div ref={root} className={s.page} data-screen-label={screenLabel} {...arrival.attrs}>
      <div className={s.band}>
        <BarsGraphic />
        <header className={s.header}>
          {homeLink ? (
            <Link to={paths.home()} className={s.brand} aria-label="Remi, home">
              {brand}
            </Link>
          ) : (
            <span className={s.brand}>{brand}</span>
          )}
          <span className={s.headerSpacer} />
          {headerRight}
        </header>
        <div className={clsx(s.hero, s.arrive)} style={arriveStyle(0)}>
          <Eyebrow className={s.heroEyebrow}>{eyebrow}</Eyebrow>
          <h1 className={s.title} tabIndex={-1}>
            {title}
          </h1>
          {lead && <p className={s.lead}>{lead}</p>}
        </div>
        <span className={s.flow} aria-hidden="true" />
      </div>
      <main className={s.main}>
        <div className={s.column}>{children}</div>
        {rail && (
          <aside className={clsx(s.rail, s.arrive)} style={arriveStyle(2)}>
            {rail}
          </aside>
        )}
      </main>
    </div>
  );
}

export interface HeaderFactsProps {
  /** 'Mon 5 Oct', or '' before it is known. */
  today: string;
  /** 'BD3', or '' on a non-business day. */
  bd: string;
  /** Business days to the move; null shows a dash. */
  countdown: number | null;
}

/**
 * Home's header facts, as Home sets them on the band (plain text, no Roll; the live Roll is
 * in step 1): 'MON 5 OCT · BD3 | 61 business days to Fixed Income'.
 */
export function HeaderFacts({ today, bd, countdown }: HeaderFactsProps) {
  return (
    <>
      {today && (
        <span className={s.facts}>
          {today}
          {bd && ` · ${bd}`}
        </span>
      )}
      {today && <span className={s.divider} aria-hidden="true" />}
      <span className={s.factCount}>
        <span className={s.factCountNum}>{countdown == null ? '—' : String(countdown)}</span>
        <span className={s.factText}>{plural(countdown ?? 0, 'business day')} to Fixed Income</span>
      </span>
    </>
  );
}

/** A 1px × 20px rule between header groups. */
export function HeaderDivider() {
  return <span className={s.divider} aria-hidden="true" />;
}
