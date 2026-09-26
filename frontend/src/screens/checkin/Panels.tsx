/**
 * The right column of Tell Remi, one panel per phase (CheckIn.dc.html lines 38-113).
 */

import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import { useCheckinPreview } from '../../api';
import type { ProjectOut, ProposalOut, RoutineOut } from '../../api';
import { CheckboxMark } from '../../components/Checkbox';
import s from './CheckIn.module.css';
import {
  CAPS,
  CAPS_LABEL,
  CAPS_NOTE,
  ERROR_TITLE,
  errorText,
  NOTHING_FOUND,
  REVIEW_LABEL,
  THINKING_LABEL,
  THINKING_NOTE,
  TRY_AGAIN,
  UNPLACED_HINT,
  UNPLACED_LABEL,
  USE_SIMPLE,
} from './copy';
import { effectChip, groupChanges, selectedChanges, sourceNote, summaryOf } from './model';
import type { Progress } from './reducer';

const delay = (ms: number): CSSProperties => ({ transitionDelay: `${String(ms)}ms` });

export function ComposePanel() {
  return (
    <div className={s.panel}>
      <div className={s.eyebrow}>{CAPS_LABEL}</div>
      <div className={s.caps}>
        {CAPS.map((c) => (
          <div key={c.k} className={s.cap}>
            <span className={s.capKey}>{c.k}</span>
            <span className={s.capExample}>{c.v}</span>
          </div>
        ))}
      </div>
      <div className={s.capsNote}>{CAPS_NOTE}</div>
    </div>
  );
}

export function ThinkingPanel({ progress, echo, echoOn }: { progress: Progress; echo: readonly string[]; echoOn: boolean }) {
  return (
    <div className={s.panel} aria-live="polite">
      <div className={s.thinkingHead}>
        <span className={s.thinkingLabel}>{THINKING_LABEL}</span>
        <span className={s.mono}>{THINKING_NOTE}</span>
      </div>
      <div className={s.track}>
        <div className={s.bar} data-progress={String(progress)} />
      </div>
      <div className={s.echoes}>
        {echo.map((sentence, i) => (
          <div key={`${String(i)}:${sentence}`} className={s.echo} data-on={echoOn ? '' : undefined} style={delay(i * 180)}>
            “{sentence}”
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ReviewPanelProps {
  result: ProposalOut;
  off: Readonly<Record<number, true>>;
  shown: boolean;
  projects: readonly ProjectOut[];
  routines: readonly RoutineOut[];
  onToggle: (index: number) => void;
}

export function ReviewPanel({ result, off, shown, projects, routines, onToggle }: ReviewPanelProps) {
  const selected = useMemo(() => selectedChanges(result.changes, off), [result.changes, off]);
  const groups = useMemo(() => groupChanges(result.changes, off, projects, routines), [result.changes, off, projects, routines]);
  const preview = useCheckinPreview(selected);
  const byProject = useMemo(() => new Map((preview.data?.projects ?? []).map((p) => [p.projectId, p])), [preview.data]);
  const summary = summaryOf(result);

  return (
    <div className={s.review}>
      <div className={s.reviewHead}>
        <span className={s.eyebrow}>{REVIEW_LABEL}</span>
        <span className={s.mono}>{sourceNote(result.source, selected.length, result.changes.length)}</span>
      </div>
      {summary ? <p className={s.summary}>{summary}</p> : null}
      {groups.map((group, k) => {
        const chip = group.projectId ? effectChip(byProject.get(group.projectId), group.targetMoved) : null;
        return (
          <div key={group.key} className={s.group} data-shown={shown ? '' : undefined} style={delay(k * 70)}>
            <div className={s.groupHead}>
              <span className={s.groupDot} style={{ background: group.accent }} />
              <span className={s.groupName}>{group.name}</span>
              {chip ? (
                <span className={s.effect} data-late={chip.late ? '' : undefined}>
                  {chip.text}
                </span>
              ) : null}
            </div>
            {group.rows.map((row) => (
              <button
                key={row.index}
                type="button"
                role="checkbox"
                aria-checked={row.on}
                className={s.row}
                onClick={() => {
                  onToggle(row.index);
                }}
              >
                <CheckboxMark checked={row.on} size={16} pop={false} className={s.rowBox} />
                <span className={s.kind} data-risk={row.risk ? '' : undefined}>
                  {row.kind}
                </span>
                <span className={s.rowText}>{row.text}</span>
              </button>
            ))}
          </div>
        );
      })}
      {result.unplaced.length ? (
        <div className={s.unplaced}>
          <div className={s.eyebrow}>{UNPLACED_LABEL}</div>
          {result.unplaced.map((u, i) => (
            <div key={`${String(i)}:${u}`} className={s.quote}>
              “{u}”
            </div>
          ))}
          <div className={s.unplacedHint}>{UNPLACED_HINT}</div>
        </div>
      ) : null}
      {result.changes.length === 0 ? <div className={s.nothing}>{NOTHING_FOUND}</div> : null}
    </div>
  );
}

export interface ErrorPanelProps {
  message: string;
  simplePending: boolean;
  onRetry: () => void;
  onSimple: () => void;
}

export function ErrorPanel({ message, simplePending, onRetry, onSimple }: ErrorPanelProps) {
  return (
    <div className={s.panel} role="alert">
      <div className={s.errorTitle}>{ERROR_TITLE}</div>
      <div className={s.errorText}>{errorText(message)}</div>
      <div className={s.errorActions}>
        <button type="button" className={s.retry} onClick={onRetry}>
          {TRY_AGAIN}
        </button>
        <button type="button" className={s.simple} onClick={onSimple} disabled={simplePending}>
          {USE_SIMPLE}
        </button>
      </div>
    </div>
  );
}
