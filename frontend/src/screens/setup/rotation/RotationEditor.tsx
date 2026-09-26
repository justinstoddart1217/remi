import clsx from 'clsx';
import { useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';

import { EmptyState, Icon, InlineField } from '../../../components';
import type { SegmentDraft } from './model';
import {
  blankSegment,
  countedTotals,
  editSegment,
  MAX_LENGTH_BD,
  MAX_SEGMENTS,
  moveSegment,
  position,
  segmentIssue,
} from './model';
import r from './Rotation.module.css';

export interface RotationEditorProps {
  segments: readonly SegmentDraft[];
  onChange: (next: readonly SegmentDraft[]) => void;
  /** Laid-out dates per segment key ('4 Jan – 11 Jan'), for segments the server has placed. */
  dates?: Readonly<Record<string, string>>;
  /** The segment running today (ink border). */
  currentKey?: string | null;
  /** Copy for the empty list. */
  emptyText: string;
  /** Extra words at the right of the totals line (Settings: when loop 1 ends). */
  footNote?: string;
}

/**
 * The Fixed Income rotation as an ordered row of editable tiles: code, country, length in
 * business days and a Build/Refresh pill. Typing a code fills the country and vice versa.
 * Reorder with the arrows, Alt+←/→, or by dragging the grip; remove with ×.
 */
export function RotationEditor({ segments, onChange, dates, currentKey, emptyText, footNote }: RotationEditorProps) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const update = (index: number, patch: Parameters<typeof editSegment>[1]) => {
    const seg = segments[index];
    if (!seg) return;
    const next = [...segments];
    next[index] = editSegment(seg, patch);
    onChange(next);
  };
  const move = (from: number, to: number) => {
    const next = moveSegment(segments, from, to);
    if (next !== segments) onChange(next);
  };
  const remove = (index: number) => {
    onChange(segments.filter((_, k) => k !== index));
  };
  const add = () => {
    if (segments.length >= MAX_SEGMENTS) return;
    const last = segments[segments.length - 1];
    const seg = blankSegment(last?.pass ?? 'Build');
    setFresh(seg.key);
    onChange([...segments, seg]);
  };

  const onTileKey = (index: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, index - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, index + 1);
    }
  };

  const endDrag = () => {
    setArmed(null);
    setDragging(null);
    setDropAt(null);
  };
  const onDragOver = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropAt !== index) setDropAt(index);
  };
  const onDrop = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from = segments.findIndex((s) => s.key === dragging);
    if (from >= 0) move(from, from < index ? index - 1 : index);
    endDrag();
  };

  const totals = countedTotals(segments);

  return (
    <div>
      {segments.length === 0 && <EmptyState className={r.empty}>{emptyText}</EmptyState>}
      {/* The grid lays out the tiles and the add button as one run of cells; only the tiles
          are the list (role=list must hold list items only), so the list itself is
          display:contents and the button sits beside it in the grid. */}
      <div className={r.grid}>
        <div className={r.list} role="list" aria-label="Rotation, in order">
          {segments.map((seg, index) => {
            const issue = segmentIssue(seg);
            const label = `stop ${String(index + 1)}`;
            return (
              <div
                key={seg.key}
                role="listitem"
                className={r.tile}
                data-current={seg.key === currentKey}
                data-issue={issue !== null}
                data-fresh={seg.key === fresh}
                data-dragging={seg.key === dragging}
                data-drop={dropAt === index && dragging !== null && dragging !== seg.key}
                draggable={armed === seg.key}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', seg.code || seg.key);
                  setDragging(seg.key);
                }}
                onDragOver={onDragOver(index)}
                onDrop={onDrop(index)}
                onDragEnd={endDrag}
                onKeyDown={onTileKey(index)}
                onAnimationEnd={() => {
                  if (fresh === seg.key) setFresh(null);
                }}
              >
                <div className={r.top}>
                  <span className={r.code}>
                    {position(index)} ·
                    <InlineField
                      value={seg.code}
                      placeholder="DE"
                      className={r.codeInput}
                      aria-label={`Country code, ${label}`}
                      onCommit={(v) => {
                        update(index, { code: v });
                      }}
                    />
                  </span>
                  <div className={r.tools}>
                    <button
                      type="button"
                      className={clsx(r.tool, r.grip)}
                      title="Drag to reorder"
                      aria-hidden="true"
                      tabIndex={-1}
                      onPointerDown={() => {
                        setArmed(seg.key);
                      }}
                      onPointerUp={() => {
                        if (dragging === null) setArmed(null);
                      }}
                    >
                      <Icon name="drag_indicator" />
                    </button>
                    <button
                      type="button"
                      className={r.tool}
                      title="Move earlier (Alt+←)"
                      aria-label={`Move ${label} earlier`}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, index - 1);
                      }}
                    >
                      <Icon name="chevron_left" />
                    </button>
                    <button
                      type="button"
                      className={r.tool}
                      title="Move later (Alt+→)"
                      aria-label={`Move ${label} later`}
                      disabled={index === segments.length - 1}
                      onClick={() => {
                        move(index, index + 1);
                      }}
                    >
                      <Icon name="chevron_right" />
                    </button>
                    <button
                      type="button"
                      className={clsx(r.tool, r.remove)}
                      title="Remove"
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        remove(index);
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={r.pass}
                    data-pass={seg.pass}
                    title={seg.pass === 'Build' ? 'Build pass: switch to Refresh' : 'Refresh pass: switch to Build'}
                    aria-label={`${seg.pass} pass, ${label}. Switch to ${seg.pass === 'Build' ? 'Refresh' : 'Build'}`}
                    onClick={() => {
                      update(index, { pass: seg.pass === 'Build' ? 'Refresh' : 'Build' });
                    }}
                  >
                    {seg.pass}
                  </button>
                </div>
                <InlineField
                  value={seg.country}
                  placeholder="Country"
                  className={r.countryInput}
                  aria-label={`Country, ${label}`}
                  autoFocus={seg.key === fresh}
                  onCommit={(v) => {
                    update(index, { country: v });
                  }}
                />
                <span className={r.mono}>
                  <InlineField
                    numeric={{ min: 1, max: MAX_LENGTH_BD }}
                    value={seg.lengthBd}
                    inputMode="numeric"
                    className={r.lenInput}
                    aria-label={`Length in business days, ${label}`}
                    onCommit={(v: number) => {
                      update(index, { lengthBd: v });
                    }}
                  />
                  BD
                  {dates?.[seg.key] && <span className={r.dates}>· {dates[seg.key]}</span>}
                </span>
                {issue && <span className={r.issue}>{issue}</span>}
              </div>
            );
          })}
        </div>
        {segments.length < MAX_SEGMENTS && (
          <button type="button" className={r.add} onClick={add}>
            <Icon name="add" className={r.addIcon} />
            {segments.length === 0 ? 'Add the first country' : 'Add a country'}
          </button>
        )}
      </div>
      {segments.length > 0 && (
        <div className={r.foot}>
          <span className={r.footNum}>
            {String(totals.build)} BD first loop
            {totals.refresh > 0 ? ` · ${String(totals.refresh)} BD refresh` : ''}
          </span>
          {totals.unfinished > 0 && (
            <span className={r.footUnfinished}>
              {totals.unfinished === 1
                ? '1 unfinished stop, not counted'
                : `${String(totals.unfinished)} unfinished stops, not counted`}
            </span>
          )}
          {footNote && <span>{footNote}</span>}
          <span className={r.footSpacer} />
          <span className={r.hint}>Alt+← → to reorder</span>
        </div>
      )}
    </div>
  );
}
