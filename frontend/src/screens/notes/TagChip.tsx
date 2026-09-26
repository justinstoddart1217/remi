/**
 * A project or routine tag (Notes.dc.html): a span under the composer and in the expanded
 * note's header, a button that opens the target on an entry.
 */

import type { CSSProperties } from 'react';

import { DOMAIN_ACCENT, DOMAIN_SOFT } from '../../components/shared/domain';
import type { NoteTagOut } from './model';
import s from './Notes.module.css';

export function TagChip({ tag, onOpen }: { tag: NoteTagOut; onOpen?: (tag: NoteTagOut) => void }) {
  const style: CSSProperties = { background: DOMAIN_SOFT[tag.domain] };
  const dot = <span className={s.chipDot} style={{ background: DOMAIN_ACCENT[tag.domain] }} />;
  if (!onOpen) {
    return (
      <span className={s.chip} style={style}>
        {dot}
        {tag.label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={s.chip}
      style={style}
      onClick={() => {
        onOpen(tag);
      }}
    >
      {dot}
      {tag.label}
    </button>
  );
}
