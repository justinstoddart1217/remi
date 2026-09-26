/**
 * Home, the launcher (Remi Home.dc.html). A fixed 1920×1080 art-directed canvas scaled
 * uniformly: the dark-teal band with the bars graphic, the header with the REMI logo, the
 * greeting, two launcher cards overlapping the band's foot, and the footer.
 *
 * - Every number comes from `GET /home` and the plan: today, BD, the countdown, the counts,
 *   the key project, and the Control Panel preview (see model.ts).
 * - Clicking a card, or pressing 1 / 2, expands a blank paper card to the whole stage and
 *   navigates at +520ms; under reduced motion it navigates at once (crit Home:167). The keys
 *   ignore modifiers, auto-repeat, IME composition and text fields (crit :17).
 */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useHome } from '../../api';
import { paths } from '../../app/screens';
import { Icon } from '../../components';
import { bd, s as shortDate } from '../../lib/format';
import { shouldIgnorePlainKey } from '../../lib/keyboard';
import { isReducedMotion, useReducedMotion } from '../../lib/reducedMotion';
import { FRAME_1920 } from '../../lib/stage';
import { afterTwoFrames } from '../../lib/timers';
import { Stage } from '../../shell/Stage';
import { ApexLink } from '../../shell/ApexLink';
import { BrandBars, BrandFlow, LogoMark } from './Brand';
import { ControlPanelPreview } from './ControlPanelPreview';
import s from './Home.module.css';
import { countdownWords, greeting, headline } from './model';
import { TextbookPreview } from './TextbookPreview';

type CardId = 'plan' | 'textbook';

interface Expand {
  x: number;
  y: number;
  w: number;
  h: number;
  r: string;
  o: number;
  tr: string;
}

const REST: Expand = { x: 0, y: 0, w: 0, h: 0, r: '6px', o: 0, tr: 'none' };
const GROW =
  'left 420ms var(--spring-soft), top 420ms var(--spring-soft), width 420ms var(--spring-soft), height 420ms var(--spring-soft), border-radius 420ms var(--spring-soft)';

/** The browser clock's hour, refreshed each minute (the greeting follows the real clock). */
function useHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => {
      setHour(new Date().getHours());
    }, 60_000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return hour;
}

/** The expand overlay and navigation (:181-193). */
function useExpand(targets: Record<CardId, RefObject<HTMLDivElement | null>>) {
  const navigate = useNavigate();
  const [ex, setEx] = useState<Expand | null>(null);
  const busy = useRef(false);
  const timers = useRef<(() => void)[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((cancel) => {
        cancel();
      });
    },
    [],
  );

  const open = useCallback(
    (card: CardId) => {
      if (busy.current) return;
      const url = card === 'plan' ? paths.today() : paths.textbook();
      const el = targets[card].current;
      const parent = el?.offsetParent as HTMLElement | null | undefined;
      if (!el || !parent || isReducedMotion()) {
        void navigate(url);
        return;
      }
      busy.current = true;
      const rect = { x: el.offsetLeft + parent.offsetLeft, y: el.offsetTop + parent.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setEx({ ...rect, r: '6px', o: 0, tr: 'none' });
      timers.current.push(
        afterTwoFrames(() => {
          setEx({ ...rect, r: '6px', o: 1, tr: 'opacity 140ms var(--ease-out)' });
          const t1 = setTimeout(() => {
            setEx({ x: 0, y: 0, w: 1920, h: 1080, r: '0px', o: 1, tr: GROW });
          }, 120);
          const t2 = setTimeout(() => {
            void navigate(url);
          }, 520);
          timers.current.push(
            () => {
              clearTimeout(t1);
            },
            () => {
              clearTimeout(t2);
            },
          );
        }),
      );
    },
    [navigate, targets],
  );

  return { ex: ex ?? REST, open };
}

export function HomeScreen() {
  const home = useHome().data;
  const reduced = useReducedMotion();
  const hour = useHour();
  const [arrived, setArrived] = useState(false);
  const [hover, setHover] = useState<CardId | null>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => ({ plan: planRef, textbook: bookRef }), []);
  const { ex, open } = useExpand(targets);

  useEffect(() => afterTwoFrames(() => {
    setArrived(true);
  }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnorePlainKey(e)) return;
      if (e.key === '1') open('plan');
      else if (e.key === '2') open('textbook');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fade: CSSProperties = { opacity: arrived ? 1 : 0 };
  const rise = (on: boolean): CSSProperties => ({ opacity: on ? 1 : 0, transform: on || reduced ? 'none' : 'translateY(10px)' });
  const cardStyle = (card: CardId, delay: number): CSSProperties =>
    ({
      opacity: arrived ? 1 : 0,
      transform: arrived ? (hover === card && !reduced ? 'translateY(-4px)' : 'none') : reduced ? 'none' : 'translateY(14px)',
      '--card-delay': `${String(delay)}ms`,
    }) as CSSProperties;
  const cardProps = (card: CardId) => ({
    'data-hover': hover === card,
    'data-reduced': reduced,
    'data-parity': `home-card:${card}`,
    role: 'link',
    tabIndex: 0,
    onMouseEnter: () => {
      setHover(card);
    },
    onMouseLeave: () => {
      setHover(null);
    },
    onClick: () => {
      open(card);
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(card);
      }
    },
  });

  const today = home?.today ?? null;
  const countdown = home?.countdownBd ?? null;
  // 'Mon 5 Oct · BD3' (shown uppercase); a weekend or holiday shows the date alone.
  const dateLine = today ? `${shortDate(today)}${home?.isBd && home.bdm !== null ? ` · ${bd(home.bdm)}` : ''}` : '';

  return (
    <Stage label="Remi home" frame={FRAME_1920}>
      <div className={s.band}>
        <BrandBars />
        <BrandFlow />
      </div>

      <header className={s.header} style={fade}>
        <ApexLink />
        <span className={s.brand}>
          <LogoMark height={44} />
          <span className={s.wordmark}>
            <span className={s.wordmarkName}>REMI</span>
            <span className={s.wordmarkSub}>Workflow · Private Credit → Fixed Income</span>
          </span>
        </span>
        <span className={s.spacer} />
        <span className={s.dateCluster}>
          <span className={s.date}>{dateLine}</span>
        </span>
        {countdown !== null ? (
          <>
            <span className={s.divider} />
            <span className={s.countdown}>
              <span className={s.countdownN}>{countdown}</span>
              <span className={s.countdownWords}>{countdownWords(countdown)}</span>
            </span>
          </>
        ) : null}
      </header>

      <div className={s.hero}>
        <div className={s.greeting} style={rise(arrived)}>
          {greeting(hour, today)}
        </div>
        <h1 className={s.h1} style={rise(arrived)}>
          {headline(hour)}
        </h1>
      </div>

      <div className={s.grid}>
        <div ref={planRef} className={s.card} style={cardStyle('plan', 120)} aria-label="Control Panel" {...cardProps('plan')}>
          <div className={s.cardHead}>
            <span className={s.cardIndex}>01</span>
            <span className={s.cardTitle}>Control Panel</span>
            <span className={s.spacer} />
            <span className={s.go}>
              <Icon name="arrow_forward" className={s.goArrow} />
            </span>
          </div>
          <div className={s.cardDesc}>Today, the timeline, projects, routines and the move, recalculated as you go.</div>
          <ControlPanelPreview home={home} hover={hover === 'plan'} arrived={arrived} />
        </div>

        <div ref={bookRef} className={s.card} style={cardStyle('textbook', 170)} aria-label="Textbook" {...cardProps('textbook')}>
          <div className={s.cardHead}>
            <span className={s.cardIndex}>02</span>
            <span className={s.cardTitle}>Textbook</span>
            <span className={s.spacer} />
            <span className={s.go}>
              <Icon name="arrow_forward" className={s.goArrow} />
            </span>
          </div>
          <div className={s.cardDesc}>Numbered notes, clean formulas and live charts you drop in from Claude.</div>
          <TextbookPreview counts={home?.textbook} />
        </div>
      </div>

      <footer className={s.footer} style={fade}>
        <span>
          Press <span className={s.key}>1</span> or <span className={s.key}>2</span> to jump straight in
        </span>
        <span className={s.spacer} />
        <span>A personal instrument. Nothing here is shared.</span>
      </footer>

      <div
        className={s.expand}
        aria-hidden="true"
        style={{ left: ex.x, top: ex.y, width: ex.w, height: ex.h, borderRadius: ex.r, opacity: ex.o, transition: ex.tr }}
      />
    </Stage>
  );
}
