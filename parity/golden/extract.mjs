#!/usr/bin/env node
// Golden-value extractor: runs the prototype's own logic in Node and dumps what it computes.
//
//   node golden/extract.mjs          write parity/golden/*.json
//   node golden/extract.mjs --check  fail (exit 1) if any golden file would change
//
// Method (docs/design-spec/arch-delivery-parity.md section 5): each .dc.html file's
// <script data-dc-script> is evaluated with new Function(), exactly like support.js does, but
// with Node stubs: a synchronous DCLogic, React.createRef, an empty localStorage (so the
// sample seed is used), no window/document, a pinned Date (2026-10-05T09:30 Europe/London),
// a seeded Math.random and inert timers. No dependencies, no network, read-only on the design.
//
// Day numbers (the prototype's days-since-epoch) are converted to ISO dates everywhere.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAUDE_FIXTURE_REPLY } from './claude-fixture.mjs';
import { SIMPLE_READER_CORPUS } from './corpus.mjs';
import { goldenFromModel, MODEL_GOLDEN_FILES, PREVIEW_HOURS } from './model-golden.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(HERE, '../../Remi Dashboard Design Review');
// The golden JSON lives with the backend tests that use it; the sample seed ships in the package.
const OUT_DIR = path.resolve(HERE, '../../backend/remi/tests/golden');
const SEED_FILE = path.resolve(HERE, '../../backend/remi/fixtures/prototype_seed.json');
const CHECK = process.argv.includes('--check');

export const FIXED_NOW_ISO = '2026-10-05T09:30:00+01:00';
const FIXED_NOW = Date.parse(FIXED_NOW_ISO);
const SHELL_PROPS = { frame: '1920 × 1080', motion: 'Reduced', accents: ['#526e2a', '#47619c'], serif: true };

// ------------------------------------------------------------------ sandbox
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() {
    return FIXED_NOW;
  }
}

function seededMath(seed) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(Object.create(Math), { random });
}

/** Synchronous stand-in for support.js's StreamableLogic (setState merges, then calls back). */
class DCLogicStub {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(update, cb) {
    const patch = typeof update === 'function' ? update(this.state, this.props) : update;
    if (patch) this.state = { ...this.state, ...patch };
    if (cb) cb();
  }
  forceUpdate() {}
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() {
    return {};
  }
}

// React.Component: the redesign's header adds `class LondonClock extends React.Component`.
const ReactStub = { createRef: () => ({ current: null }), Component: class {} };
const emptyStorage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
// Timers never fire: flash/moved/save timeouts are UI-only and would keep Node alive.
let timerId = 0;
const inertTimer = () => ++timerId;
const noop = () => {};

const readDesign = (file) => fs.readFileSync(path.join(DESIGN_DIR, file), 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function scriptOf(file) {
  const html = readDesign(file);
  const m = html.match(/<script\b[^>]*\bdata-dc-script\b[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${file}: no <script data-dc-script> block`);
  return m[1];
}

/** Evaluate a design component's logic script and return the named top-level bindings. */
function evalDC(file, names, seed = 1) {
  const params = [
    'DCLogic', 'StreamableLogic', 'React', 'localStorage', 'window', 'document', 'Date', 'Math',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  ];
  const ret = '\n;return {' + names.map((n) => `${JSON.stringify(n)}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ') + '};';
  const fn = new Function(...params, scriptOf(file) + ret);
  return fn(DCLogicStub, DCLogicStub, ReactStub, emptyStorage(), undefined, undefined, PinnedDate, seededMath(seed),
    inertTimer, noop, inertTimer, noop, noop);
}

// ------------------------------------------------------------------ load the prototype
const shell = evalDC('Remi.dc.html', [
  'Component', 'CAL', 'F', 'HOL', 'TODAY', 'MOVE', 'DEC_RUN', 'CAL0', 'CAL1', 'CAPACITY', 'ROT', 'ROT_DEF',
  'ROUTINES', 'BASE_PROJECTS', 'BASE_FEED', 'BASE_NOTES', 'BASE_DONE_ON', 'FUNDS', 'PHASES', 'STAGES', 'SCREENS',
  'STORE', 'MAN0', 'normalize', 'normR', 'derivedMs', 'occurs', 'dayLoad',
]);
const TodayDC = evalDC('Today.dc.html', ['Component']).Component;
const TransitionDC = evalDC('Transition.dc.html', ['Component']).Component;
const WorkspaceDC = evalDC('Workspace.dc.html', ['Component']).Component;
const CheckInDC = evalDC('CheckIn.dc.html', ['Component']).Component;
const NotesDC = evalDC('Notes.dc.html', ['Component']).Component;
const textbook = evalDC('Remi Textbook.dc.html', ['SEED', 'SAMPLE_CHART', 'SEC_DEF', 'STORE'], 11);

const { CAL, F } = shell;
const iso = (n) => (n == null ? null : F.iso(n));
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// The seed must be captured before anything runs against the shell.
const seedProjects = plain(shell.BASE_PROJECTS);
const newShell = () => new shell.Component(SHELL_PROPS);
const app = newShell();
const model = app.buildModel();
const modelGolden = goldenFromModel(model);

// ------------------------------------------------------------------ screen-level goldens
function todayVals(n, extraState = {}) {
  const t = new TodayDC({ model });
  t.state = { ...t.state, arrived: true, sel: n === model.TODAY ? null : n, ...extraState };
  return t.renderVals();
}

function dayPlan(n) {
  const v = todayVals(n);
  return {
    iso: iso(n),
    day: pick(v.day, ['kicker', 'ahead', 'title', 'bdLine', 'capTitle', 'planTitle', 'planNote']),
    load: v.L,
    capLabel: v.capLabel,
    overMarker: v.capMarkO === 1,
    returnsChecklist: { shown: v.bau.show, note: v.bau.note, fundsDone: Number(v.fundsDone) },
    blocks: v.blocks.map((b) => ({
      id: b.id,
      name: b.name,
      hours: b.hours,
      domainName: b.domainName,
      tasks: b.tasks.map((t) => ({ id: t.id, t: t.t, h: t.h, hl: t.hl, done: t.ck === 1 })),
      noTasks: b.noTasks,
      milestone: b.ms,
    })),
    otherBau: v.otherBau.map((x) => pick(x, ['hours', 'name', 'rule', 'domainName'])),
    noBau: v.noBau,
    week: {
      title: v.wk.title,
      sub: v.wk.sub,
      days: v.week.map((w) => ({
        iso: iso(w.n),
        label: w.label,
        bd: w.bd,
        selected: w.fw === 700,
        loadLabel: w.loadLabel,
        chips: w.chips.map((c) => c.label),
        items: w.items.map((i) => ({ name: i.name, h: i.h })),
        more: w.more,
      })),
    },
  };
}

function monthSnapshot(expanded) {
  const v = todayVals(model.TODAY, expanded ? { openG: { bau: true, proj: true } } : {});
  const mo = v.mo;
  return {
    title: mo.title,
    doneN: Number(mo.doneN),
    total: Number(mo.total),
    late: mo.late,
    headline: mo.doneN + ' of ' + mo.total + ' done' + (mo.late ? ' · ' + mo.late : ''),
    from: mo.from,
    to: mo.to,
    groups: mo.groups.map((g) => ({
      label: g.label,
      count: g.count,
      pct: g.pct,
      items: g.items.map((x) => ({ text: x.text, sub: x.sub, due: x.due, done: x.ck === 1 })),
      empty: g.empty,
      more: g.more,
    })),
    bars: mo.bars.map((b) => pick(b, ['title', 'plan', 'doneH', 'lateH', 'today'])),
  };
}

function todayExtras() {
  const v = todayVals(model.TODAY);
  return {
    attention: v.attention.map((a) => ({ ...pick(a, ['kind', 'title', 'body', 'chip', 'tone', 'actLabel', 'pid']), day: a.day != null ? iso(a.day) : undefined, id: a.day != null ? 'o-' + iso(a.day) : a.id })),
    attnCount: Number(v.attnCount),
    prompt: v.prompt ? pick(v.prompt, ['id', 'name', 'sinceLabel', 'text']) : null,
    noPrompt: v.noPrompt,
    feed: v.feed.map((f) => pick(f, ['id', 'pid', 'kind', 'title', 'body', 'delta', 'tone', 'when', 'day'])),
    funds: v.funds.map((f) => ({ name: f.name, done: f.ck === 1 })),
    fundsDone: Number(v.fundsDone),
  };
}

function transitionGolden() {
  const t = new TransitionDC({ model });
  const v = t.renderVals();
  return {
    verdict: pick(v.v, ['word', 'short', 'sentence', 'buffer', 'toRun']),
    businessDaysStrictlyBetween: v.ticks.length,
    flags: v.flags.map((f) => pick(f, ['x', 'label'])),
    monthMarks: v.monthMarks,
    routes: v.routes.map((r) => ({ label: r.label, count: r.count, empty: r.empty, rows: r.rows.map((x) => pick(x, ['name', 'ready', 'f', 'chip'])) })),
    routines: v.routines,
    onboarding: { count: v.onb.count, note: v.onb.note, items: v.onb.items.map((x) => pick(x, ['t', 'due'])) },
    firstRot: v.firstRot.map((x) => pick(x, ['code', 'pass', 'country', 'dates'])),
    loopEnd: v.loopEnd,
    alpha: pick(v.alpha, ['name', 'note', 'target']),
  };
}

function workspaceComponent(pid, updateProject) {
  const m = { ...model, ws: pid, updateProject: updateProject || noop, logChange: noop };
  return new WorkspaceDC({ model: m });
}

function workspacePanel(pid) {
  const v = workspaceComponent(pid).renderVals();
  const cp = v.cp;
  return {
    id: pid,
    header: pick(v.hdr, ['f', 'delta', 'confL']),
    fLabel: v.fLabel,
    start: pick(cp.start, ['roll', 'iso', 'sub']),
    target: pick(cp.target, ['roll', 'iso', 'sub']),
    forecastSub: cp.fSub,
    rate: { v: cp.rate.f.v, sub: cp.rate.sub },
    workLeft: { v: cp.left.f.v, sub: cp.left.sub },
    need: pick(cp.need, ['v', 'unit', 'sub']),
    progress: cp.prog,
    sentence: cp.say.text,
    planNote: v.planNote,
    scope: { growth: v.scope.growth, empty: v.scope.empty, items: v.scope.items },
  };
}

/** The Workspace's own refit (rate and work-left edits), captured through its commit path. */
function workspaceRefit(pid, key, value) {
  const raw = app.state.projects.find((p) => p.id === pid);
  let result = null;
  const w = workspaceComponent(pid, (id, fn) => {
    result = fn(raw);
  });
  w.state = { ...w.state, drafts: { [key]: String(value) } };
  const v = w.renderVals();
  const fld = key === 'rate' ? v.cp.rate.f : v.cp.left.f;
  fld.blur();
  return result ? pick(result, ['rate', 'bd3', 'bd8', 'rateAfter', 'ov', 'forecast', 'prev']) : null;
}

function workspaceRefits() {
  const out = {};
  model.P.filter((p) => p.forecastN != null).forEach((p) => {
    const left = Number(workspaceComponent(p.id).renderVals().cp.left.f.v);
    out[p.id] = {
      rate: p.rate,
      workLeft: left,
      forecast: p.forecast,
      rateEdits: [0.5, 1, 1.5, 2, 3, 4, 6, 8].map((r) => ({ rate: r, result: workspaceRefit(p.id, 'rate', r) })),
      workLeftEdits: [0, left - 6, left + 6, left + 16].filter((h) => h >= 0).map((h) => ({ workLeft: h, result: workspaceRefit(p.id, 'left', h) })),
    };
  });
  return out;
}

function simpleReading(entry) {
  const c = new CheckInDC({ model, pid: entry.focus, open: false, session: 0, prefill: null });
  c.state = { ...c.state, focus: entry.focus };
  return c.simple(entry.text);
}

function notesTags(text) {
  const n = new NotesDC({ model });
  return n.tagsFor(text).map((t) => t.id);
}

// ------------------------------------------------------------------ scenario goldens
function scenarioSummary(c) {
  const g = goldenFromModel(c.buildModel());
  const s = c.state;
  return {
    projects: g.projects.map((p) => ({
      ...pick(p, ['id', 'forecast', 'prev', 'target', 'delta', 'deltaLabel', 'status', 'rate', 'bd3', 'bd8', 'rateAfter', 'confidence', 'checkin', 'since', 'stale', 'added', 'growth', 'blocker']),
      lastScope: p.scope.length ? p.scope[p.scope.length - 1] : null,
      lastCheckin: p.checkins.length ? p.checkins[p.checkins.length - 1] : null,
      nowTasks: p.now.flatMap((x) => x.tasks.map((t) => t.id)),
    })),
    verdict: pick(g.verdict, ['word', 'buffer', 'toRun']),
    upcoming: g.attention.upcoming,
    attention: g.attention.attention.map((a) => a.id),
    feedHead: s.feed.slice(0, 2),
    tasks: s.tasks,
    doneOn: s.doneOn,
    bauDone: s.bauDone,
    fundsDone: s.funds.filter(Boolean).length,
    flash: s.flash,
    moved: s.moved,
  };
}

const SCENARIOS = [
  {
    id: 'checkin-ret-scope-6h',
    about: 'applyCheckIn with 6h of new scope on the returns pipeline (prototype ceil(h/rate) slip)',
    steps: [(c) => c.applyCheckIn({ pid: 'ret', scopeH: 6, scopeWhat: 'FX attribution', changed: '', blockers: '', confidence: null, done: [] })],
  },
  {
    id: 'palette-6h-returns-apply',
    about: 'Palette "+6h returns" prefill, read by the simple reader with focus ret, then applied',
    steps: [
      (c) => {
        const text = 'New scope on Returns pipeline, about 6h: FX attribution';
        const ci = new CheckInDC({ model: c.buildModel(), pid: 'ret', open: false, session: 0, prefill: null });
        ci.state = { ...ci.state, focus: 'ret' };
        c.applyUpdate(ci.simple(text).changes);
      },
    ],
  },
  {
    id: 'update-manco-2h-a-day',
    about: 'hours_per_day change: the prototype refits with bdDiff+1 (applyUpdate)',
    steps: [(c) => c.applyUpdate([{ type: 'hours_per_day', project_id: 'manco', value: 2 }])],
  },
  { id: 'toggle-task-ret-2', about: 'Tick a Now task on Today', steps: [(c) => c.toggleTask('ret-2')] },
  {
    id: 'routine-r-man-bd10',
    about: 'Move the ManCo pack routine from BD8 to BD10',
    steps: [(c) => c.updateRoutine('r-man', (r) => ({ ...r, bd: 10 }))],
  },
  {
    id: 'checkin-manco-scope-40h',
    about: '40h of new ManCo scope pushes a PC exit past the move (Off track)',
    steps: [(c) => c.applyCheckIn({ pid: 'manco', scopeH: 40, scopeWhat: 'Board pack', changed: '', blockers: '', confidence: null, done: [] })],
  },
  {
    id: 'bau-done-returns',
    about: 'bau_done for r-ret on its occurrence day ticks all 12 funds (setAllFunds)',
    steps: [(c) => c.applyUpdate([{ type: 'bau_done', routine_id: 'r-ret' }])],
  },
  {
    id: 'claude-fixture-apply',
    about: 'Apply every change in golden/claude-fixture.mjs (the drawer-review-claude state)',
    steps: [
      (c) => {
        const ci = new CheckInDC({ model: c.buildModel(), pid: null, open: false, session: 0, prefill: null });
        c.applyUpdate(ci.validate(CLAUDE_FIXTURE_REPLY).changes);
      },
    ],
  },
];

function runScenario(sc) {
  const c = newShell();
  const out = { id: sc.id, about: sc.about, before: scenarioSummary(c), after: [] };
  sc.steps.forEach((step) => {
    step(c);
    out.after.push(scenarioSummary(c));
  });
  return out;
}

// ------------------------------------------------------------------ seed
function extractLiteral(file, re, what) {
  const m = scriptOf(file).match(re);
  if (!m) throw new Error(`${file}: could not find ${what}`);
  return new Function(`return (${m[1]});`)();
}

function textbookSeed() {
  const seed = textbook.SEED();
  const pages = seed.pages.map((p) => ({
    ...p,
    updated: new RealDate(p.updated).toISOString(),
    blocks: p.blocks.map((b, i) => ({ ...b, id: `${p.id}-b${String(i + 1).padStart(2, '0')}` })),
  }));
  const chartFile = 'charts/price-yield.html';
  const fileHtml = readDesign(chartFile);
  return {
    store: textbook.STORE,
    cur: seed.cur,
    sections: textbook.SEC_DEF(),
    pages,
    sampleChart: {
      src: chartFile,
      name: 'price-yield.html',
      html: textbook.SAMPLE_CHART,
      matchesDesignFile: fileHtml === textbook.SAMPLE_CHART,
      designFileSha256: sha256(fileHtml),
    },
  };
}

function prototypeSeed() {
  const notesAliases = extractLiteral('Notes.dc.html', /const alias = (\{[\s\S]*?\});/, 'Notes alias map');
  const simpleKeys = extractLiteral('CheckIn.dc.html', /const keys = (\{[\s\S]*?\});/, 'simple-reader keys');
  const notesSrc = scriptOf('Notes.dc.html');
  const routineAliases = {};
  for (const m of notesSrc.matchAll(/r\.id === '([\w-]+)' \? (\[[^\]]*\])/g)) routineAliases[m[1]] = new Function(`return ${m[2]};`)();
  const bau = scriptOf('CheckIn.dc.html').match(/if \(\/(.+?)\/\.test\(l\)\) \{ changes\.push\(\{ type: 'bau_done', routine_id: '([\w-]+)' \}\)/);
  return {
    about: 'Prototype sample data (Remi.dc.html BASE_* constants), for test fixtures only (ADR-0006).',
    today: iso(shell.TODAY),
    move: iso(shell.MOVE),
    decRun: iso(shell.DEC_RUN),
    capacity: shell.CAPACITY,
    calendarRange: { from: iso(shell.CAL0), to: iso(shell.CAL1) },
    holidays: shell.HOL,
    phases: shell.PHASES,
    stages: shell.STAGES,
    projects: seedProjects,
    routines: plain(shell.ROUTINES),
    funds: shell.FUNDS,
    fundsDone: shell.FUNDS.map((f, i) => i < 5),
    tasks: plain(app.state.tasks),
    doneOn: plain(shell.BASE_DONE_ON),
    bauDone: {},
    notes: plain(shell.BASE_NOTES),
    // Only the non-computed feed rows. 'stale' and 'overload' are computed flags
    // (arch-backend-data §8, synthesis.json), so the fixture must not store them;
    // they are kept below for reference only.
    feed: plain(shell.BASE_FEED).filter((f) => f.kind !== 'stale' && f.kind !== 'overload'),
    computedFeedReference: plain(shell.BASE_FEED).filter((f) => f.kind === 'stale' || f.kind === 'overload'),
    rotation: shell.ROT_DEF.map(([country, code, len, pass]) => ({ country, code, len, pass })),
    aliases: {
      notesProjects: notesAliases,
      notesRoutines: routineAliases,
      simpleReaderProjects: simpleKeys,
      simpleReaderBauDone: bau ? { routineId: bau[2], pattern: bau[1] } : null,
    },
    textbook: textbookSeed(),
  };
}

// ------------------------------------------------------------------ write
const SOURCES = ['support.js', 'Remi.dc.html', 'Today.dc.html', 'Transition.dc.html', 'Workspace.dc.html', 'CheckIn.dc.html', 'Notes.dc.html', 'Remi Textbook.dc.html', 'charts/price-yield.html'];

const outputs = {};
Object.entries(MODEL_GOLDEN_FILES).forEach(([section, file]) => {
  outputs[file] = modelGolden[section];
});
outputs['today_day_plans.json'] = {
  about: 'Today.dc.html renderVals() for every business day from today to the end of the calendar (sel = that day).',
  today: iso(model.TODAY),
  todayExtras: todayExtras(),
  days: CAL.bds.filter((n) => n >= model.TODAY).map(dayPlan),
};
outputs['month_snapshot.json'] = { collapsed: monthSnapshot(false), expanded: monthSnapshot(true) };
outputs['transition.json'] = transitionGolden();
outputs['workspace_panels.json'] = model.P.map((p) => workspacePanel(p.id));
outputs['workspace_refit.json'] = {
  about: 'Workspace.dc.html refit() via its commit path: forecast after a rate edit or a work-left edit.',
  projects: workspaceRefits(),
};
outputs['simple_reader.json'] = {
  about: 'CheckIn.dc.html simple(text) (with validate()) over golden/corpus.mjs; focus = drawer focus project.',
  cases: SIMPLE_READER_CORPUS.map((e) => ({ ...e, result: simpleReading(e) })),
};
outputs['notes_tags.json'] = {
  about: 'Notes.dc.html tagsFor(text): project and routine ids tagged (substring matching, as the prototype does).',
  cases: [
    ...Object.entries(shell.BASE_NOTES).flatMap(([day, list]) => list.map((n) => ({ id: n.id, day, text: n.text }))),
    ...SIMPLE_READER_CORPUS.map((e) => ({ id: e.id, text: e.text })),
  ].map((c) => ({ ...c, tags: notesTags(c.text) })),
};
outputs['scenarios.json'] = { about: 'Scripted mutations on a fresh shell; model summary before and after each step.', scenarios: SCENARIOS.map(runScenario) };
outputs['prototype_seed.json'] = prototypeSeed();
outputs['meta.json'] = {
  about: 'Provenance of the golden files. Regenerate with `make goldens`.',
  generator: 'parity/golden/extract.mjs',
  fixedNow: FIXED_NOW_ISO,
  shellProps: SHELL_PROPS,
  previewHours: PREVIEW_HOURS,
  sources: Object.fromEntries(SOURCES.map((f) => [f, sha256(readDesign(f))])),
  files: Object.keys(outputs).sort(),
};

const stale = [];
let written = 0;
for (const [file, value] of Object.entries(outputs)) {
  const text = JSON.stringify(value, null, 2) + '\n';
  const target = file === 'prototype_seed.json' ? SEED_FILE : path.join(OUT_DIR, file);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === text) continue;
  if (CHECK) stale.push(file);
  else {
    fs.writeFileSync(target, text);
    written += 1;
  }
}

if (CHECK) {
  if (stale.length) {
    console.error(`goldens are stale: ${stale.join(', ')}\nrun: make goldens`);
    process.exit(1);
  }
  console.log(`goldens up to date (${Object.keys(outputs).length} files)`);
} else {
  const v = modelGolden.verdict;
  const total = Object.keys(outputs).length;
  console.log(`goldens: ${written} of ${total} files written (${total - written} unchanged) in ${path.relative(process.cwd(), OUT_DIR) || '.'}`);
  console.log(`  verdict: ${v.word} (buffer ${v.buffer}, toRun ${v.toRun}); overloads: ${modelGolden.attention.upcoming.map((u) => u.iso).join(', ')}`);
  console.log(`  month snapshot: ${outputs['month_snapshot.json'].collapsed.headline}`);
}
