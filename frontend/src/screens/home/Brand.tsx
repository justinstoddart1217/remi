/**
 * The Ninety One brand marks the redesign draws on its dark-teal panels (Remi Home.dc.html:53-57,
 * Today.dc.html:15 and :28):
 * - `BrandBars`: the 'bars' graphic, six tilted teal bars on the right of a panel, drifting slowly;
 * - `BrandFlow`: the dashed mint strip along a panel's bottom edge, flowing left to right;
 * - `LogoMark`: the REMI logo mark, five bars that grow up from the baseline in turn.
 *
 * All three are decoration (aria-hidden). Under reduced motion nothing drifts, flows or grows:
 * the marks sit at rest, which is also what the parity captures show (Brand.module.css).
 */

import clsx from 'clsx';

import s from './Brand.module.css';

/** x, y, width, height, drift (a rises 16px, b sinks 13px), duration (s), delay (s). */
const BARS: readonly (readonly [number, number, number, number, 'a' | 'b', number, number])[] = [
  [52, -20, 16, 120, 'a', 9, 0],
  [84, 46, 18, 150, 'b', 11, -2],
  [120, -20, 22, 88, 'a', 13, -5],
  [150, 70, 20, 140, 'b', 8, -1],
  [186, -20, 18, 112, 'a', 10, -4],
  [206, 92, 24, 120, 'b', 12, -6],
];

/** The bars graphic, filling `width` of its positioned panel from the right. */
export function BrandBars({ width = '46%', className }: { width?: string; className?: string }) {
  return (
    <div className={clsx(s.bars, className)} style={{ width }} aria-hidden="true">
      <svg viewBox="0 0 240 200" preserveAspectRatio="xMaxYMid slice" className={s.barsSvg}>
        <g transform="rotate(9 240 0)">
          {BARS.map(([x, y, w, h, drift, dur, del]) => (
            <rect
              key={x}
              x={x}
              y={y}
              width={w}
              height={h}
              className={drift === 'a' ? s.driftA : s.driftB}
              style={{ animationDuration: `${String(dur)}s`, animationDelay: `${String(del)}s` }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** The dashed strip along the bottom edge of its positioned panel. */
export function BrandFlow({ className }: { className?: string }) {
  return <span className={clsx(s.flow, className)} aria-hidden="true" />;
}

/** fill, x, y (the lower bars start at 28.346), grow-in delay (ms). */
const MARK: readonly (readonly [string, number, number, number])[] = [
  ['#009D80', 0, 0, 120],
  ['#009D80', 12.369, 0, 210],
  ['#026E62', 12.369, 28.346, 300],
  ['#009D80', 24.739, 0, 390],
  ['#026E62', 24.739, 28.346, 480],
];

/** The REMI logo mark, `height` px tall (Home 44, the app header 38). */
export function LogoMark({ height = 44, className }: { height?: number; className?: string }) {
  return (
    <svg viewBox="0 0 35.05 56.69" height={height} aria-hidden="true" className={clsx(s.mark, className)}>
      {MARK.map(([fill, x, y, d]) => (
        <rect
          key={`${String(x)}:${String(y)}`}
          fill={fill}
          x={x}
          y={y}
          width={10.308}
          height={28.346}
          className={s.markBar}
          style={{ animationDelay: `${String(d)}ms` }}
        />
      ))}
    </svg>
  );
}
