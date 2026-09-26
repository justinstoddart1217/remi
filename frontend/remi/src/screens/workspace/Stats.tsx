import clsx from 'clsx';
import { useState } from 'react';
import type { MouseEvent } from 'react';

import { useReplanProject, useUpdateProject } from '../../api';
import type { ProjectOut } from '../../api';
import { Button, ConfidencePips, DeltaChip, DOMAIN_ACCENT, Icon, InlineField, Roll } from '../../components';
import { useMoved } from '../../stores/planMoves';
import { useOverlays } from '../../stores/overlays';
import { checkedInText, forecastChip, statsModel, verdictSentence } from './copy';
import type { PickerRequest } from './picker';
import { START_NOTE } from './picker';
import type { Guard } from './types';
import s from './Workspace.module.css';

/** What the header cells show at the scrubber's nearest stop (the live plan when not scrubbing). */
export interface NearView {
  /** 'Wed 2 Dec' or 'Not yet'. */
  forecast: string;
  /** Business days against the target, or null without a forecast. */
  deltaBd: number | null;
  confidence: number | null;
}

interface StatsProps {
  project: ProjectOut;
  today: string;
  near: NearView;
  inHistory: boolean;
  openPicker: (req: PickerRequest, trigger: HTMLElement) => void;
  guard: Guard;
}

/** The prototype's number-field width: `calc(max(1, len) × 0.62em + 8px)` (Workspace.dc.html:410-411). */
function numWidth(text: string): string {
  return `calc(${String(Math.max(1, text.length) * 0.62)}em + 8px)`;
}

/**
 * The stats strip (Workspace.dc.html:22-93): Start, Target, Forecast, Hours a day, Work left
 * and To land on target, the progress rule, and the verdict row. The Roll cells re-forecast on
 * the server: Start and the two number fields call `replan`, Target patches the project.
 */
export function Stats({ project: p, today, near, inHistory, openPicker, guard }: StatsProps) {
  const replan = useReplanProject();
  const update = useUpdateProject();
  const moved = useMoved(p.id);
  const [rateDraft, setRateDraft] = useState<string | undefined>(undefined);
  const [leftDraft, setLeftDraft] = useState<string | undefined>(undefined);

  const stats = statsModel(p, today);
  const say = verdictSentence(p);
  const chip = forecastChip(near.deltaBd);
  const accent = DOMAIN_ACCENT[p.domain];
  const rateText = rateDraft ?? String(p.rate);
  const leftText = leftDraft ?? stats.left.value;

  const pickStart = (e: MouseEvent<HTMLButtonElement>) => {
    openPicker(
      {
        key: 'start',
        value: p.startDate,
        note: START_NOTE,
        label: 'Start date',
        onPick: (iso) => {
          if (iso !== p.startDate) void guard(replan.mutateAsync({ projectId: p.id, input: { startDate: iso } }));
        },
      },
      e.currentTarget,
    );
  };
  const pickTarget = (e: MouseEvent<HTMLButtonElement>) => {
    openPicker(
      {
        key: 'target',
        value: p.targetDate,
        label: 'Target date',
        onPick: (iso) => {
          if (iso !== p.targetDate) void guard(update.mutateAsync({ projectId: p.id, patch: { targetDate: iso } }));
        },
      },
      e.currentTarget,
    );
  };

  return (
    <div className={s.strip}>
      <div className={s.stats}>
        <div className={s.cell}>
          <div className={s.label}>Start</div>
          <span className={s.pickWrap}>
            <button
              type="button"
              className={s.dateButton}
              title="Change the start date"
              aria-label={`Start date, ${stats.start.roll}`}
              onClick={pickStart}
            >
              <span className={s.host}>
                <Roll value={stats.start.roll} />
              </span>
              <span className={s.calBox}>
                <Icon name="calendar_month" className={s.calIcon} />
              </span>
            </button>
          </span>
          <div className={s.sub}>{stats.start.sub}</div>
        </div>

        <div className={s.cell}>
          <div className={s.label}>Target</div>
          <span className={s.pickWrap}>
            <button
              type="button"
              className={s.dateButton}
              title="Change the target date"
              aria-label={`Target date, ${stats.target.roll}`}
              onClick={pickTarget}
            >
              <span className={s.host}>
                <Roll value={stats.target.roll} />
              </span>
              <span className={s.calBox}>
                <Icon name="calendar_month" className={s.calIcon} />
              </span>
            </button>
          </span>
          <div className={s.sub}>{stats.target.sub}</div>
        </div>

        <div className={clsx(s.cell, s.forecastCell)} data-late={say.late}>
          <div className={s.labelRow}>
            <span className={s.label}>{inHistory ? 'Forecast then' : 'Forecast'}</span>
            <DeltaChip
              tone="risk"
              size="m"
              weight={600}
              show={moved !== null}
              label={moved ? `moved ${moved.label}` : undefined}
              className={s.movedChip}
            />
          </div>
          <div className={s.valueRow}>
            <span className={s.bigValue}>
              <span className={s.host}>
                <Roll value={near.forecast} />
              </span>
            </span>
            <DeltaChip tone={chip.tone} size="l" weight={500} label={chip.label} className={s.headChip} />
          </div>
          <div className={s.sub}>{stats.forecast.sub}</div>
        </div>

        <div className={s.cell}>
          <div className={s.label}>Hours a day</div>
          <div className={s.inputRow}>
            <InlineField
              value={p.rate}
              numeric={{ max: 24 }}
              placeholder="—"
              inputMode="decimal"
              aria-label="Hours a day"
              data-fk="rate"
              className={s.numInput}
              style={{ width: numWidth(rateText) }}
              onDraftChange={setRateDraft}
              onCommit={(rate: number) => guard(replan.mutateAsync({ projectId: p.id, input: { rate } }))}
            />
            <span className={s.unitH}>h</span>
            <span className={s.unit}>a day</span>
          </div>
          <div className={s.sub}>{stats.rate.sub}</div>
        </div>

        <div className={s.cell}>
          <div className={s.label}>Work left</div>
          <div className={s.inputRow}>
            <InlineField
              value={stats.left.value}
              numeric={{ max: 999 }}
              placeholder="—"
              inputMode="decimal"
              aria-label="Work left in hours"
              data-fk="left"
              className={s.numInput}
              style={{ width: numWidth(leftText || '—') }}
              onDraftChange={setLeftDraft}
              onCommit={(workLeft: number) => guard(replan.mutateAsync({ projectId: p.id, input: { workLeft } }))}
            />
            <span className={s.unitH}>h</span>
            <span className={s.unit}>to go</span>
          </div>
          <div className={s.sub}>{stats.left.sub}</div>
        </div>

        <div className={s.cell}>
          <div className={s.label}>To land on target</div>
          <div className={s.needRow}>
            <span className={s.needValue} data-bad={stats.need.bad} data-none={stats.need.none}>
              <span className={s.inlineFlex}>
                <span className={s.host}>
                  <Roll value={stats.need.value} />
                </span>
              </span>
            </span>
            <span className={s.needUnit}>{stats.need.unit}</span>
          </div>
          <div className={clsx(s.sub, s.needSub)} data-bad={stats.need.bad}>
            {stats.need.sub}
          </div>
        </div>
      </div>

      <div className={s.progress}>
        <div className={s.progressFill} style={{ width: stats.progress, background: accent }} />
      </div>

      <div className={s.verdict}>
        <div className={s.sayLine}>
          <span className={s.sayDot} data-tone={say.tone} aria-hidden="true" />
          <span className={s.sayText}>{say.text}</span>
        </div>
        <span className={s.confidence}>
          Confidence
          <ConfidencePips value={near.confidence} size="m" labelTone="ink" />
        </span>
        <span className={s.checked}>
          Checked in{' '}
          <span className={s.checkedWhen} data-stale={p.derived.stale}>
            {checkedInText(p.derived.sinceDays)}
          </span>
        </span>
        <Button
          variant="outline"
          size="m"
          onClick={() => {
            useOverlays.getState().openDrawer(p.id);
          }}
        >
          Tell Remi
        </Button>
      </div>
    </div>
  );
}
