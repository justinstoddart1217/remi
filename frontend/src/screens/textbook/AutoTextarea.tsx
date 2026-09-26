import clsx from 'clsx';
import { useLayoutEffect, useRef } from 'react';
import type { Ref, TextareaHTMLAttributes } from 'react';

import s from './Textbook.module.css';

const FIELD_SIZING = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & {
  value: string;
  ref?: Ref<HTMLTextAreaElement>;
};

/**
 * A one-row textarea that grows with its text: CSS `field-sizing: content` where the browser
 * has it (the prototype's approach), otherwise its scroll height is copied into its height.
 */
export function AutoTextarea({ className, value, ref, ...rest }: Props) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (FIELD_SIZING || !el) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={(el) => {
        own.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      rows={1}
      value={value}
      className={clsx(s.area, className)}
    />
  );
}
