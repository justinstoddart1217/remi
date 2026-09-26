import { useEffect, useRef, useState } from 'react';

import { DeltaChip, ForecastEndDiamond, Roll, TargetMarker, TimelineBar } from '../../components';
import s from './SignatureDemo.module.css';

const TGT = 72;
const OLD = 72;
const NEW = 78;
const pct = (n: number) => `${String(n)}%`;

/**
 * "Signature moment: the plan moves" (Remi Foundations.dc.html:145-174, :340-351): the bar end
 * and overrun glide, the old end flashes and fades, the dates and the delta roll, and a chip
 * appears for 5s. It starts in the moved state; Replay resets, then fires 700ms later.
 */
export function SignatureDemo() {
  const [moved, setMoved] = useState(true);
  const [flash, setFlash] = useState(false);
  const [chip, setChip] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const fire = () => {
    setMoved(true);
    setFlash(true);
    setChip(true);
    timers.current.push(
      setTimeout(() => {
        setFlash(false);
      }, 1000),
      setTimeout(() => {
        setChip(false);
      }, 5000),
    );
  };

  const replay = () => {
    clear();
    if (moved) {
      setMoved(false);
      setFlash(false);
      setChip(false);
      timers.current.push(setTimeout(fire, 700));
    } else {
      fire();
    }
  };

  return (
    <div className={s.panel}>
      <div>
        <div className={s.head}>
          <span className={s.title}>Signature moment: the plan moves</span>
          <button type="button" className={s.replay} onClick={replay}>
            {moved ? 'Replay' : 'Add +10h scope'}
          </button>
        </div>
        <div className={s.body}>
          <div className={s.meta}>
            <span className={s.name}>Returns pipeline automation</span>
            <span className={s.line}>
              <span className={s.inline}>
                <Roll value={moved ? 'Wed 2 Dec' : 'Fri 27 Nov'} />
              </span>
              <DeltaChip tone={moved ? 'risk' : 'neutral'} size="m" className={s.metaChip}>
                <span className={s.inline}>
                  <Roll value={moved ? '+3 BD' : '0 BD'} />
                </span>
              </DeltaChip>
            </span>
          </div>
          <div className={s.track}>
            <div className={s.baseline} />
            <TimelineBar
              state="ghost"
              width={pct(OLD)}
              top={41}
              height={7}
              glide={false}
              className={s.ghost}
              style={{ opacity: moved ? (flash ? 1 : 0.55) : 0 }}
            />
            <TimelineBar
              state="risk"
              width={pct(TGT)}
              overrun={moved ? pct(NEW - TGT) : '0%'}
              top={26}
            />
            <ForecastEndDiamond
              late={moved}
              knockout="paper-raised"
              className={s.end}
              style={{ left: pct(moved ? NEW : OLD) }}
            />
            <ForecastEndDiamond
              variant="ghost"
              className={s.oldEnd}
              style={{
                left: pct(OLD),
                opacity: flash ? 1 : 0,
                transition: flash ? 'opacity 0ms' : 'opacity 400ms var(--ease-out)',
              }}
            />
            <TargetMarker height={32} className={s.target} style={{ left: pct(TGT) }} />
            <DeltaChip tone="risk" size="s" weight={600} label="+3 BD" show={chip} className={s.float} style={{ left: pct(NEW) }} />
          </div>
        </div>
      </div>
      <div className={s.notes}>
        <div>
          <span className={s.label}>1 · glide</span> Bar end and overrun move on --spring-soft, 440ms. Motion: spring, bounce 0,
          visualDuration 0.35.
        </div>
        <div>
          <span className={s.label}>2 · ghost</span> Old end appears at full strength, holds 1000ms, fades 400ms --ease-out. The dashed
          track of the previous plan stays, faint.
        </div>
        <div>
          <span className={s.label}>3 · roll</span> Dates and counts roll per digit, weekday and month on --spring-soft, 440ms.
        </div>
        <div>
          <span className={s.label}>4 · delta chip</span> Fades and scales 0.9 → 1 in 180ms, holds 5s beside the bar, then fades.
        </div>
      </div>
    </div>
  );
}
