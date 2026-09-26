import clsx from 'clsx';
import type { CSSProperties } from 'react';

import { ICON_CODEPOINTS } from './icons.generated';
import type { IconName } from './icons.generated';
import s from './Icon.module.css';

export interface IconProps {
  name: IconName;
  /**
   * `ligature` (default) renders the icon name as text, exactly like the prototype's DOM, and
   * relies on the font's ligatures. `codepoint` renders the private-use character instead.
   */
  render?: 'ligature' | 'codepoint';
  /** FILL axis (0 outlined, 1 filled). Omit to inherit the font default (0). */
  fill?: 0 | 1;
  /** Optical size, 20-24. Omit to let the browser match it to the font size. */
  opsz?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
  label?: string;
}

function variationSettings(fill?: 0 | 1, opsz?: number): string | undefined {
  const parts: string[] = [];
  if (fill !== undefined) parts.push(`'FILL' ${String(fill)}`);
  if (opsz !== undefined) parts.push(`'opsz' ${String(opsz)}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** A Material Symbols Outlined glyph from the self-hosted Remi subset. */
export function Icon({ name, render = 'ligature', fill, opsz, className, style, label }: IconProps) {
  const text = render === 'codepoint' ? String.fromCodePoint(ICON_CODEPOINTS[name]) : name;
  const fontVariationSettings = variationSettings(fill, opsz);
  return (
    <span
      className={clsx(s.icon, className)}
      style={fontVariationSettings ? { fontVariationSettings, ...style } : style}
      translate="no"
      data-icon={name}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {text}
    </span>
  );
}
