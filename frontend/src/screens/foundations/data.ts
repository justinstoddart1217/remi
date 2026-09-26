/**
 * Static content for the Foundations style guide, copied from Remi Foundations.dc.html
 * (renderVals, lines 352-437). Dev-only sample data; nothing here reaches the app.
 */
import type { DayLoad, LoadItem } from '../../components';

export interface Swatch {
  name: string;
  value: string;
  v: string;
  role: string;
}

export interface ColourGroup {
  label: string;
  note: string;
  items: readonly Swatch[];
}

/*
 * The prototype's labels, verbatim: the redesign kept the v1 oklch text in `value` while each
 * swatch (`v`) renders the live token, now the Ninety One hex values of tokens.css.
 */
export const COLOUR_GROUPS: readonly ColourGroup[] = [
  {
    label: 'Paper and ink',
    note: 'Warm off-white paper, near-black ink. Saturation stays under 0.01.',
    items: [
      { name: '--paper', value: 'oklch(0.975 0.007 85)', v: 'var(--paper)', role: 'Page background' },
      { name: '--paper-raised', value: 'oklch(0.99 0.004 85)', v: 'var(--paper-raised)', role: 'Drawer preview, palette, inputs' },
      { name: '--ink', value: 'oklch(0.23 0.012 70)', v: 'var(--ink)', role: 'Text, primary buttons, today' },
      { name: '--ink-muted', value: 'oklch(0.47 0.012 70)', v: 'var(--ink-muted)', role: 'Secondary text · 6.3:1 on paper' },
      { name: '--ink-faint', value: 'oklch(0.58 0.01 75)', v: 'var(--ink-faint)', role: 'Idle checkboxes, separators · not for body text' },
      { name: '--hairline', value: 'oklch(0.9 0.008 80)', v: 'var(--hairline)', role: 'Rules and outlines' },
    ],
  },
  {
    label: 'Domains',
    note: 'One accent per domain; same lightness and chroma, different hue. Soft tints derive from the accent.',
    items: [
      { name: '--pc-accent', value: 'oklch(0.5 0.1 128)', v: 'var(--pc-accent)', role: 'Private Credit' },
      { name: '--pc-accent-soft', value: 'mix 13% into paper', v: 'var(--pc-accent-soft)', role: 'PC project fills, chips' },
      { name: '--fi-accent', value: 'oklch(0.5 0.1 265)', v: 'var(--fi-accent)', role: 'Fixed Income' },
      { name: '--fi-accent-soft', value: 'mix 13% into paper', v: 'var(--fi-accent-soft)', role: 'FI project fills, rotation' },
    ],
  },
  {
    label: 'Status',
    note: 'Used sparingly. Chip text mixes the status colour into ink so it holds 4.5:1.',
    items: [
      { name: '--risk', value: 'oklch(0.7 0.13 70)', v: 'var(--risk)', role: 'At risk: overrun past target, stale' },
      { name: '--overload', value: 'oklch(0.56 0.17 28)', v: 'var(--overload)', role: 'A day over 8h' },
      { name: '--done', value: 'oklch(0.74 0.008 85)', v: 'var(--done)', role: 'Done: quiet strike-through' },
      { name: '--focus', value: 'oklch(0.35 0.02 80)', v: 'var(--focus)', role: 'Focus border on inputs' },
    ],
  },
];

export interface TypeRow {
  spec: string;
  ff: string;
  fs: string;
  fw: number;
  lh: number;
  ls: string;
  tt: 'none' | 'uppercase';
  sample: string;
  use: string;
}

export const TYPE_SCALE: readonly TypeRow[] = [
  { spec: '52 / 1.1 · display', ff: 'var(--font-display)', fs: '52px', fw: 400, lh: 1.1, ls: '-0.015em', tt: 'none', sample: 'Monday 5 October', use: 'Day heading; workspace goal (48)' },
  { spec: '26 / 1.28 · display', ff: 'var(--font-display)', fs: '26px', fw: 400, lh: 1.28, ls: '-0.005em', tt: 'none', sample: 'The ManCo pack builds itself from source data.', use: 'Goal statements in lists and panels' },
  { spec: '20 / 1.3 · 600', ff: 'var(--font-ui)', fs: '20px', fw: 600, lh: 1.3, ls: '-0.01em', tt: 'none', sample: 'Today’s plan', use: 'Section titles, item titles (500)' },
  { spec: '15 / 1.5 · 400', ff: 'var(--font-ui)', fs: '15px', fw: 400, lh: 1.5, ls: '0', tt: 'none', sample: 'Every Private Credit exit lands before 4 Jan.', use: 'Body, list rows' },
  { spec: '13 / 1.45 · 400', ff: 'var(--font-ui)', fs: '13px', fw: 400, lh: 1.45, ls: '0', tt: 'none', sample: 'No check-in for 9 days.', use: 'Secondary text, legends' },
  { spec: '11 / 1.3 · 600 caps', ff: 'var(--font-ui)', fs: '11px', fw: 600, lh: 1.3, ls: '0.08em', tt: 'uppercase', sample: 'Private Credit · Projects', use: 'Quiet section labels' },
  { spec: '12 · numeric', ff: 'var(--font-numeric)', fs: '12px', fw: 400, lh: 1.4, ls: '0', tt: 'none', sample: 'BD3 · 6h · 27 Nov → 2 Dec', use: 'Dates, hours, business days' },
];

export const SPACES = [4, 8, 12, 16, 24, 32, 48, 64].map((v, i) => ({ name: `--space-${String(i + 1)}`, v: `${String(v)}px` }));

export const FRAME_SPECS: readonly (readonly [string, string])[] = [
  ['Frame', '1920 × 1080; checked at 2560 × 1440 (content widens, row heights hold)'],
  ['Rail · header', '88px rail, 72px persistent header'],
  ['Content', '48px margins, 12 columns, 24px gutters; 72px between major columns'],
  ['Rows', '40px list rows, 64px timeline project rows, hairline between'],
  ['Elevation', 'None, except drawer, palette and tooltip: one soft shadow each'],
];

export const MOTION_TOKENS = [
  { name: '--dur-fast', v: '140ms', note: 'Feedback: hover, press, tick fill, linked highlight.' },
  { name: '--dur-base', v: '240ms', note: 'Fades, cross-fades, segmented pills.' },
  { name: '--dur-slow', v: '440ms', note: 'Layout: glides, zoom, drawers. Nothing runs longer than 600ms.' },
  { name: '--ease-out', v: 'cubic-bezier(.23,1,.32,1)', note: 'Opacity and colour. Kept in reduced motion.' },
  {
    name: '--spring-soft',
    v: 'linear(…) no bounce',
    note: 'Critically damped spring. Motion: { type: "spring", bounce: 0, visualDuration: 0.35 } ≈ stiffness 180, damping 27.',
  },
] as const;

export const MOTION_SPEC = [
  { name: 'Plan moves', v: 'glide 440 spring · ghost 1000 hold + 400 fade · roll 440 spring · chip 180', note: 'Runs 220ms after the drawer closes so the eye is back on the plan. Only affected bars move.' },
  { name: 'Linked highlight', v: 'opacity 140 ease-out → 0.28', note: 'Hovering a project anywhere dims everything that is not it: bars, capacity segments, chips, feed.' },
  { name: 'Card → workspace', v: 'view transition 420 ease-out · root 220', note: 'The goal sentence is the shared element; it grows from 26px in the list to 48px in the header. Reduced motion: cross-fade.' },
  { name: 'Timeline zoom', v: 'every x and width 440 spring', note: 'Columns, bars, ticks and header labels re-lay out together; no cut. Pan by week in two-week view.' },
  { name: 'Capacity fill', v: 'width/height 440 spring · 90ms delay', note: 'Fills from empty on arrival. Overload pulses once (600ms ring, 450ms delay), then holds still.' },
  { name: 'Arrival', v: '140 ease-out per block · 40 stagger · 340 total', note: 'First load only. Screens stay mounted, so switching screens is a 240ms cross-fade, not a replay.' },
  { name: 'BAU tick', v: 'fill 140 · check 0.4 → 1, 180 cubic-bezier(.34,1.5,.64,1)', note: 'A small press-and-settle. Text drops to muted with a --done strike-through; progress count rolls.' },
  { name: 'Reduced motion', v: '--spring-soft → steps(1, jump-start)', note: 'Movement resolves instantly; opacity cross-fades remain. Mirrors prefers-reduced-motion and the Motion tweak.' },
] as const;

export const EMPTIES = [
  { where: 'Scope log', text: 'No scope added since the charter. The plan is still the one you wrote.' },
  { where: 'Check-in prompt', text: 'Every plan has had a check-in this week. Next due: FI onboarding, last checked 5 days ago.' },
  { where: 'Charter, in scope', text: 'Not written yet. What must v0 do on its first day?' },
  { where: 'Risks', text: 'No premortem yet. Picture January with this project abandoned, and write down the first reason that comes to mind.' },
] as const;

const bau = (h: number, refId = 'r-ret', name = 'Returns'): LoadItem => ({ refType: 'routine', refId, domain: 'pc', h, name });
const proj = (h: number, refId = 'ret', name = 'Returns pipeline'): LoadItem => ({ refType: 'project', refId, domain: 'pc', h, name });

/** Build a DayLoad the way the server does (capacity 8h). */
export function dayLoad(items: readonly LoadItem[], capacity = 8): DayLoad {
  const b = items.filter((i) => i.refType !== 'project').reduce((a, i) => a + i.h, 0);
  const p = items.filter((i) => i.refType === 'project').reduce((a, i) => a + i.h, 0);
  const total = b + p;
  return { items, bau: b, proj: p, total, free: Math.max(0, capacity - total), capacity, over: total > capacity };
}

/** CapacityBar · day: 6h BAU + 1h project + 1h free, and the 9.5h overload. */
export const LOAD_DEFAULT = dayLoad([bau(6), proj(1)]);
export const LOAD_OVER = dayLoad([bau(6), proj(3.5)]);
/** CapacityBar · mini: 6h BAU + 2h project = 8h of 8h. */
export const LOAD_FULL = dayLoad([bau(6), proj(2)]);
/** CapacityBar · strip sample days [bau, proj]. */
export const STRIP_LOADS = (
  [
    [6, 2],
    [0, 7],
    [0, 7],
    [4, 4],
    [6, 3.5],
    [4, 3],
  ] as const
).map(([b, p]) => dayLoad([bau(b), proj(p)]));
/** A mixed-domain day for the extra variants (panel, cell, decor). */
export const LOAD_MIXED = dayLoad([
  bau(2, 'r-man', 'ManCo'),
  { refType: 'rotation', refId: 'rot', domain: 'fi', h: 1.5, name: 'Rotation' },
  proj(2.5),
  { refType: 'project', refId: 'fion', domain: 'fi', h: 1, name: 'FI onboarding' },
]);
export const DECOR_HOURS = [8, 8, 7, 7, 7, 8, 7, 7, 7, 9.5, 7, 7, 8, 7, 6.5, 7, 7, 6, 5.5, 6, 5.5, 5.5, 3, 3, 3, 8, 7, 7, 7, 7];
