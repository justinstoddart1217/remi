import clsx from 'clsx';
import type { ReactNode } from 'react';

import s from './SectionTitleRow.module.css';

export interface SectionTitleRowProps {
  title: ReactNode;
  /** Right-hand note: 13px ink-muted, or 12px numeric with `noteStyle="numeric"`. */
  note?: ReactNode;
  noteStyle?: 'text' | 'numeric';
  /**
   * - `accent` (default): display 21/400 in --brand-deep behind the 3×18 brand-teal bar.
   * - `plain`: 20/600 ink, no bar (Workspace "Charter", Textbook "Recently edited").
   */
  variant?: 'accent' | 'plain';
  /** Heading level for the title (a span when omitted). */
  as?: 'h2' | 'h3' | 'span';
  className?: string;
}

/**
 * A section heading with a right-hand note over a hairline rule, 10px below (Today, Workspace,
 * Textbook). The accent bar is decorative (aria-hidden), so the heading's name is the title alone.
 */
export function SectionTitleRow({ title, note, noteStyle = 'text', variant = 'accent', as: Tag = 'span', className }: SectionTitleRowProps) {
  return (
    <div className={clsx(s.row, className)}>
      <Tag className={clsx(s.title, s[variant])}>
        {variant === 'accent' && <span className={s.bar} aria-hidden="true" />}
        {title}
      </Tag>
      {note !== undefined && <span className={noteStyle === 'numeric' ? s.numeric : s.note}>{note}</span>}
    </div>
  );
}
