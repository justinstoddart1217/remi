import { useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import {
  AddButton,
  anchorPicker,
  BauChip,
  BauTick,
  BdStepper,
  BusinessDayDatePicker,
  Button,
  CapacityBar,
  CapacityLegend,
  Checkbox,
  ConfidencePips,
  DeltaChip,
  EmptyState,
  Eyebrow,
  ErrorBoundary,
  HandoverStepper,
  IconButton,
  InlineField,
  InlineList,
  placeTooltip,
  ProgressRule,
  Roll,
  SectionTitleRow,
  SegmentedControl,
  SidePanel,
  TextLink,
  Toast,
  Tooltip,
  TwoStepConfirmButton,
  useToast,
  WeekdayPicker,
} from '../../components';
import type { InlineListItem, TooltipContent } from '../../components';
import { DECOR_HOURS, dayLoad, LOAD_MIXED, LOAD_OVER } from './data';
import { DEMO_TODAY, demoCalendar } from './demoCalendar';
import f from './Foundations.module.css';
import s from './LibrarySection.module.css';

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={f.specimen}>
      <div className={f.specimenTitle}>{title}</div>
      <div className={s.body}>{children}</div>
    </div>
  );
}

const ROLLS = [
  ['Fri 27 Nov', 'Wed 2 Dec', 'Mon 7 Dec', 'Not yet'],
  ['0 BD', '+3 BD', '−2 BD', '+12 BD'],
  ['2 of 17', '3.5', '17', '61'],
] as const;

const STAGES = ['Manual', 'Automating', 'Handing over', 'Handed over'] as const;

function RollDemo() {
  const [k, setK] = useState(0);
  return (
    <>
      <div className={s.rollRow}>
        {ROLLS.map((vals, i) => (
          <span key={i} className={s.rollValue}>
            <Roll value={vals[k % vals.length] ?? ''} />
          </span>
        ))}
      </div>
      <div className={s.row}>
        <Button
          variant="raised"
          size="s"
          onClick={() => {
            setK((x) => x + 1);
          }}
        >
          Next value
        </Button>
        <span className={s.note}>Same-family values roll per column; &lsquo;Not yet&rsquo; and &lsquo;2 of 17&rsquo; switch family and snap.</span>
      </div>
    </>
  );
}

function CheckboxDemo() {
  const [ticks, setTicks] = useState<Record<string, boolean>>({ a: true, b: false, c: true });
  const flip = (id: string) => (next: boolean) => {
    setTicks((t) => ({ ...t, [id]: next }));
  };
  return (
    <>
      <div className={s.row}>
        {([18, 16, 15] as const).map((size) => (
          <span key={size} className={s.row}>
            <Checkbox size={size} checked={false} aria-label={`${String(size)}px idle`} />
            <Checkbox size={size} checked aria-label={`${String(size)}px done`} />
            <span className={s.note}>{size}px</span>
          </span>
        ))}
      </div>
      <div className={s.checkRows}>
        <Checkbox checked={ticks.a ?? false} onChange={flip('a')} className={s.checkRow}>
          Allianz Credit Opportunities
        </Checkbox>
        <Checkbox checked={ticks.b ?? false} onChange={flip('b')} className={s.checkRow} trailing={<span className={s.hours}>0.75h</span>}>
          <span className={s.taskLabel}>Map the FX share classes</span>
        </Checkbox>
        <Checkbox size={16} pop={false} strike="faint" checked={ticks.c ?? false} onChange={flip('c')} className={s.checkRow}>
          Review row (no pop, ink-faint strike)
        </Checkbox>
      </div>
    </>
  );
}

function CapacityDemo() {
  const [over, setOver] = useState(false);
  const load = over ? LOAD_OVER : LOAD_MIXED;
  return (
    <>
      <div className={s.label}>panel · 12px</div>
      <CapacityBar variant="panel" load={load} pulseKey={over ? 'over' : 'mixed'} />
      <CapacityLegend bau={load.bau} proj={load.proj} free={load.free} className={s.legend} />
      <div className={s.label}>day · 14px, gliding between loads</div>
      <CapacityBar variant="day" load={load} pulseKey={over ? 'over' : 'mixed'} />
      <div className={s.row}>
        <Button
          variant="raised"
          size="s"
          onClick={() => {
            setOver((v) => !v);
          }}
        >
          {over ? 'Back to a normal day' : 'Overload the day'}
        </Button>
      </div>
      <div className={s.label}>cell · 5px and mini · 6px (cells)</div>
      <div className={s.cellRow}>
        <CapacityBar variant="cell" load={LOAD_MIXED} />
        <span className={s.cellLabel}>{LOAD_MIXED.total}h</span>
      </div>
      <div className={s.cellRow}>
        <CapacityBar variant="cell" load={LOAD_OVER} />
        <span className={s.cellLabel} style={{ color: 'var(--overload)' }}>
          {LOAD_OVER.total}h
        </span>
      </div>
      <div style={{ width: 200 }}>
        <CapacityBar variant="mini" load={LOAD_MIXED} />
      </div>
      <div className={s.label}>decor · Home</div>
      <div className={s.decor}>
        {DECOR_HOURS.map((h, i) => (
          <CapacityBar
            key={i}
            variant="decor"
            load={dayLoad([{ refType: 'project', refId: 'p', domain: i >= 25 ? 'fi' : 'pc', h, name: 'Plan' }])}
            delay={i * 12}
          />
        ))}
      </div>
    </>
  );
}

function ChipsDemo() {
  const [moved, setMoved] = useState(true);
  return (
    <>
      <div className={s.row}>
        <DeltaChip tone="risk" size="l" label="+3 BD" />
        <DeltaChip tone="risk" size="m" label="+3 BD" />
        <DeltaChip tone="neutral" size="m" label="On target" />
        <DeltaChip tone="neutral" size="m" label="no plan" />
        <DeltaChip tone="risk" size="s" weight={600} label="moved +3 BD" show={moved} />
        <Button
          variant="ghost"
          size="s"
          onClick={() => {
            setMoved((v) => !v);
          }}
        >
          {moved ? 'Fade chip' : 'Show chip'}
        </Button>
      </div>
      <div className={s.row}>
        <BauChip>Returns · 6h</BauChip>
        <BauChip domain="fi">Rotation · 4h</BauChip>
        <span style={{ width: 110 }}>
          <BauChip compact>ManCo pack build 2h</BauChip>
        </span>
        <BauChip plain accent="var(--pc-accent)">
          ◆ Pack signed off
        </BauChip>
      </div>
      <div className={s.row}>
        <BauTick width={96}>
          <span className={s.tickText}>Returns · 6h</span>
        </BauTick>
        <BauTick width={96} handedOver>
          <span className={s.tickText}>Handed over</span>
        </BauTick>
        <BauTick height={34} radius={1} handedOver />
        <BauTick height={34} radius={1} />
      </div>
      <div className={s.row}>
        <ConfidencePips value={4} />
        <ConfidencePips value={3} size="m" labelTone="ink" />
        <ConfidencePips value={null} />
      </div>
    </>
  );
}

function ControlsDemo() {
  const [zoom, setZoom] = useState<'2w' | '3m'>('3m');
  const [kind, setKind] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [size, setSize] = useState<'S' | 'M' | 'L'>('M');
  const [bd, setBd] = useState(3);
  const [wd, setWd] = useState(2);
  const [stage, setStage] = useState(1);
  return (
    <>
      <SegmentedControl
        label="Zoom"
        value={zoom}
        onChange={setZoom}
        options={[
          { value: '2w', label: '2 weeks' },
          { value: '3m', label: '3 months' },
        ]}
      />
      <div className={s.row}>
        <SegmentedControl
          variant="compact"
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'daily', label: 'Daily' },
          ]}
        />
        {kind === 'monthly' && <BdStepper value={bd} onChange={setBd} />}
        {kind === 'weekly' && <WeekdayPicker value={wd} onChange={setWd} />}
        <SegmentedControl
          variant="mini"
          label="Chart size"
          value={size}
          onChange={setSize}
          options={[
            { value: 'S', label: 'S' },
            { value: 'M', label: 'M' },
            { value: 'L', label: 'L' },
          ]}
        />
      </div>
      <HandoverStepper steps={STAGES} current={stage} onPick={setStage} />
      <div className={s.rules}>
        <ProgressRule value={7 / 12} label="Funds done" />
        <ProgressRule value={0.35} height={4} tone="fi" label="Readiness" />
        <div style={{ width: 56 }}>
          <ProgressRule value={0.5} tone="brand" />
        </div>
      </div>
    </>
  );
}

function TitlesDemo() {
  return (
    <div className={s.titles}>
      <SectionTitleRow title="Today’s plan" note="3 projects · 6h BAU" />
      <SectionTitleRow title="This week" note="Wk 41 · 5–9 Oct" noteStyle="numeric" />
      <SectionTitleRow variant="plain" title="Charter" />
      <div className={s.row}>
        <Eyebrow>Brand · default</Eyebrow>
        <Eyebrow tone="ink">Ink</Eyebrow>
        <Eyebrow tone="pc">Private Credit</Eyebrow>
        <Eyebrow tone="fi">Fixed Income</Eyebrow>
      </div>
      <div className={s.brandPanel}>
        <Eyebrow tone="mint" variant="mono">
          Monday · BD3
        </Eyebrow>
      </div>
    </div>
  );
}

function ButtonsDemo() {
  const [removed, setRemoved] = useState(0);
  return (
    <>
      <div className={s.row}>
        <Button icon="edit_note">Tell Remi</Button>
        <Button size="l" kbd="⌘↵">
          Send
        </Button>
        <Button variant="outline">Tell Remi</Button>
        <Button variant="raised" size="s">
          This week
        </Button>
        <Button variant="ghost" size="s">
          Replay
        </Button>
      </div>
      <div className={s.row}>
        <IconButton icon="chevron_left" label="Previous day" variant="raised" size={30} />
        <IconButton icon="chevron_right" label="Next day" variant="raised" size={30} />
        <IconButton icon="close" label="Close" />
        <TextLink>Via returns pipeline automation · 2 Dec</TextLink>
        <TextLink tone="muted">Routine</TextLink>
      </div>
      <div className={s.row}>
        <AddButton size="s">Add</AddButton>
        <AddButton>Add milestone</AddButton>
        <AddButton size="bordered">New project</AddButton>
      </div>
      <div className={s.row}>
        <TwoStepConfirmButton
          label="Remove project"
          armedLabel="Click again to remove Returns pipeline automation and its history"
          onConfirm={() => {
            setRemoved((n) => n + 1);
          }}
        />
        <TwoStepConfirmButton label="Remove" armedLabel="Click again to remove" tone="faint" size={12} onConfirm={() => undefined} />
        <TwoStepConfirmButton label="Delete" armedLabel="Click again to delete" variant="ghost" timeout={3500} onConfirm={() => undefined} />
        {removed > 0 && <span className={s.note}>Confirmed {removed}×</span>}
      </div>
    </>
  );
}

let nextId = 3;

/**
 * An onboarding row's note, derived from the tick it is drawn with (InlineListItem.meta as a
 * function), like Transition's `dueLabel(done, dueDate)`: 'done' when ticked, else the due date.
 */
const dueNote = (due: string) => (done: boolean) => (done ? 'done' : due);

/** The rows as displayed: a count that follows a tick at once. */
const readyNote = (shown: readonly InlineListItem[]) =>
  `${String(shown.filter((x) => x.done).length)} of ${String(shown.length)} ready`;

function FieldsDemo() {
  const [name, setName] = useState('Fund & security returns');
  const [hours, setHours] = useState(6);
  const [why, setWhy] = useState('The manual run takes six hours a month and has to leave with me.');
  const [constraints, setConstraints] = useState<InlineListItem[]>([]);
  const [success, setSuccess] = useState<InlineListItem[]>([
    { id: 's1', text: 'All 12 funds reconcile without a manual step' },
    { id: 's2', text: 'The successor runs a month alone' },
  ]);
  const [onboarding, setOnboarding] = useState<InlineListItem[]>([
    { id: 'o1', text: 'Bloomberg access', done: true, meta: dueNote('Mon 14 Dec') },
    { id: 'o2', text: 'Read the FI risk handbook', done: false, meta: dueNote('Fri 18 Dec') },
  ]);
  const listOps = (set: (fn: (items: InlineListItem[]) => InlineListItem[]) => void) => ({
    onAdd: (text: string) => {
      set((items) => [...items, { id: `n${String(nextId++)}`, text }]);
    },
    onChange: (id: string, text: string) => {
      set((items) => items.map((x) => (x.id === id ? { ...x, text } : x)));
    },
    onRemove: (id: string) => {
      set((items) => items.filter((x) => x.id !== id));
    },
  });
  const onboardingOps = {
    ...listOps(setOnboarding),
    // A new item has no due date yet: its note is blank until it is ticked.
    onAdd: (text: string) => {
      setOnboarding((items) => [...items, { id: `n${String(nextId++)}`, text, done: false, meta: dueNote('') }]);
    },
    onToggle: (id: string, done: boolean) => {
      setOnboarding((items) => items.map((x) => (x.id === id ? { ...x, done } : x)));
    },
  };
  return (
    <>
      <InlineField value={name} onCommit={setName} placeholder="Name this routine" aria-label="Routine name" className={s.nameField} />
      <span className={s.hoursField}>
        <InlineField
          numeric={{ max: 8 }}
          value={hours}
          onCommit={setHours}
          inputMode="decimal"
          aria-label="Hours per run"
          className={s.hoursInput}
          style={{ width: `calc(${String(Math.max(1, String(hours).length) * 0.62)}em + 8px)` }}
        />
        <span>h</span>
      </span>
      <div className={s.label}>Why now · multi (Enter inserts a newline)</div>
      <InlineField
        multi
        value={why}
        onCommit={setWhy}
        cpl={46}
        placeholder="Why does this matter now, rather than later?"
        aria-label="Why now"
        className={s.whyField}
      />
      <InlineList
        label="Success measures"
        numbered
        size="l"
        placeholder="A measurable outcome"
        emptyText="How will you know it worked?"
        items={success}
        className={s.stretch}
        {...listOps(setSuccess)}
      />
      <InlineList
        label="Constraints"
        placeholder="A limit to respect"
        emptyText="None noted yet."
        items={constraints}
        className={s.stretch}
        {...listOps(setConstraints)}
      />
      <InlineList
        label="Onboarding"
        placeholder="Something to be ready for day one"
        emptyText="No onboarding items yet."
        items={onboarding}
        className={s.stretch}
        {...onboardingOps}
      />
      {/* The same items as `row="line"` with a hover-only Add and a count (Transition). */}
      <InlineList
        row="line"
        addVisibility="hover"
        label="Onboarding readiness"
        labelTone="fi"
        labelAs="h3"
        headAside={(shown) => (shown.length > 0 ? <span className={s.lineCount}>{readyNote(shown)}</span> : null)}
        placeholder="Name an onboarding item"
        emptyText="No onboarding items yet."
        items={onboarding}
        className={s.stretch}
        {...onboardingOps}
      />
    </>
  );
}

function PickerDemo() {
  const [target, setTarget] = useState<string | null>('2026-12-18');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className={s.pickerRoot}>
      <button
        type="button"
        className={s.dateTrigger}
        onClick={(e) => {
          if (pos) {
            setPos(null);
            return;
          }
          if (root.current) setPos(anchorPicker(root.current, e.currentTarget));
        }}
      >
        Target · {target ?? 'Set date'}
      </button>
      {pos && (
        <BusinessDayDatePicker
          label="Target date"
          value={target}
          today={DEMO_TODAY}
          calendar={demoCalendar}
          x={pos.x}
          y={pos.y}
          onPick={setTarget}
          onClose={() => {
            setPos(null);
          }}
        />
      )}
    </div>
  );
}

const TIPS: readonly TooltipContent[] = [
  { key: 'd', title: 'Mon 5 Oct · BD3', chip: '8h of 8h', lines: ['Returns (BAU) · 6h', 'ManCo pack automation · 2h'] },
  { key: 'o', title: 'Wed 4 Nov · BD3', chip: 'Overload', chipColor: 'var(--overload)', lines: ['Returns (BAU) · 6h', 'Returns pipeline · 3.5h'] },
];

function OverlaysDemo() {
  const [panel, setPanel] = useState<string | null>(null);
  const [tip, setTip] = useState<TooltipContent | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const move = (e: MouseEvent) => {
    if (tipRef.current && frame.current) placeTooltip(tipRef.current, frame.current, e.clientX, e.clientY);
  };
  return (
    <div ref={frame} className={s.frame}>
      <div className={s.row}>
        <Button
          variant="raised"
          size="s"
          onClick={() => {
            setPanel((p) => (p ? null : 'Returns pipeline automation'));
          }}
        >
          {panel ? 'Close panel' : 'Open side panel'}
        </Button>
        <Button
          variant="raised"
          size="s"
          onClick={() => {
            toast.show('Returns-chart.html is live on this page.');
          }}
        >
          Show toast
        </Button>
      </div>
      <div className={s.hoverRow}>
        {TIPS.map((t) => (
          <div
            key={t.key}
            className={s.hoverTarget}
            onMouseEnter={(e) => {
              setTip(t);
              move(e);
            }}
            onMouseMove={move}
            onMouseLeave={() => {
              setTip(null);
            }}
          >
            Hover {t.title}
          </div>
        ))}
      </div>
      <Tooltip ref={tipRef} tip={tip} />
      <SidePanel item={panel} width={320} zIndex={12} label="Project details">
        {(name) => (
          <>
            <div className={s.row}>
              <span className={s.label}>Private Credit</span>
              <span style={{ flex: 1 }} />
              <IconButton
                icon="close"
                label="Close"
                onClick={() => {
                  setPanel(null);
                }}
              />
            </div>
            <div className={s.panelTitle}>{name}</div>
            <EmptyState>No milestones yet. They arrive once the charter is finished and the plan is drafted.</EmptyState>
          </>
        )}
      </SidePanel>
      <Toast message={toast.message} />
    </div>
  );
}

function Boom(): ReactNode {
  throw new Error('Specimen failure');
}

function StatesDemo() {
  const [broken, setBroken] = useState(false);
  return (
    <>
      <EmptyState>Nothing scheduled for the next two weeks yet.</EmptyState>
      <EmptyState variant="italic">Not written yet. What will you refuse to build?</EmptyState>
      <EmptyState variant="serif">A blank page. Jot anything: a number that looked off, who you are waiting on, what you finished.</EmptyState>
      <ErrorBoundary area="This specimen" resetKeys={[broken]}>
        {broken ? <Boom /> : null}
        <Button
          variant="outline"
          size="s"
          onClick={() => {
            setBroken(true);
          }}
        >
          Throw inside an ErrorBoundary
        </Button>
      </ErrorBoundary>
    </>
  );
}

/** 06 · Library: every component in the build and its states, beyond the prototype page. */
export function LibrarySection() {
  return (
    <section className={f.section}>
      <div className={f.sectionHead}>
        <span className={f.sectionNum}>06</span>
        <h2 className={f.sectionTitle}>Library</h2>
        <span className={f.sectionNote}>Every component in src/components, live, with its states.</span>
      </div>
      <SectionTitleRow title="Interactive specimens" note="Hover, click and type: these are the production components" />
      <div className={f.components}>
        <Specimen title="SectionTitleRow · accent · plain · Eyebrow">
          <TitlesDemo />
        </Specimen>
        <Specimen title="Roll">
          <RollDemo />
        </Specimen>
        <Specimen title="Checkbox · 18 · 16 · 15">
          <CheckboxDemo />
        </Specimen>
        <Specimen title="CapacityBar · panel · cell · mini · decor · CapacityLegend">
          <CapacityDemo />
        </Specimen>
        <Specimen title="DeltaChip · BauChip · BauTick · ConfidencePips">
          <ChipsDemo />
        </Specimen>
        <Specimen title="SegmentedControl · BdStepper · WeekdayPicker · HandoverStepper · ProgressRule">
          <ControlsDemo />
        </Specimen>
        <Specimen title="Button · IconButton · TextLink · AddButton · TwoStepConfirmButton">
          <ButtonsDemo />
        </Specimen>
        <Specimen title="InlineField · InlineList">
          <FieldsDemo />
        </Specimen>
        <Specimen title="BusinessDayDatePicker">
          <PickerDemo />
        </Specimen>
        <Specimen title="SidePanel · Tooltip · Toast">
          <OverlaysDemo />
        </Specimen>
        <Specimen title="EmptyState · ErrorBoundary">
          <StatesDemo />
        </Specimen>
      </div>
    </section>
  );
}
