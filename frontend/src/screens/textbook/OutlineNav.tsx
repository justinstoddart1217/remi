import clsx from 'clsx';

import type { Heading } from './editor';
import s from './Textbook.module.css';

const COL: Record<Heading['level'], string> = { 1: '22px', 2: '30px', 3: '40px' };

const SHORTCUTS: readonly (readonly [keys: string, what: string])[] = [
  ['/', 'block menu'],
  ['# ## ###', 'numbered headings'],
  ['-', 'bullet'],
  ['>', 'callout'],
  ['$$', 'formula (LaTeX)'],
  ['---', 'divider'],
];

/**
 * The right column (Remi Textbook.dc.html:310-330): the numbered outline of the open page,
 * then the shortcut crib. Clicking a heading scrolls to it and focuses it.
 */
export function OutlineNav({ items, empty, onGo }: { items: readonly Heading[]; empty: string; onGo?: (id: string) => void }) {
  return (
    <nav className={s.nav} aria-label="On this page">
      <div className={s.eyebrow}>On this page</div>
      <div className={s.outline}>
        {items.map((o) => (
          <button
            key={o.id}
            type="button"
            className={s.outlineItem}
            data-level={o.level}
            style={{ gridTemplateColumns: `${COL[o.level]} minmax(0,1fr)` }}
            onClick={() => onGo?.(o.id)}
          >
            <span className={s.outlineNum}>{o.num}</span>
            <span className={s.outlineText}>{o.text}</span>
          </button>
        ))}
        {items.length === 0 ? <div className={s.outlineEmpty}>{empty}</div> : null}
      </div>
      <div className={clsx(s.eyebrow, s.shortcutsHead)}>Shortcuts</div>
      <div className={s.shortcuts}>
        {SHORTCUTS.map(([keys, what]) => [<span key={`k${keys}`}>{keys}</span>, <span key={`w${keys}`}>{what}</span>])}
      </div>
    </nav>
  );
}
