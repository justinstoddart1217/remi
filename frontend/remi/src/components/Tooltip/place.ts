export interface PlaceOptions {
  /** Flip left when x + width would overflow (Timeline: 310 / 332). */
  width?: number;
  flipX?: number;
  /** Flip up when y + height would overflow (Timeline: 140 / 150). */
  height?: number;
  flipY?: number;
  /** Offset from the cursor (16). */
  offset?: number;
}

/**
 * Follow the cursor (Timeline.dc.html:232-239): 16px below-right of the pointer, flipped near
 * the container's right and bottom edges. Written straight to `transform`, with no transition
 * and no React render. Works in a scaled frame (k = offsetWidth / rect.width).
 */
export function placeTooltip(
  tip: HTMLElement,
  container: HTMLElement,
  clientX: number,
  clientY: number,
  { width = 310, flipX = 332, height = 140, flipY = 150, offset = 16 }: PlaceOptions = {},
): void {
  const r = container.getBoundingClientRect();
  const k = r.width ? container.offsetWidth / r.width : 1;
  let x = (clientX - r.left) * k + offset;
  let y = (clientY - r.top) * k + offset;
  if (x + width > container.offsetWidth) x -= flipX;
  if (y + height > container.offsetHeight) y -= flipY;
  tip.style.transform = `translate(${String(x)}px,${String(y)}px)`;
}
