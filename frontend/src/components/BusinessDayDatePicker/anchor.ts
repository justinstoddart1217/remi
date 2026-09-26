/**
 * Where to open the picker (Workspace.dc.html:251-262): 6px below the trigger, left-aligned
 * with it, clamped so the 292px panel stays inside the container (root width − 300). Works in
 * a scaled frame: rects are converted with k = offsetWidth / rect.width.
 */
export function anchorPicker(container: HTMLElement, trigger: HTMLElement): { x: number; y: number } {
  const rr = container.getBoundingClientRect();
  const br = trigger.getBoundingClientRect();
  const k = rr.width ? container.offsetWidth / rr.width : 1;
  let x = (br.left - rr.left) * k;
  const y = (br.bottom - rr.top) * k + 6;
  if (x + 300 > container.offsetWidth) x = container.offsetWidth - 300;
  return { x, y };
}
