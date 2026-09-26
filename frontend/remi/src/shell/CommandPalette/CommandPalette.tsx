import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { useGo } from '../../app/navigation';
import { Icon } from '../../components/Icon';
import { captureFocus, FOCUS_DELAY, focusSoon } from '../../lib/focus';
import { openProject } from '../../lib/viewTransition';
import { focusReturnTarget, PALETTE_LAYER, useOverlays } from '../../stores/overlays';
import { useUi } from '../../stores/ui';
import s from './CommandPalette.module.css';
import { buildPalette, clampIndex, EMPTY_PALETTE, parseQuickAdd, PALETTE_PLACEHOLDER, stepIndex } from './model';
import type { PaletteRow } from './model';
import { usePaletteProviders } from './registry';
import type { PaletteActions, PaletteContext } from './types';

/**
 * The ⌘K palette frame (Remi.dc.html lines 142-167): ink 10% scrim, a 680px panel 132px
 * from the top, a 60px input row, and grouped rows (7px dot, label, mono hint), at most 16.
 * Rows come from the provider registry. Keys: ArrowUp/Down clamp without wrap, Enter runs
 * the selection, hovering selects, typing resets the selection. Escape is the global
 * overlay stack's. Closed, the rows empty at once while the panel fades (as the prototype).
 */
export function CommandPalette() {
  const palette = useOverlays((st) => st.palette);
  const setQuery = useOverlays((st) => st.setPaletteQuery);
  const setIndex = useOverlays((st) => st.setPaletteIndex);
  const closePalette = useOverlays((st) => st.closePalette);
  const providers = usePaletteProviders();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const go = useGo();
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const actions = useMemo<PaletteActions>(
    () => ({
      go: (screen) => {
        go(screen, { focusHeading: true });
      },
      // Keyboard navigation focuses the new screen's h1, as `go` does (arch-frontend-core §8).
      openProject: (projectId) => {
        closePalette();
        useUi.getState().requestHeadingFocus();
        openProject(projectId, navigate);
      },
      // The drawer returns focus to what was focused before ⌘K, not to this (closing) input.
      openCheckIn: (projectId, prefill) => {
        useOverlays.getState().openDrawer(projectId ?? null, prefill ?? null, { returnFocusTo: focusReturnTarget(PALETTE_LAYER) });
      },
      navigate: (to, options) => {
        closePalette();
        void navigate(to, options);
      },
      close: closePalette,
    }),
    [go, navigate, closePalette],
  );

  const model = useMemo(() => {
    if (!palette.open) return EMPTY_PALETTE;
    const q = palette.query.trim().toLowerCase();
    const ctx: PaletteContext = { query: palette.query, q, quickAdd: parseQuickAdd(q), queryClient, actions };
    return buildPalette(providers, ctx);
  }, [palette.open, palette.query, providers, queryClient, actions]);

  const count = model.flat.length;
  const selected = clampIndex(palette.index, count);

  useEffect(() => {
    if (!palette.open) return;
    const restore = captureFocus(focusReturnTarget(PALETTE_LAYER));
    const cancel = focusSoon(() => inputRef.current, FOCUS_DELAY.palette);
    const layer = layerRef.current;
    return () => {
      cancel();
      const current = document.activeElement;
      if (!current || current === document.body || layer?.contains(current)) restore();
    };
  }, [palette.open]);

  const run = (row: PaletteRow | undefined) => {
    if (!row) return;
    closePalette();
    row.item.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex(stepIndex(selected, count, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(model.flat[selected]);
    }
  };

  const optionId = (index: number) => `${listId}-${String(index)}`;
  const empty = palette.open && count === 0;

  return (
    <div ref={layerRef} className={s.layer} data-open={palette.open ? '' : undefined} inert={!palette.open}>
      <div className={s.scrim} onClick={closePalette} />
      <div className={s.panel} role="dialog" aria-modal={palette.open} aria-label="Search or add">
        <div className={s.inputRow}>
          <Icon name="search" className={s.inputIcon} />
          <input
            ref={inputRef}
            className={s.input}
            value={palette.query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={PALETTE_PLACEHOLDER}
            role="combobox"
            aria-expanded={palette.open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? optionId(selected) : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={s.esc}>esc</span>
        </div>
        <div className={s.results} id={listId} role="listbox" aria-label="Results">
          {model.groups.map((group) => (
            <Fragment key={group.label}>
              <div className={s.groupLabel} role="presentation">
                {group.label}
              </div>
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  id={optionId(row.index)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={row.index === selected}
                  className={s.item}
                  onClick={() => {
                    run(row);
                  }}
                  onMouseEnter={() => {
                    setIndex(row.index);
                  }}
                >
                  <span className={s.dot} style={{ background: row.item.dot ?? 'var(--hairline)' }} />
                  <span className={s.label}>{row.item.label}</span>
                  <span className={s.hint}>{row.item.hint ?? ''}</span>
                </button>
              ))}
            </Fragment>
          ))}
          {empty ? <div className={s.empty}>{model.emptyText}</div> : null}
        </div>
      </div>
    </div>
  );
}
