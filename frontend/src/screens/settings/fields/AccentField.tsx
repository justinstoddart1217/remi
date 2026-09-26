import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { Icon } from '../../../components';
import type { AccentId } from '../../../stores/ui';
import { ACCENT_PAIRS } from '../model';
import m from './SettingsFields.module.css';

export interface AccentFieldProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
}

/**
 * The three Ninety One accent pairs as square swatch tiles: a split strip (Private Credit,
 * then Fixed Income), the name and the hex values under it. A radio group with arrow keys;
 * the chosen tile takes a brand-deep border and a check.
 */
export function AccentField({ value, onChange }: AccentFieldProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    ACCENT_PAIRS.findIndex((a) => a.id === value),
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(ACCENT_PAIRS.length - 1, index + step));
    const pair = ACCENT_PAIRS[next];
    if (pair && next !== index) {
      onChange(pair.id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label="Accent colours" className={m.accents} onKeyDown={onKeyDown}>
      {ACCENT_PAIRS.map((pair, k) => (
        <button
          key={pair.id}
          ref={(el) => {
            refs.current[k] = el;
          }}
          type="button"
          role="radio"
          aria-checked={pair.id === value}
          tabIndex={pair.id === value ? 0 : -1}
          className={m.accent}
          onClick={() => {
            if (pair.id !== value) onChange(pair.id);
          }}
        >
          <span className={m.swatches} aria-hidden="true">
            <span className={m.swatch} style={{ background: pair.pc }} />
            <span className={m.swatch} style={{ background: pair.fi }} />
          </span>
          <span className={m.accentText}>
            <span className={m.accentName}>{pair.name}</span>
            <span className={m.accentHex}>
              {pair.pc} · {pair.fi}
            </span>
          </span>
          <Icon name="check" className={m.accentCheck} />
        </button>
      ))}
    </div>
  );
}
