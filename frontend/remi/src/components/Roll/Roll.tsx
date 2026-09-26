import clsx from 'clsx';
import type { CSSProperties } from 'react';

import a11y from '../shared/a11y.module.css';
import s from './Roll.module.css';
import { tokenize } from './tokenize';

export interface RollProps {
  /** The text to show. Dates ('Wed 2 Dec', '5 Oct') and short numbers ('+3 BD', '3.5') roll. */
  value: string;
  /**
   * What assistive tech reads, when it should say more than the value ('3 business days
   * later' for '+3 BD'). Defaults to the value as shown.
   */
  label?: string;
  /**
   * Hide the Roll from assistive tech, when the surrounding text already names the value
   * (for example a row whose `aria-label` carries the date).
   */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** A test or parity hook on the root (`data-testid`, `data-parity`, …). */
  [data: `data-${string}`]: string | undefined;
}

/**
 * Odometer text (Roll.dc.html). A hidden full-text sizer sets width and baseline; an
 * aria-hidden strip of 1.25em column windows sits on top, each holding a reel that is moved
 * with `transform` over 440ms `--spring-soft`. Columns keep their DOM node while the format
 * family is unchanged, so value changes roll; a family change remounts them. Nothing animates
 * on first mount, and column widths snap.
 *
 * The value is read as plain text, in line with the words around it ("5 of 12 funds", a date
 * button named "Mon 14 Sep"): the sizer is the text node, painted transparent under the strip,
 * and the strip is `aria-hidden` and unselectable, so screen readers, `innerText` and copy all
 * get the value once. (A `role="img"` root made each value an "image" stop that broke the
 * sentence apart.) A `label` is read instead of the value, from a visually hidden span, and the
 * sizer is then hidden from assistive tech. The DOM order (sizer, then strip) is what the
 * parity harness reads; the harness leaves the hidden label out.
 */
export function Roll({ value, label, decorative = false, className, style, title, ...data }: RollProps) {
  const { text, family, parts } = tokenize(value);
  const spoken = decorative || label === undefined || label === text ? null : label;
  return (
    <span
      {...data}
      aria-hidden={decorative ? true : undefined}
      className={clsx(s.roll, className)}
      style={style}
      title={title}
      data-roll={family}
    >
      <span className={s.sizer} aria-hidden={spoken === null ? undefined : true}>
        {text}
      </span>
      <span className={s.strip} aria-hidden="true">
        {parts.map((p, k) => (
          <span key={`${family}:${String(k)}`} className={s.window}>
            <span className={s.sizer}>{p.cur}</span>
            <span className={s.reel} style={{ transform: `translateY(${String(-p.i * 1.25)}em)` }}>
              {p.cells.map((c, j) => (
                <span key={j} className={s.cell}>
                  {c}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
      {spoken === null ? null : <span className={a11y.srOnly}>{spoken}</span>}
    </span>
  );
}
