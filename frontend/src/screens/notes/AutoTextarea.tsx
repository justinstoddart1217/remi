/**
 * A textarea that grows with its text. The prototype relies on `field-sizing: content`, which
 * only Chromium has (crit Notes risk); elsewhere the height follows `scrollHeight`.
 */

import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

const NATIVE = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(
  props,
  forwarded,
) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      own.current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );

  useLayoutEffect(() => {
    const el = own.current;
    if (NATIVE || !el) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [props.value]);

  return <textarea ref={setRef} rows={1} {...props} />;
});
