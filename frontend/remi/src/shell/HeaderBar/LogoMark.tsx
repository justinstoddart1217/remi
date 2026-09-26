import s from './HeaderBar.module.css';

/** fill, x, y (the lower bars start at 28.346), grow-in delay (ms). Remi.dc.html <header> svg. */
const BARS: readonly (readonly [string, number, number, number])[] = [
  ['#009D80', 0, 0, 120],
  ['#009D80', 12.369, 0, 210],
  ['#026E62', 12.369, 28.346, 300],
  ['#009D80', 24.739, 0, 390],
  ['#026E62', 24.739, 28.346, 480],
];

/**
 * The REMI bar mark, 38px tall: five Ninety One teal bars that grow up from their baseline in
 * turn (bar-up, 700ms, 120-480ms delays). Decoration: the button beside it carries the name.
 * Under reduced motion the bars are simply there.
 */
export function LogoMark() {
  return (
    <svg viewBox="0 0 35.05 56.69" height="38" aria-hidden="true" className={s.mark}>
      {BARS.map(([fill, x, y, delay]) => (
        <rect
          key={`${String(x)}:${String(y)}`}
          fill={fill}
          x={x}
          y={y}
          width={10.308}
          height={28.346}
          className={s.markBar}
          style={{ animationDelay: `${String(delay)}ms` }}
        />
      ))}
    </svg>
  );
}
