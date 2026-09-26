import clsx from 'clsx';
import { useLayoutEffect, useRef } from 'react';

import { slashOptionId } from './editor';
import type { BlockType, SlashItem } from './editor';
import s from './Textbook.module.css';

export interface SlashAnchor {
  /** The text block's left edge, and its top and bottom, in the main column's own pixels. */
  x: number;
  top: number;
  bottom: number;
}

interface Props {
  /** The listbox's id: the text field that opened it names it in aria-controls. */
  id: string;
  anchor: SlashAnchor;
  items: readonly SlashItem[];
  active: number;
  onPick: (type: BlockType) => void;
  onHover: (index: number) => void;
}

/**
 * The block menu (Remi Textbook.dc.html:283-294): 300px, "Blocks", ten items with glyphs, or
 * "No block called that." Items are picked on mousedown so the text keeps the focus. It sits
 * 6px under the block's left edge, measured against the main column (not the prototype's fixed
 * 288px sidebar offset), and flips above the block when it would run off the bottom.
 *
 * The text keeps the focus, so the field points at the menu (aria-controls) and at the active
 * option (aria-activedescendant, slashOptionId): arrowing through the items is announced.
 */
export function SlashMenu({ id, anchor, items, active, onPick, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.offsetParent as HTMLElement | null | undefined;
    if (!el || !host) return;
    const below = anchor.bottom + 6;
    const fits = below + el.offsetHeight <= host.clientHeight - 8;
    const above = anchor.top - 6 - el.offsetHeight;
    el.style.top = `${String(fits || above < 64 ? below : above)}px`;
  });

  return (
    <div ref={ref} id={id} className={s.slash} style={{ left: anchor.x }} role="listbox" aria-label="Blocks">
      {/* The listbox is named "Blocks"; the eyebrow is its visible label, not an item. */}
      <div className={clsx(s.eyebrow, s.slashHead)} aria-hidden="true">
        Blocks
      </div>
      {items.map((it, k) => (
        <button
          key={it.type}
          id={slashOptionId(id, it.type)}
          type="button"
          role="option"
          aria-selected={k === active}
          tabIndex={-1}
          className={s.slashItem}
          data-on={k === active}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(it.type);
          }}
          onMouseEnter={() => {
            if (k !== active) onHover(k);
          }}
        >
          <span className={s.slashIcon} data-font={it.font} style={{ fontSize: it.size }}>
            {it.icon}
          </span>
          <span className={s.slashText}>
            <span className={s.slashLabel}>{it.label}</span>
            <span className={s.slashHint}>{it.hint}</span>
          </span>
        </button>
      ))}
      {items.length === 0 ? (
        <div className={s.slashNone} role="option" aria-selected={false} aria-disabled="true">
          No block called that.
        </div>
      ) : null}
    </div>
  );
}
