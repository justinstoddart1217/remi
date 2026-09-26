import type { CSSProperties } from 'react';

/** `--i` for an arrival block (its place in the 40ms stagger). */
export function arriveStyle(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}
