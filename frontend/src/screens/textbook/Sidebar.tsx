import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useDeleteSection, useReorderSections, useTextbookSearch, useUpdateSection } from '../../api';
import type { SectionOut } from '../../api';
import { Icon } from '../../components';
import { useGoHome } from '../../shell/useGoHome';
import { useTextbook } from './context';
import s from './Textbook.module.css';
import { guideX, moveSection, reorderSections, rowPad, sectionViews, totalCharts } from './tree';
import type { LivePage } from './tree';

export interface SectionEdit {
  id: string;
  draft: string;
}

interface Props {
  currentId: string | null;
  /** The last page opened, marked in the tree while Textbook home is showing. */
  lastId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collapsed: ReadonlySet<string>;
  onTogglePage: (pageId: string) => void;
  live: LivePage | null;
  secEdit: SectionEdit | null;
  onSecEdit: (edit: SectionEdit | null) => void;
}

/** The five Ninety One bars, rising one after another (Remi Textbook.dc.html:65). */
const MARK_BARS: readonly (readonly [x: number, y: number, fill: string, delay: number])[] = [
  [0, 0, '#009D80', 120],
  [12.369, 0, '#009D80', 210],
  [12.369, 28.346, '#026E62', 300],
  [24.739, 0, '#009D80', 390],
  [24.739, 28.346, '#026E62', 480],
];

function BrandMark() {
  return (
    <svg viewBox="0 0 35.05 56.69" height="30" aria-hidden="true" className={s.mark}>
      {MARK_BARS.map(([x, y, fill, delay]) => (
        <rect key={`${String(x)},${String(y)}`} fill={fill} x={x} y={y} width="10.308" height="28.346" style={{ animationDelay: `${String(delay)}ms` }} />
      ))}
    </svg>
  );
}

/**
 * The Textbook sidebar (Remi Textbook.dc.html:57-107): the collapsed 56px rail under its
 * dark-teal band, and the 288px panel with the dark-teal header (the bars, REMI and
 * "‹ Home · Textbook" back to Home), "Find a page", the Home row, the sections (accent dot,
 * rename on double-click, drag to reorder, delete when empty, new page) with their page trees,
 * "New section", and the live-chart count.
 */
export function Sidebar({ currentId, lastId = null, open, onOpenChange, collapsed, onTogglePage, live, secEdit, onSecEdit }: Props) {
  const tb = useTextbook();
  const goHome = useGoHome();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const reorder = useReorderSections();
  const [q, setQ] = useState('');
  const search = useTextbookSearch(q);
  const [secOpen, setSecOpen] = useState<Readonly<Record<string, boolean>>>({});
  const [secDrag, setSecDrag] = useState<string | null>(null);
  const [secDrop, setSecDrop] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  /**
   * A section label to take the focus back: after a rename commits (its field goes away) or
   * after Alt+↑ / Alt+↓ once the new order has landed (moving a node in the DOM drops its
   * focus). Only when the focus was dropped, never away from something the user chose.
   */
  const refocusSec = useRef<{ id: string; order: string | null } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const tree = tb.tree;
  useEffect(() => {
    const want = refocusSec.current;
    if (!want || !tree) return;
    if (want.order !== null && tree.sections.map((sec) => sec.id).join() !== want.order) return;
    refocusSec.current = null;
    const el = asideRef.current?.querySelector<HTMLElement>(`[data-sec-label="${CSS.escape(want.id)}"]`);
    const active = document.activeElement;
    if (el && (active === null || active === document.body || active === el)) el.focus({ preventScroll: true });
  });

  const pages = tree?.pages ?? [];
  const hits = q.trim() ? (search.data?.hits ?? []) : null;
  const views = tree
    ? sectionViews(
        { ...tree, sections: tree.sections.map((sec) => (sec.id in secOpen ? { ...sec, collapsed: !secOpen[sec.id] } : sec)) },
        { currentId: currentId ?? lastId, collapsed, query: q, hits, live },
      )
    : [];

  const toggleSection = (sec: SectionOut, isOpen: boolean) => {
    setSecOpen((m) => ({ ...m, [sec.id]: !isOpen }));
    updateSection.mutate({ sectionId: sec.id, patch: { collapsed: isOpen } });
  };

  const commit = (sec: SectionOut) => {
    const v = (secEdit?.id === sec.id ? secEdit.draft : sec.label).trim();
    onSecEdit(null);
    refocusSec.current = { id: sec.id, order: null };
    // A blank name on an empty, unnamed section removes it (the server keeps the last one).
    if (!v && !sec.label && sec.pageCount === 0) {
      updateSection.mutate({ sectionId: sec.id, patch: { label: '' } });
      return;
    }
    if (v && v !== sec.label) updateSection.mutate({ sectionId: sec.id, patch: { label: v } });
  };

  const dropSection = (to: string | null) => {
    const from = secDrag;
    setSecDrag(null);
    setSecDrop(null);
    if (!from || !tree || from === to) return;
    const ids = tree.sections.map((sec) => sec.id);
    const next = reorderSections(ids, from, to);
    if (next.join() !== ids.join()) reorder.mutate({ ids: next });
  };

  const endDrag = () => {
    setSecDrag(null);
    setSecDrop(null);
  };

  /** Keyboard on a section's name: Enter, Space or F2 renames it; Alt+↑ / Alt+↓ moves it. */
  const onSecKey = (sec: SectionOut, e: ReactKeyboardEvent) => {
    if (!e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'Enter' || e.key === ' ' || e.key === 'F2')) {
      e.preventDefault();
      onSecEdit({ id: sec.id, draft: sec.label });
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && tree) {
      e.preventDefault();
      const ids = tree.sections.map((x) => x.id);
      const next = moveSection(ids, sec.id, e.key === 'ArrowUp' ? -1 : 1);
      if (next.join() === ids.join()) return;
      refocusSec.current = { id: sec.id, order: next.join() };
      reorder.mutate({ ids: next });
    }
  };

  return (
    <aside ref={asideRef} className={s.aside} data-open={open}>
      <div className={s.rail} inert={open}>
        <button
          type="button"
          className={s.railButton}
          title="Show sidebar (⌘\)"
          onClick={() => {
            onOpenChange(true);
          }}
        >
          <Icon name="left_panel_open" />
        </button>
        <button type="button" className={s.railButton} data-on={currentId === null} title="Textbook home" onClick={tb.openHome}>
          <Icon name="home" />
        </button>
        <button
          type="button"
          className={s.railButton}
          title="Search"
          onClick={() => {
            onOpenChange(true);
            setTimeout(() => searchRef.current?.focus(), 60);
          }}
        >
          <Icon name="search" />
        </button>
      </div>

      <div className={s.panel} inert={!open}>
        <div className={s.panelTop}>
          <button type="button" className={s.homeLink} title="Back to home" onClick={goHome}>
            <BrandMark />
            <span className={s.wordmarkStack}>
              <span className={s.wordmark}>REMI</span>
              <span className={s.backHome}>‹ Home · Textbook</span>
            </span>
          </button>
          <span className={s.spacer} />
          <button
            type="button"
            className={s.hideButton}
            title="Hide sidebar (⌘\)"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <Icon name="left_panel_close" />
          </button>
        </div>
        <div className={s.searchWrap}>
          <div className={s.search}>
            <Icon name="search" />
            <input
              ref={searchRef}
              className={s.searchInput}
              value={q}
              placeholder="Find a page"
              aria-label="Find a page"
              onChange={(e) => {
                setQ(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.stopPropagation();
                  setQ('');
                }
              }}
            />
          </div>
        </div>

        <div className={s.list}>
          <button type="button" className={s.homeRow} data-on={currentId === null} onClick={tb.openHome}>
            <Icon name="home" />
            <span className={s.homeLabel}>Home</span>
            <span className={s.spacer} />
            <span className={s.count11}>{tree ? String(pages.length) : ''}</span>
          </button>

          {views.map((v) => {
            const sec = v.section;
            const editing = secEdit?.id === sec.id;
            return (
              <div key={sec.id} role="group" aria-label={v.label}>
                <div
                  className={s.secHead}
                  draggable={!editing}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/x-remi-sec', sec.id);
                    setSecDrag(sec.id);
                  }}
                  onDragOver={(e) => {
                    if (!secDrag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (secDrop !== sec.id) setSecDrop(sec.id);
                  }}
                  onDrop={(e) => {
                    if (!secDrag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dropSection(sec.id);
                  }}
                  onDragEnd={endDrag}
                >
                  <div className={s.secDrop} data-on={secDrag !== null && secDrop === sec.id && secDrag !== sec.id} />
                  <button
                    type="button"
                    className={s.tiny}
                    title={v.open ? 'Collapse section' : 'Expand section'}
                    aria-expanded={v.open}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSection(sec, v.open);
                    }}
                  >
                    <Icon name="chevron_right" className={s.chev} style={{ transform: `rotate(${v.open ? '90deg' : '0deg'})` }} />
                  </button>
                  <span className={s.secDot} style={{ background: sec.accent }} />
                  {editing ? (
                    <input
                      className={s.secInput}
                      value={secEdit.draft}
                      placeholder="Section name"
                      aria-label="Section name"
                      autoFocus
                      onFocus={(e) => {
                        e.currentTarget.select();
                      }}
                      onChange={(e) => {
                        onSecEdit({ id: sec.id, draft: e.target.value });
                      }}
                      onBlur={() => {
                        commit(sec);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          e.stopPropagation();
                          e.preventDefault();
                          onSecEdit({ id: sec.id, draft: sec.label });
                          const el = e.currentTarget;
                          setTimeout(() => {
                            el.blur();
                          }, 0);
                        }
                      }}
                    />
                  ) : (
                    <span
                      className={s.secLabel}
                      title="Double-click or press Enter to rename · Alt+↑ ↓ to move"
                      role="button"
                      tabIndex={0}
                      aria-label={`Rename ${v.label}`}
                      aria-keyshortcuts="Enter F2 Alt+ArrowUp Alt+ArrowDown"
                      data-sec-label={sec.id}
                      onDoubleClick={() => {
                        onSecEdit({ id: sec.id, draft: sec.label });
                      }}
                      onKeyDown={(e) => {
                        onSecKey(sec, e);
                      }}
                    >
                      {v.label}
                    </span>
                  )}
                  <span className={s.secCount}>{String(sec.pageCount)}</span>
                  {v.canDelete ? (
                    <button
                      type="button"
                      className={clsx(s.tiny, s.secDelete)}
                      title="Delete empty section"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSection.mutate({ sectionId: sec.id });
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={clsx(s.tiny, s.secAdd)}
                    title="New page"
                    onClick={(e) => {
                      e.stopPropagation();
                      tb.newPageIn(sec.id);
                    }}
                  >
                    <Icon name="add" className={s.icon16} />
                  </button>
                </div>
                {v.open ? (
                  <>
                    {v.rows.map((r) => (
                      <div
                        key={r.id}
                        className={s.pageRow}
                        data-current={r.current}
                        style={{ paddingLeft: rowPad(r.depth) }}
                        onClick={() => {
                          tb.openPage(r.id);
                        }}
                      >
                        {r.depth > 0 ? <span className={s.guide} style={{ left: guideX(r.depth) }} /> : null}
                        <button
                          type="button"
                          className={s.caret}
                          data-leaf={!r.hasKids}
                          title={r.hasKids ? (r.expanded ? 'Hide pages inside' : 'Show pages inside') : undefined}
                          aria-expanded={r.hasKids ? r.expanded : undefined}
                          aria-label={r.hasKids ? undefined : `Open ${r.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.hasKids) onTogglePage(r.id);
                            else tb.openPage(r.id);
                          }}
                        >
                          <Icon
                            name={r.hasKids ? 'chevron_right' : 'description'}
                            style={{ transform: `rotate(${r.hasKids && r.expanded ? '90deg' : '0deg'})` }}
                          />
                        </button>
                        <span className={s.pageTitle} data-ink={r.current || r.ancestor}>
                          <a
                            className={s.pageLinkPlain}
                            href={`/textbook/${encodeURIComponent(r.id)}`}
                            aria-current={r.current && currentId !== null ? 'page' : undefined}
                            onClick={(e) => {
                              e.preventDefault();
                            }}
                          >
                            {r.title}
                          </a>
                        </span>
                        {r.charts ? (
                          <span className={s.charts} title="Live charts">
                            {String(r.charts)}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={clsx(s.tiny, s.addSub)}
                          title="Add a page inside"
                          onClick={(e) => {
                            e.stopPropagation();
                            tb.createSub(r.id);
                          }}
                        >
                          <Icon name="add" className={s.icon16} />
                        </button>
                      </div>
                    ))}
                    {v.empty ? <div className={s.secEmpty}>{v.empty}</div> : null}
                  </>
                ) : null}
              </div>
            );
          })}

          <button
            type="button"
            className={s.newSection}
            onClick={tb.addSection}
            onDragOver={(e) => {
              if (!secDrag) return;
              e.preventDefault();
              if (secDrop !== '__end') setSecDrop('__end');
            }}
            onDrop={(e) => {
              if (!secDrag) return;
              e.preventDefault();
              dropSection(null);
            }}
          >
            <Icon name="add" />
            New section
            <span className={s.endDrop} data-on={secDrag !== null && secDrop === '__end'} />
          </button>
        </div>

        <div className={s.sideFoot}>
          <div className={s.sideFootHead}>
            <span className={s.eyebrow}>Live charts</span>
            <span className={s.count11}>{tree ? String(totalCharts(pages, live)) : ''}</span>
          </div>
          <div className={s.sideFootCopy}>Drop an HTML file from Claude onto any page and it becomes a live chart, saved with the page.</div>
        </div>
      </div>
    </aside>
  );
}
