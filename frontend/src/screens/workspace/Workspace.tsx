import { useEffect, useMemo, useRef, useState } from 'react';

import { useSnapshots, useUpdateProject } from '../../api';
import type { ProjectOut } from '../../api';
import { BusinessDayDatePicker, DomainTag, Icon, InlineField, Toast } from '../../components';
import type { CalendarIndex } from '../../lib/calendar';
import { isoFromDayNumber } from '../../lib/calendar';
import { placeCaretAtEnd } from '../../lib/focus';
import { GOAL_TRANSITION_NAME } from '../../lib/viewTransition';
import { useUi } from '../../stores/ui';
import { Charter } from './Charter';
import { History } from './History';
import { pickerCalendar, usePicker } from './picker';
import { Plan } from './Plan';
import { buildSnaps, interpolate } from './scrubber';
import { forecastRoll } from './copy';
import { findField } from './model';
import { Stats } from './Stats';
import type { NearView } from './Stats';
import { useSave } from './useSave';
import s from './Workspace.module.css';

interface WorkspaceProps {
  project: ProjectOut;
  today: string;
  cal: CalendarIndex;
  /** Changes (to a new token) when the goal should take focus: after "+ New project". */
  goalFocusRequest: string | null;
  onBack: () => void;
}

/** Focus lands 30ms after the field renders, caret at the end (Workspace.dc.html:306). */
const FOCUS_DELAY_MS = 30;

/** The name field's width: max(6, len + 1)ch (Workspace.dc.html:319). */
function nameWidth(text: string): string {
  return `${String(Math.max(6, text.length + 1))}ch`;
}

/**
 * One project's workspace (Workspace.dc.html, layout A). Mounted with `key={project.id}`, so
 * switching project resets the scrubber, drafts, the picker and the remove confirmation
 * (critique :302).
 */
export function Workspace({ project: p, today, cal, goalFocusRequest, onBack }: WorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined);
  const [pendingFocus, setPendingFocus] = useState<string | null>(goalFocusRequest ? 'goal' : null);
  const [seenRequest, setSeenRequest] = useState(goalFocusRequest);
  if (goalFocusRequest !== seenRequest) {
    setSeenRequest(goalFocusRequest);
    if (goalFocusRequest) setPendingFocus('goal');
  }
  const { picker, open: openPicker, close: closePicker } = usePicker(rootRef);
  const { toast, guard } = useSave();
  const update = useUpdateProject();
  const snapshots = useSnapshots(p.id).data;
  const vtTo = useUi((st) => st.vtPhase === 'to' && st.vtId === p.id);

  const snaps = useMemo(
    () => buildSnaps(snapshots, { today, forecast: p.forecastDate, confidence: p.confidence, milestones: p.derived.milestones }),
    [snapshots, today, p.forecastDate, p.confidence, p.derived.milestones],
  );
  const safePos = pos !== null && pos <= snaps.length - 1 ? pos : null;
  const inHistory = safePos !== null;
  const near = interpolate(snaps, safePos).near;
  const nearView: NearView = inHistory
    ? {
        forecast: near.f != null ? forecastRoll(isoFromDayNumber(near.f)) : 'Not yet',
        deltaBd: near.f != null ? cal.bdDiff(near.target ?? p.targetDate, isoFromDayNumber(near.f)) : null,
        confidence: near.conf,
      }
    : { forecast: forecastRoll(p.forecastDate), deltaBd: p.derived.deltaBd, confidence: p.confidence };

  // A freshly added line (or the goal of a new project) takes focus once it has rendered.
  useEffect(() => {
    if (!pendingFocus) return;
    const el = findField(rootRef.current, pendingFocus);
    if (!el) return;
    const id = setTimeout(() => {
      el.focus({ preventScroll: false });
      placeCaretAtEnd(el);
      setPendingFocus((cur) => (cur === pendingFocus ? null : cur));
    }, FOCUS_DELAY_MS);
    return () => {
      clearTimeout(id);
    };
  }, [pendingFocus, p]);

  const nameText = nameDraft ?? p.name;

  return (
    <div ref={rootRef} className={s.root}>
      <h1 className={s.srTitle} tabIndex={-1} aria-label={p.name} />
      <div className={s.header}>
        <div className={s.headRow}>
          <button type="button" className={s.back} onClick={onBack}>
            <Icon name="chevron_left" className={s.backIcon} />
            Projects
          </button>
          <span className={s.divider} aria-hidden="true" />
          <DomainTag domain={p.domain} />
          <InlineField
            value={p.name}
            placeholder="Project name"
            required
            aria-label="Project name"
            data-fk="name"
            className={s.name}
            style={{ width: nameWidth(nameText) }}
            onDraftChange={setNameDraft}
            onCommit={(name) => guard(update.mutateAsync({ projectId: p.id, patch: { name, short: name } }))}
          />
        </div>
        <InlineField
          multiline
          cpl={40}
          value={p.goal}
          placeholder="What will be true when this is done?"
          aria-label="Goal"
          data-fk="goal"
          className={s.goal}
          style={{ viewTransitionName: vtTo ? GOAL_TRANSITION_NAME : 'none' }}
          onCommit={(goal) => guard(update.mutateAsync({ projectId: p.id, patch: { goal } }))}
        />
      </div>

      <Stats project={p} today={today} near={nearView} inHistory={inHistory} openPicker={openPicker} guard={guard} />

      <History project={p} today={today} cal={cal} snaps={snaps} pos={safePos} onPos={setPos} />

      <div className={s.body} data-history={inHistory} inert={inHistory}>
        <Charter project={p} guard={guard} />
        <Plan project={p} today={today} cal={cal} openPicker={openPicker} requestFocus={setPendingFocus} guard={guard} />
      </div>

      {picker ? (
        <BusinessDayDatePicker
          key={picker.key}
          value={picker.value}
          today={today}
          calendar={pickerCalendar(cal)}
          x={picker.x}
          y={picker.y}
          note={picker.note}
          label={picker.label}
          onPick={picker.onPick}
          onClose={closePicker}
        />
      ) : null}

      <Toast message={toast.message} className={s.toast} />
    </div>
  );
}
