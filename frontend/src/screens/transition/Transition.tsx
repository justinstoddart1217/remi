/**
 * Transition (Transition.dc.html): "Am I on track to move cleanly?"
 *
 * - The hero: business days to the move (ADR-0009) and the verdict with its sentence.
 * - The strip: every business day left, flags for the Private Credit exits, the key run and the
 *   move, and the months.
 * - Private Credit winds down: its projects (readiness, forecast, delta) and every routine by
 *   handover stage. Fixed Income ramps up: the onboarding readiness list (an inline list,
 *   decision 10), the first three rotation stops and the projects after day one.
 *
 * Every number comes from `GET /plan`; the readiness list writes through the readiness item
 * mutations, which return the new plan.
 */

import clsx from 'clsx';
import { useCallback, useMemo } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { planStatusOf, useCreateReadinessItem, useDeleteReadinessItem, usePlan, useUpdateReadinessItem } from '../../api';
import type { PlanOut } from '../../api';
import { paths } from '../../app/screens';
import { DeltaChip, DomainDot, InlineList, RotationTile, TextLink, Toast, useToast } from '../../components';
import { useArrival, useIsActiveScreen } from '../../lib/arrival';
import { VERDICT_CHROME } from '../../shell/HeaderBar/headerModel';
import { hoverHandlers, hoverKey } from '../../stores/hover';
import {
  afterDayOneRows,
  countdownLabel,
  COPY,
  dueLabel,
  firstRotation,
  handoverRows,
  keyProjectOf,
  longDate,
  onboardingHost,
  onboardingItems,
  onboardingNote,
  projectCount,
  readyCount,
  stripModel,
  verdictSentence,
  windDownRows,
} from './model';
import type { AfterRow, WindDownRow } from './model';
import { MoveStrip } from './MoveStrip';
import s from './Transition.module.css';
import { useScreenDimmed } from '../linkedHover';

const delay = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

/** Enter or Space on a row that behaves as a link. */
function activate(e: KeyboardEvent, go: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    go();
  }
}

export default function TransitionScreen() {
  const plan = usePlan();
  if (plan.data) return <TransitionView plan={plan.data} />;
  const status = planStatusOf(plan);
  return (
    <div className={s.page} aria-busy={status === 'loading' ? true : undefined}>
      <h1 className={s.eyebrowTitle} tabIndex={-1}>
        {COPY.eyebrow}
      </h1>
      {status === 'error' && (
        <div className={s.status}>
          Remi couldn’t read your plan.
          <button type="button" className={s.retry} onClick={() => void plan.refetch()}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function TransitionView({ plan }: { plan: PlanOut }) {
  const navigate = useNavigate();
  const isActive = useIsActiveScreen();
  const arrival = useArrival(isActive);
  const { message: toastMessage, show: showToast } = useToast();
  const { mutateAsync: createItem } = useCreateReadinessItem();
  const { mutateAsync: updateItem } = useUpdateReadinessItem();
  const { mutateAsync: deleteItem } = useDeleteReadinessItem();

  const move = plan.move;
  const chrome = VERDICT_CHROME[plan.verdict.state];
  const sentence = verdictSentence(plan.verdict, move.date, keyProjectOf(plan));
  const strip = useMemo(() => stripModel(move, plan.projects), [move, plan.projects]);
  const winding = useMemo(() => windDownRows(plan.projects), [plan.projects]);
  const handover = useMemo(() => handoverRows(plan.routines), [plan.routines]);
  const host = onboardingHost(plan.projects, move.date);
  const items = useMemo(() => (host ? onboardingItems(host.readinessItems) : []), [host]);
  const note = host ? onboardingNote(host, host.readinessItems, move.date) : null;
  const rotation = firstRotation(plan.rotation, move.date);
  const after = afterDayOneRows(plan.projects, host?.id ?? null);

  const open = useCallback(
    (projectId: string) => {
      void navigate(paths.project(projectId));
    },
    [navigate],
  );

  // Under the onboarding rows: the host's note, or with no Fixed Income project to hold the
  // items, the way to start one.
  const onbFooter = !host ? (
    <TextLink
      className={s.onbLink}
      onClick={() => {
        void navigate(paths.projects());
      }}
    >
      {COPY.startFiProject}
    </TextLink>
  ) : note ? (
    <div className={s.onbNote}>{note}</div>
  ) : null;

  /** Shows the toast and keeps the promise rejected, so the line that saved reverts. */
  const failed = useCallback(
    (error: unknown): Promise<never> => {
      showToast(COPY.saveFailed);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    },
    [showToast],
  );

  return (
    <div className={s.page} {...arrival.attrs}>
      <div className={clsx(s.hero, s.arrive)} style={delay(0)}>
        <div>
          <h1 className={s.eyebrowTitle} tabIndex={-1}>
            {COPY.eyebrow}
          </h1>
          <div className={s.countRow}>
            <span className={s.count}>{move.countdownBd}</span>
            <div className={s.countText}>
              <span className={s.countLabel}>{countdownLabel(move.countdownBd)}</span>
              <span className={s.moveDate}>{longDate(move.date)}</span>
            </div>
          </div>
        </div>
        <div className={s.verdict}>
          <div className={s.eyebrow}>{COPY.question}</div>
          <div className={s.answerRow}>
            <span className={s.answerDot} style={{ background: chrome.dot }} />
            <span className={s.answer}>{chrome.short}</span>
          </div>
          <p className={s.sentence}>{sentence}</p>
        </div>
      </div>

      <MoveStrip strip={strip} region={plan.calendar.region} style={delay(1)} />

      <div className={clsx(s.columns, s.arrive)} style={delay(2)}>
        <section aria-label="Private Credit wind down">
          <div className={s.colHead}>
            <DomainDot color="pc" />
            <h2 className={s.colTitle}>Private Credit</h2>
            <span className={s.colSub}>wind down</span>
          </div>

          <div className={s.group}>
            <div className={s.blockHead}>
              <h3 className={s.eyebrowPc}>{COPY.windDown}</h3>
              <span className={s.blockCount}>{projectCount(winding.length)}</span>
            </div>
            {winding.map((row) => (
              <WindDown key={row.id} row={row} onOpen={open} />
            ))}
            {winding.length === 0 && <div className={s.empty}>{COPY.noWindDown}</div>}
          </div>

          <div className={s.block}>
            <h3 className={s.eyebrow}>{COPY.routines}</h3>
            {handover.map((r) => (
              <div key={r.id} className={s.line}>
                <div>
                  <div className={s.lineName}>{r.name}</div>
                  <div className={s.lineNote}>{r.note}</div>
                </div>
                <span className={s.stagePill}>
                  <span className={s.stageDot} />
                  {r.status}
                </span>
              </div>
            ))}
            {handover.length === 0 && <div className={s.empty}>{COPY.noRoutines}</div>}
          </div>
        </section>

        <section aria-label="Fixed Income ramp up">
          <div className={s.colHead}>
            <DomainDot color="fi" />
            <h2 className={s.colTitle}>Fixed Income</h2>
            <span className={s.colSub}>ramp up</span>
          </div>

          {/* Onboarding readiness (:98-109) as an inline list (decision 10), in its line form. */}
          <InlineList
            row="line"
            addVisibility="hover"
            label={COPY.onboarding}
            labelTone="fi"
            labelAs="h3"
            headAside={(shown) => (shown.length > 0 ? <span className={s.blockCount}>{readyCount(shown)}</span> : null)}
            placeholder={COPY.onboardingPlaceholder}
            emptyText={host ? COPY.noOnboarding : COPY.noOnboardingHost}
            items={items.map((x) => ({ id: x.id, text: x.text, done: x.done, meta: (done: boolean) => dueLabel(done, x.dueDate) }))}
            // Items belong to a Fixed Income project: with none there is nothing to add them to,
            // so the list says why and links to Projects instead of offering a dead '+ Add'.
            onAdd={host ? (text) => createItem({ projectId: host.id, body: { text } }).catch(failed) : undefined}
            onChange={(itemId, text) => updateItem({ itemId, patch: { text } }).catch(failed)}
            onRemove={(itemId) => deleteItem({ itemId }).catch(failed)}
            onToggle={(itemId, done) => updateItem({ itemId, patch: { done } }).catch(failed)}
            footer={onbFooter}
            className={s.onb}
          />

          <div className={s.block}>
            <div className={s.blockHead}>
              <h3 className={s.eyebrowFi}>{COPY.firstRotation}</h3>
              {rotation && <span className={s.blockCount}>{rotation.starts}</span>}
            </div>
            {rotation ? (
              <>
                <div className={s.tiles}>
                  {rotation.tiles.map((t) => (
                    <RotationTile
                      key={t.id}
                      code={t.code}
                      country={t.country}
                      pass={t.pass}
                      dates={t.dates}
                      current={t.current}
                      filledPill
                    />
                  ))}
                </div>
                <TextLink
                  className={s.wholeLink}
                  onClick={() => {
                    void navigate(paths.routines({ rotation: true }));
                  }}
                >
                  {rotation.link}
                </TextLink>
              </>
            ) : (
              <div className={s.empty}>
                {COPY.noRotation}{' '}
                <TextLink
                  className={s.inlineLink}
                  onClick={() => {
                    void navigate(paths.settings('rotation'));
                  }}
                >
                  {COPY.setUpRotation}
                </TextLink>
              </div>
            )}
          </div>

          <div className={s.block}>
            <h3 className={s.eyebrowFi}>{COPY.afterDayOne}</h3>
            {after.map((row) => (
              <AfterDayOne key={row.id} row={row} onOpen={open} />
            ))}
            {after.length === 0 && <div className={s.empty}>{COPY.nothingAfter}</div>}
          </div>
        </section>
      </div>

      <div className={s.toastLayer}>
        <Toast message={toastMessage} />
      </div>
    </div>
  );
}

/** A wind-down project: hover dims the others, a click opens its workspace. */
function WindDown({ row, onOpen }: { row: WindDownRow; onOpen: (id: string) => void }) {
  const own = hoverKey('project', row.id);
  const dimmed = useScreenDimmed(own);
  const go = () => {
    onOpen(row.id);
  };
  return (
    <div
      role="link"
      tabIndex={0}
      className={s.project}
      data-dimmed={dimmed ? '' : undefined}
      onClick={go}
      onKeyDown={(e) => {
        activate(e, go);
      }}
      {...hoverHandlers(own)}
    >
      <span className={s.projectName}>{row.name}</span>
      <span className={s.ready}>
        <span className={s.readyTrack}>
          <span className={s.readyFill} style={{ width: `${String(row.ready)}%` }} />
        </span>
        <span className={s.readyPct}>{row.readyLabel}</span>
      </span>
      <span className={s.forecast}>
        <span>{row.forecast}</span>
        <DeltaChip tone={row.tone} size="m" weight={400} label={row.chip} />
      </span>
    </div>
  );
}

function AfterDayOne({ row, onOpen }: { row: AfterRow; onOpen: (id: string) => void }) {
  const go = () => {
    onOpen(row.id);
  };
  return (
    <div
      role="link"
      tabIndex={0}
      className={clsx(s.line, s.clickable)}
      onClick={go}
      onKeyDown={(e) => {
        activate(e, go);
      }}
    >
      <div>
        <div className={s.lineName}>{row.name}</div>
        <div className={s.lineNote}>{row.note}</div>
      </div>
      <span className={s.target}>{row.target}</span>
    </div>
  );
}
