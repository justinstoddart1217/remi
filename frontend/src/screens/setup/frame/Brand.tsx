import s from './Frame.module.css';

/**
 * The REMI bar mark (Remi Home.dc.html header, Remi.dc.html top bar): five Ninety One bars,
 * brand green over brand dark, rising one after another on arrival.
 */
export function BrandMark({ height = 44 }: { height?: number }) {
  return (
    <svg viewBox="0 0 35.05 56.69" height={height} aria-hidden="true" className={s.mark}>
      <rect className={s.markBar} style={{ animationDelay: '120ms' }} fill="#009D80" x="0" y="0" width="10.308" height="28.346" />
      <rect className={s.markBar} style={{ animationDelay: '210ms' }} fill="#009D80" x="12.369" y="0" width="10.308" height="28.346" />
      <rect className={s.markBar} style={{ animationDelay: '300ms' }} fill="#026E62" x="12.369" y="28.346" width="10.308" height="28.346" />
      <rect className={s.markBar} style={{ animationDelay: '390ms' }} fill="#009D80" x="24.739" y="0" width="10.308" height="28.346" />
      <rect className={s.markBar} style={{ animationDelay: '480ms' }} fill="#026E62" x="24.739" y="28.346" width="10.308" height="28.346" />
    </svg>
  );
}

const BARS: readonly { x: number; y: number; w: number; h: number; drift: 'a' | 'b'; dur: number; delay: number }[] = [
  { x: 52, y: -20, w: 16, h: 120, drift: 'a', dur: 9, delay: 0 },
  { x: 84, y: 46, w: 18, h: 150, drift: 'b', dur: 11, delay: -2 },
  { x: 120, y: -20, w: 22, h: 88, drift: 'a', dur: 13, delay: -5 },
  { x: 150, y: 70, w: 20, h: 140, drift: 'b', dur: 8, delay: -1 },
  { x: 186, y: -20, w: 18, h: 112, drift: 'a', dur: 10, delay: -4 },
  { x: 206, y: 92, w: 24, h: 120, drift: 'b', dur: 12, delay: -6 },
];

/**
 * The Ninety One 'bars' graphic behind a dark-teal hero (Remi Home.dc.html, Today.dc.html):
 * six tilted brand-green bars on the right 46%, drifting slowly (still under reduced motion).
 */
export function BarsGraphic() {
  return (
    <div className={s.bars} aria-hidden="true">
      <svg viewBox="0 0 240 200" preserveAspectRatio="xMaxYMid slice">
        <g transform="rotate(9 240 0)">
          {BARS.map((b) => (
            <rect
              key={b.x}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              className={b.drift === 'a' ? s.driftA : s.driftB}
              style={{ animationDuration: `${String(b.dur)}s`, animationDelay: `${String(b.delay)}s` }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
