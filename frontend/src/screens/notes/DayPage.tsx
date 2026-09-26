/**
 * The day page (Notes.dc.html lines 35-78): kicker and "Today" link, the long date, the sub
 * line, the composer (Enter jots, Shift+Enter breaks the line) and the day's notes, newest
 * first, each editable in place (Enter or blur saves, Escape reverts, blank deletes). Each note
 * has an expand button (faint until the row is hovered) that opens it in the expanded view.
 */

import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';

import { Icon } from '../../components/Icon';
import { hoverKey, useHover } from '../../stores/hover';
import { AutoTextarea } from './AutoTextarea';
import s from './Notes.module.css';
import { ENTER_HINT, EXPAND_NOTE, tagHover, tagKey, TO_TODAY } from './model';
import type { NoteTagOut } from './model';
import { TagChip } from './TagChip';

export interface EntryView {
  id: string;
  time: string;
  text: string;
  tags: readonly NoteTagOut[];
}

export interface DayPageProps {
  kicker: string;
  isToday: boolean;
  title: string;
  sub: string;
  nowTime: string;
  draft: string;
  placeholder: string;
  draftTags: readonly NoteTagOut[];
  entries: readonly EntryView[];
  fresh: string | null;
  empty: string | null;
  fading: boolean;
  /** Slide offset while fading (0 under reduced motion). */
  shift: number;
  /** The page's max width in px: wider as the rails fold away. */
  width: number;
  /** True while the expanded note is open over the screen. */
  inert?: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onDraft: (text: string) => void;
  onJot: () => void;
  onToday: () => void;
  onSave: (id: string, text: string) => void;
  onOpenTag: (tag: NoteTagOut) => void;
  /** Opens a note in the expanded view; `trigger` gets focus back when it closes. */
  onExpand: (entry: EntryView, trigger: HTMLButtonElement) => void;
  /** Error or loading content in place of the entries. */
  status?: ReactNode;
}

function Entry({
  entry,
  fresh,
  onSave,
  onOpenTag,
  onExpand,
}: {
  entry: EntryView;
  fresh: boolean;
  onSave: (id: string, text: string) => void;
  onOpenTag: (tag: NoteTagOut) => void;
  onExpand: (entry: EntryView, trigger: HTMLButtonElement) => void;
}) {
  // The draft lives here while the field is being edited (the prototype's `drafts[key]`).
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? entry.text;
  const first = entry.tags[0];

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    onSave(entry.id, draft.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      // Revert, and keep Escape from closing an overlay (crit :8, Notes:185).
      e.stopPropagation();
      setDraft(null);
      const el = e.currentTarget;
      setTimeout(() => {
        el.blur();
      }, 0);
    }
  };

  return (
    <div
      className={s.entry}
      data-fresh={fresh ? '' : undefined}
      onMouseEnter={() => {
        if (first) {
          const k = tagHover(first);
          useHover.getState().set(hoverKey(k.type, k.id));
        }
      }}
      onMouseLeave={() => {
        useHover.getState().clear();
      }}
    >
      <span className={s.entryTime}>{entry.time}</span>
      <div className={s.entryBody}>
        <AutoTextarea
          className={s.entryInput}
          value={value}
          data-nid={entry.id}
          aria-label={`Note at ${entry.time}`}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {entry.tags.length ? (
          <div className={s.entryTags}>
            {entry.tags.map((tag) => (
              <TagChip key={tagKey(tag)} tag={tag} onOpen={onOpenTag} />
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={s.expand}
        title={EXPAND_NOTE}
        aria-label={`${EXPAND_NOTE} at ${entry.time}`}
        onClick={(e) => {
          onExpand(entry, e.currentTarget);
        }}
      >
        <Icon name="open_in_full" className={s.expandIcon} />
      </button>
    </div>
  );
}

export function DayPage({
  kicker,
  isToday,
  title,
  sub,
  nowTime,
  draft,
  placeholder,
  draftTags,
  entries,
  fresh,
  empty,
  fading,
  shift,
  width,
  inert = false,
  composerRef,
  onDraft,
  onJot,
  onToday,
  onSave,
  onOpenTag,
  onExpand,
  status,
}: DayPageProps) {
  const pageStyle: CSSProperties = { maxWidth: `${String(width)}px` };
  if (fading && shift) pageStyle.transform = `translateY(${String(shift)}px)`;

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onJot();
    }
  };

  return (
    <div className={s.center} inert={inert}>
      <div className={s.page} data-fading={fading ? '' : undefined} style={pageStyle}>
        <div className={s.pageHead}>
          <span className={s.kicker}>{kicker}</span>
          {isToday ? null : (
            <button type="button" className={s.toToday} onClick={onToday}>
              <Icon name="chevron_left" className={s.toTodayIcon} />
              {TO_TODAY}
            </button>
          )}
        </div>
        <h1 className={s.title} tabIndex={-1}>
          {title}
        </h1>
        <div className={s.sub}>{sub}</div>

        <div className={s.composer}>
          <span className={s.nowTime} data-parity-mask="">
            {nowTime}
          </span>
          <div>
            <AutoTextarea
              ref={composerRef}
              className={s.composerInput}
              value={draft}
              placeholder={placeholder}
              aria-label="New note"
              onChange={(e) => {
                onDraft(e.target.value);
              }}
              onKeyDown={onComposerKey}
            />
            <div className={s.composerFoot}>
              {draftTags.map((tag) => (
                <TagChip key={tagKey(tag)} tag={tag} />
              ))}
              <span className={s.grow} />
              <span className={s.enterHint} data-on={draft.trim() ? '' : undefined}>
                {ENTER_HINT}
              </span>
            </div>
          </div>
        </div>

        {status ?? (
          <>
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} fresh={fresh === entry.id} onSave={onSave} onOpenTag={onOpenTag} onExpand={onExpand} />
            ))}
            {empty ? <div className={s.empty}>{empty}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}
