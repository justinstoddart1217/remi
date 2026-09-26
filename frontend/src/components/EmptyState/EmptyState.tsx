import clsx from 'clsx';
import type { ReactNode } from 'react';

import s from './EmptyState.module.css';

export interface EmptyStateProps {
  children: ReactNode;
  /**
   * - `muted` (default): 14/1.5 ink-muted (Timeline panel, Workspace Now, Textbook home).
   * - `italic`: 14/1.45 ink-muted (Charter lists). Upright since the redesign; the name stays.
   * - `serif`: display 18/1.5 ink-muted (Notes). Upright since the redesign.
   */
  variant?: 'muted' | 'italic' | 'serif';
  as?: 'div' | 'p' | 'span';
  className?: string;
}

/** Empty states are written with care: instructive and gentle, never 'No data'. */
export function EmptyState({ children, variant = 'muted', as: Tag = 'div', className }: EmptyStateProps) {
  return <Tag className={clsx(s.empty, s[variant], className)}>{children}</Tag>;
}
