/**
 * "Remi reads these" (Notes.dc.html lines 80-117): the rail note, the CTA that turns the day into
 * a Tell Remi update, the day's mentions, and this week's spark. It folds away like the
 * notebook, to a 52px strip on the right with a "Show side panel" toggle and a vertical label.
 */

import clsx from 'clsx';
import { useId } from 'react';

import { Icon } from '../../components/Icon';
import { DOMAIN_ACCENT } from '../../components/shared/domain';
import { count } from '../../lib/format';
import { hoverKey, useHover } from '../../stores/hover';
import s from './Notes.module.css';
import {
  CTA_EMPTY,
  CTA_LABEL,
  HIDE_SIDE_PANEL,
  MENTIONED_LABEL,
  NO_MENTIONS,
  READS_LABEL,
  SHOW_SIDE_PANEL,
  tagHover,
  tagKey,
  WEEK_LABEL,
} from './model';
import type { NoteMentionOut, SparkBar } from './model';
import { PanelToggle } from './PanelToggle';
import { useToggleFocus } from './useToggleFocus';

export interface ReadsPanelProps {
  note: string;
  canSend: boolean;
  ctaNote: string;
  onSend: () => void;
  mentions: readonly NoteMentionOut[];
  onOpen: (target: Pick<NoteMentionOut, 'targetType' | 'targetId'>) => void;
  spark: readonly SparkBar[];
  onPick: (day: string) => void;
  open: boolean;
  onToggle: () => void;
  /** True while the expanded note is open over the screen. */
  inert?: boolean;
}

function hoverOn(target: Pick<NoteMentionOut, 'targetType' | 'targetId'>) {
  const k = tagHover(target);
  useHover.getState().set(hoverKey(k.type, k.id));
}

function hoverOff() {
  useHover.getState().clear();
}

export function ReadsPanel({
  note,
  canSend,
  ctaNote,
  onSend,
  mentions,
  onOpen,
  spark,
  onPick,
  open,
  onToggle,
  inert = false,
}: ReadsPanelProps) {
  const id = useId();
  const focus = useToggleFocus(open);
  const toggle = (button: HTMLButtonElement) => {
    focus.toggled(button);
    onToggle();
  };

  return (
    <div className={clsx(s.column, s.readsColumn)} data-open={open ? '' : undefined} inert={inert}>
      <div className={clsx(s.strip, s.stripRight)} inert={open}>
        <PanelToggle icon="right_panel_open" label={SHOW_SIDE_PANEL} expanded={false} controls={id} buttonRef={focus.showRef} onToggle={toggle} />
        <span className={s.stripLabel} aria-hidden="true">
          {READS_LABEL}
        </span>
      </div>
      <aside id={id} className={s.reads} aria-label="Remi reads these" inert={!open}>
        <div className={s.readsInner}>
          <div className={s.panelHead}>
            <span className={clsx(s.kicker, s.grow)}>{READS_LABEL}</span>
            <PanelToggle icon="right_panel_close" label={HIDE_SIDE_PANEL} expanded controls={id} buttonRef={focus.hideRef} onToggle={toggle} />
          </div>
          <p className={s.readsText}>{note}</p>
          <button
            type="button"
            className={s.cta}
            aria-disabled={canSend ? undefined : 'true'}
            onClick={() => {
              if (canSend) onSend();
            }}
          >
            <Icon name="edit_note" className={s.ctaIcon} />
            {canSend ? CTA_LABEL : CTA_EMPTY}
          </button>
          <div className={s.ctaNote}>{ctaNote}</div>

          <div className={clsx(s.kicker, s.section)}>{MENTIONED_LABEL}</div>
          <div className={s.mentions}>
            {mentions.map((m) => (
              <button
                key={tagKey(m)}
                type="button"
                className={s.mention}
                onClick={() => {
                  onOpen(m);
                }}
                onMouseEnter={() => {
                  hoverOn(m);
                }}
                onMouseLeave={hoverOff}
              >
                <span className={s.mentionDot} style={{ background: DOMAIN_ACCENT[m.domain] }} />
                <span className={s.mentionName}>{m.label}</span>
                <span className={s.mentionCount}>{count(m.count, 'note')}</span>
              </button>
            ))}
            {mentions.length === 0 ? <div className={s.noMentions}>{NO_MENTIONS}</div> : null}
          </div>

          <div className={clsx(s.kicker, s.section)}>{WEEK_LABEL}</div>
          <div className={s.spark}>
            {spark.map((bar) => (
              <button
                key={bar.day}
                type="button"
                className={s.sparkButton}
                title={bar.title}
                aria-label={bar.title}
                aria-pressed={bar.tone === 'selected'}
                onClick={() => {
                  onPick(bar.day);
                }}
              >
                <span className={s.sparkBar} data-tone={bar.tone} style={{ height: `${String(bar.heightPct)}%` }} />
              </button>
            ))}
          </div>
          <div className={s.sparkLabels} aria-hidden="true">
            {spark.map((bar) => (
              <span key={bar.day} className={s.sparkLabel} data-selected={bar.tone === 'selected' ? '' : undefined}>
                {bar.label}
              </span>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
