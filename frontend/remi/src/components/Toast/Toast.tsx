import clsx from 'clsx';
import { useState } from 'react';

import s from './Toast.module.css';

export interface ToastProps {
  /** The message; null hides it (the last text stays while it fades). */
  message: string | null;
  className?: string;
}

/**
 * The --brand-deep pill at the bottom centre of its positioned container (Remi Textbook.dc.html:287):
 * opacity 240ms and translateY(8px) → 0 over 440ms --spring-soft. Pair with `useToast`.
 */
export function Toast({ message, className }: ToastProps) {
  const [shown, setShown] = useState(message);
  if (message !== null && message !== shown) setShown(message);
  return (
    <div role="status" aria-live="polite" className={clsx(s.toast, className)} data-visible={message !== null}>
      {message ?? shown}
    </div>
  );
}
