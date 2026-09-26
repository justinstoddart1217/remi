/**
 * The expanded note (Notes.dc.html lines 118-141, `openEx` / `closeEx`): one note opened large
 * over the Notes screen, for writing at length. A teal-topped white card on a deep-teal scrim,
 * with the day, the time and the note's tags above a 24px display-face textarea, and a word
 * count and the key hints below.
 *
 * - Enter is a new line. Escape, ⌘↵ / Ctrl+↵, the scrim and "Collapse" close it; closing saves
 *   the edit (a blanked note is deleted, as inline).
 * - "saves as you go": a pause in typing saves the text too (never a blank), so a long edit
 *   survives the app closing mid-way.
 * - The tags follow the text as it changes (`POST /notes/tags`, debounced).
 * - It sits in the Escape order as a layer while Notes is the active screen.
 *
 * NotesView owns the open / closing phases (mount, two frames, open; close, 300ms, unmount).
 */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useNoteTagPreview } from '../../api';
import { Icon } from '../../components/Icon';
import { useIsActiveScreen } from '../../lib/arrival';
import { placeCaretAtEnd, trapTab } from '../../lib/focus';
import { isSubmitShortcut } from '../../lib/keyboard';
import { useOverlayLayer } from '../../stores/overlays';
import type { EntryView } from './DayPage';
import { COLLAPSE, COLLAPSE_TITLE, EXPANDED_HINT, EXPANDED_PLACEHOLDER, tagKey, wordCount } from './model';
import s from './Notes.module.css';
import { TagChip } from './TagChip';

export const EXPANDED_LAYER = 'notes-expanded';
/** Focus the textarea this long after the card starts to open (the prototype's 60ms). */
const FOCUS_MS = 60;
/** A pause this long in typing saves the text. */
const AUTOSAVE_MS = 1000;

export interface ExpandedNoteProps {
  entry: EntryView;
  /** "Mon 5 Oct". */
  day: string;
  open: boolean;
  onSave: (id: string, text: string) => void;
  onClose: () => void;
}

export function ExpandedNote({ entry, day, open, onSave, onClose }: ExpandedNoteProps) {
  const active = useIsActiveScreen();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The edit in progress (the prototype's `drafts[key]`); null until the text changes.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? entry.text;
  const preview = useNoteTagPreview(draft ?? '');
  const tags = draft === null || draft === entry.text ? entry.tags : (preview.data?.tags ?? entry.tags);

  const close = () => {
    if (!open) return;
    if (draft !== null) onSave(entry.id, draft.trim());
    onClose();
  };

  useOverlayLayer(EXPANDED_LAYER, open && active, close);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      placeCaretAtEnd(el);
    }, FOCUS_MS);
    return () => {
      clearTimeout(id);
    };
  }, [open]);

  useEffect(() => {
    if (!open || draft === null) return;
    const text = draft.trim();
    if (!text || text === entry.text) return;
    const id = setTimeout(() => {
      onSave(entry.id, text);
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [open, draft, entry.id, entry.text, onSave]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape' || isSubmitShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className={s.ex} data-open={open ? '' : undefined} inert={!open}>
      <div className={s.exScrim} aria-hidden="true" onClick={close} />
      <div
        ref={cardRef}
        className={s.exCard}
        role="dialog"
        aria-modal="true"
        aria-label={`Note, ${day} at ${entry.time}`}
        onKeyDown={(e) => {
          trapTab(e, cardRef.current);
        }}
      >
        <span className={s.exAccent} aria-hidden="true" />
        <div className={s.exHead}>
          <span className={s.exPip} aria-hidden="true" />
          <span className={s.exDay}>{day}</span>
          <span className={s.exTime}>{entry.time}</span>
          <div className={s.exTags}>
            {tags.map((tag) => (
              <TagChip key={tagKey(tag)} tag={tag} />
            ))}
          </div>
          <span className={s.grow} />
          <button type="button" className={s.exCollapse} title={COLLAPSE_TITLE} onClick={close}>
            <Icon name="close_fullscreen" className={s.exCollapseIcon} />
            {COLLAPSE}
          </button>
        </div>
        <div className={s.exBody}>
          <textarea
            ref={inputRef}
            className={s.exInput}
            data-exp=""
            value={value}
            placeholder={EXPANDED_PLACEHOLDER}
            aria-label={`Note at ${entry.time}`}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={s.exFoot}>
          <span className={s.exCount}>{wordCount(value)}</span>
          <span className={s.grow} />
          <span>{EXPANDED_HINT}</span>
        </div>
      </div>
    </div>
  );
}
