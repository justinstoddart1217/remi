/** Deep-link scrolling for the Routines screen (Routines.dc.html:165-167). */

/** The prototype's deep-link offset: the target lands 120px below the top of the screen. */
export const SCROLL_OFFSET = 120;

/** The nearest scrolling ancestor (the screen's section). */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  let sc = el.parentElement;
  while (sc && getComputedStyle(sc).overflowY !== 'auto') sc = sc.parentElement;
  return sc;
}

/** Scrolls `el` to `SCROLL_OFFSET` below the top of its scroller, undoing the stage scale. */
export function scrollToOffset(el: HTMLElement, reduced: boolean): void {
  const sc = scrollerOf(el);
  if (!sc) return;
  const box = sc.getBoundingClientRect();
  const top = el.getBoundingClientRect().top - box.top;
  const k = box.height ? sc.offsetHeight / box.height : 1;
  sc.scrollTo({ top: sc.scrollTop + top * k - SCROLL_OFFSET, behavior: reduced ? 'auto' : 'smooth' });
}
