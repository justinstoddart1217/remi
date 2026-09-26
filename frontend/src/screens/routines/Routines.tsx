/**
 * Routines (Routines.dc.html): every recurring Private Credit routine, editable in place (name,
 * rule, hours, handover stage and note), with its next three runs and the project that
 * automates it; then the Fixed Income rotation as a read-only stadium track.
 *
 * - `?focus=<routineId>` (Today's 'Routine ↗') scrolls the row to 120px below the top of the
 *   screen and flashes it for 1600ms; `?focus=rot` or `#rotation` scrolls to the rotation
 *   instead (crit Shell:581).
 * - 'Add BAU routine' appends a blank row that flashes for 1200ms and focuses its name.
 * - Every edit is a PATCH that returns the new plan, so Today, Timeline and Calendar move with it.
 * - Each row's checklist (decision 10) opens from the end of its rule line (RoutineChecklist).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useNavigate } from 'react-router';

import {
  planStatusOf,
  useCreateRoutine,
  useCreateRoutineChecklistItem,
  useDeleteRoutine,
  useDeleteRoutineChecklistItem,
  usePlan,
  useUpdateRoutine,
  useUpdateRoutineChecklistItem,
} from '../../api';
import type { PlanOut, ProjectOut } from '../../api';
import { paths } from '../../app/screens';
import { useScreenRoute } from '../../app/screenLocation';
import { AddButton, DomainDot, Eyebrow, TextLink, Toast, useToast } from '../../components';
import { useArrival, useIsActiveScreen } from '../../lib/arrival';
import { isReducedMotion } from '../../lib/reducedMotion';
import { useTimers } from '../../lib/timers';
import { hoverHandlers, ROTATION_KEY } from '../../stores/hover';
import { COPY, pcNote, pcRoutines, trackModel } from './model';
import type { TrackModel } from './model';
import { RoutineRow } from './RoutineRow';
import type { RoutineActions, RoutinePatch } from './RoutineRow';
import s from './Routines.module.css';
import { RotationLegend, RotationTrack } from './RotationTrack';
import { scrollToOffset } from './scroll';

const FLASH_ADD_MS = 1200;
const FLASH_LINK_MS = 1600;
const FOCUS_DELAY_MS = 30;

/** `?focus=` values that mean the Fixed Income rotation rather than a routine row. */
const ROTATION_IDS = new Set(['rot', 'rotation']);

const delay = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

function Header() {
  return (
    <div className={s.arrive} style={delay(0)}>
      <Eyebrow>{COPY.eyebrow}</Eyebrow>
      <h1 className={s.title} tabIndex={-1}>
        {COPY.title}
      </h1>
    </div>
  );
}

export default function RoutinesScreen() {
  const plan = usePlan();
  if (plan.data) return <RoutinesView plan={plan.data} />;
  const status = planStatusOf(plan);
  return (
    <div className={s.page} aria-busy={status === 'loading' ? true : undefined}>
      <Header />
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

function RoutinesView({ plan }: { plan: PlanOut }) {
  const navigate = useNavigate();
  const route = useScreenRoute();
  const isActive = useIsActiveScreen();
  const arrival = useArrival(isActive);
  const { message: toastMessage, show: showToast } = useToast();
  const timers = useTimers<'fresh' | 'focus'>();
  const [fresh, setFresh] = useState<string | null>(null);
  const pcRef = useRef<HTMLDivElement>(null);
  const fiRef = useRef<HTMLDivElement>(null);
  const handledKey = useRef<string | null>(null);

  const createRoutine = useCreateRoutine();
  const { mutateAsync: updateRoutine } = useUpdateRoutine();
  const { mutateAsync: deleteRoutine } = useDeleteRoutine();
  const { mutateAsync: createItem } = useCreateRoutineChecklistItem();
  const { mutateAsync: updateItem } = useUpdateRoutineChecklistItem();
  const { mutateAsync: deleteItem } = useDeleteRoutineChecklistItem();

  const routines = useMemo(() => pcRoutines(plan), [plan]);
  const projects = useMemo(() => new Map<string, ProjectOut>(plan.projects.map((p) => [p.id, p])), [plan.projects]);
  const track = useMemo(() => trackModel(plan.rotation), [plan.rotation]);
  const capacity = plan.settings.capacityHoursPerDay;

  const flash = useCallback(
    (id: string, ms: number) => {
      setFresh(id);
      timers.set('fresh', ms, () => {
        setFresh(null);
      });
    },
    [timers],
  );

  // Deep links: ?focus=<id> flashes and scrolls to a row; ?focus=rot or #rotation to the track.
  const focus = route.searchParams.get('focus') ?? route.searchParams.get('routine');
  const toRotation = route.hash === '#rotation' || (focus !== null && ROTATION_IDS.has(focus));
  useLayoutEffect(() => {
    if (!isActive || !route.key || handledKey.current === route.key) return;
    if (!focus && !toRotation) return;
    handledKey.current = route.key;
    const reduced = isReducedMotion();
    if (toRotation) {
      if (fiRef.current) scrollToOffset(fiRef.current, reduced);
      return;
    }
    if (!focus) return;
    const row = pcRef.current?.querySelector<HTMLElement>(`[data-rid="${CSS.escape(focus)}"]`);
    if (!row) return;
    flash(focus, FLASH_LINK_MS);
    scrollToOffset(row, reduced);
  }, [isActive, route.key, focus, toRotation, flash]);

  // Once handled, drop the one-shot parameter so a reload or Back does not replay it.
  useEffect(() => {
    if (!isActive || handledKey.current !== route.key) return;
    if (!route.searchParams.has('focus') && !route.searchParams.has('routine')) return;
    void navigate(`${paths.routines()}${route.hash}`, { replace: true, preventScrollReset: true });
  }, [isActive, route, navigate]);

  /** Shows the toast and keeps the promise rejected, so the field that saved reverts. */
  const failed = useCallback(
    (error: unknown): Promise<never> => {
      showToast(COPY.saveFailed);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    },
    [showToast],
  );

  const actions = useMemo<RoutineActions>(
    () => ({
      update: (routineId: string, patch: RoutinePatch) => updateRoutine({ routineId, patch }).catch(failed),
      remove: (routineId: string) => {
        deleteRoutine({ routineId }).catch(() => {
          showToast(COPY.saveFailed);
        });
      },
      openProject: (projectId: string) => {
        void navigate(paths.project(projectId));
      },
      addItem: (routineId: string, label: string) => createItem({ routineId, label }).catch(failed),
      renameItem: (itemId: string, label: string) => updateItem({ itemId, label }).catch(failed),
      removeItem: (itemId: string) => deleteItem({ itemId }).catch(failed),
    }),
    [updateRoutine, deleteRoutine, createItem, updateItem, deleteItem, navigate, failed, showToast],
  );

  const add = () => {
    createRoutine
      .mutateAsync({ domain: 'pc' })
      .then((out) => {
        const id = out.entity.id;
        flash(id, FLASH_ADD_MS);
        timers.set('focus', FOCUS_DELAY_MS, () => {
          pcRef.current?.querySelector<HTMLElement>(`[data-fk="name.${CSS.escape(id)}"]`)?.focus();
        });
      })
      .catch(() => {
        showToast(COPY.saveFailed);
      });
  };

  return (
    <div className={s.page} {...arrival.attrs}>
      <Header />

      <div ref={pcRef} className={s.arrive} style={delay(1)}>
        <div className={s.sectionHead}>
          <DomainDot color="pc" />
          <h2 className={s.sectionTitle}>Private Credit</h2>
          {routines.length > 0 && <span className={s.sectionNote}>{pcNote(routines)}</span>}
          <span className={s.spacer} />
          <AddButton size="bordered" onClick={add} disabled={createRoutine.isPending}>
            {COPY.add}
          </AddButton>
        </div>
        <div className={s.columns} aria-hidden="true">
          <span>Routine · rule</span>
          <span>Effort</span>
          <span>Next three</span>
          <span>Handover</span>
        </div>
        {routines.map((r) => (
          <RoutineRow
            key={r.id}
            routine={r}
            project={r.projectId ? (projects.get(r.projectId) ?? null) : null}
            capacity={capacity}
            fresh={fresh === r.id}
            actions={actions}
          />
        ))}
        {routines.length === 0 && <div className={s.pcEmpty}>{plan.routines.length === 0 ? COPY.noneYet : COPY.pcEmpty}</div>}
      </div>

      <FixedIncome
        track={track}
        fiRef={fiRef}
        onSetUp={() => {
          void navigate(paths.settings('rotation'));
        }}
      />

      <div className={s.toastLayer}>
        <Toast message={toastMessage} />
      </div>
    </div>
  );
}

function FixedIncome({
  track,
  fiRef,
  onSetUp,
}: {
  track: TrackModel | null;
  fiRef: RefObject<HTMLDivElement | null>;
  onSetUp: () => void;
}) {
  return (
    <div ref={fiRef} id="rotation" className={s.arrive} style={delay(2)} {...hoverHandlers(ROTATION_KEY)}>
      <div className={s.sectionHead}>
        <DomainDot color="fi" />
        <h2 className={s.sectionTitle}>Fixed Income</h2>
        {track && <span className={s.sectionNote}>{track.subtitle}</span>}
      </div>
      {track ? (
        <>
          <RotationTrack track={track} />
          <RotationLegend />
        </>
      ) : (
        <div className={s.fiEmpty}>
          <span>{COPY.noRotation}</span>
          <TextLink onClick={onSetUp}>{COPY.setUpRotation}</TextLink>
        </div>
      )}
    </div>
  );
}
