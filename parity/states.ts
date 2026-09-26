// Every visual-parity state (docs/design-spec/arch-delivery-parity.md section 3), written only
// against the driver interfaces so the same list drives the prototype baselines now and the Remi
// comparisons later. Ids are file names: baselines/<app>/<id>.png and .json.
//
// Dates come from the prototype seed (today Mon 5 Oct 2026); golden/*.json confirms them:
//   2026-11-04  first model.upcoming overload day, and also BD3 of November (the same day)
//   2026-10-12  BD8 of October (ManCo pack run)
//   2027-01-04  the move: the first Fixed Income day (rotation BAU)

import { SCREENS, type ClaudeStub, type Drivers, type Screen } from './drivers/types.ts';
import { CLAUDE_FIXTURE_TEXT } from './golden/claude-fixture.mjs';

export type Surface = 'app' | 'home' | 'textbook' | 'foundations' | 'setup' | 'settings';

export interface ParityState {
  id: string;
  surface: Surface;
  about: string;
  /**
   * window.claude in the prototype; in Remi, the AI provider the state needs (remi/api.ts
   * useAiStub). Only states that set it touch Settings, which are global, so they run one after
   * another in one worker (specs/parity.spec.ts); every other state leaves Settings alone.
   * Set it on every state whose screen depends on the AI setting (the drawer, Notes).
   */
  claude?: ClaudeStub;
  /**
   * Capture the whole page, not just the 1920×1080 viewport. A Remi-only page taller than the
   * viewport must set it (specs/parity.spec.ts fails the state otherwise), so nothing below the
   * fold goes without a reference.
   */
  fullPage?: boolean;
  /** Tier B pixelmatch budget (maxDiffPixelRatio at threshold 0.1). */
  maxDiffRatio: number;
  /**
   * Exists only in Remi (approved baseline in baselines/remi-approved/, with its approval in
   * approvals.json; the prototype cannot produce it). These run against the `empty` fixture:
   * setup-wizard first, then the empty states and Settings after a minimal setup.
   */
  remiOnly?: boolean;
  run?: (d: Drivers) => Promise<void>;
}

/** The app screens with an empty state: all but the workspace, which needs a project to open. */
export const EMPTY_SCREENS = SCREENS.filter((s): s is Exclude<Screen, 'workspace'> => s !== 'workspace');

/** The surfaces outside the app that need a Remi-only state: the first run, Home, the Textbook and Settings. */
export const REMI_ONLY_SURFACES: readonly Surface[] = ['setup', 'home', 'textbook', 'settings'];

/** Tier B budgets: 1% for chrome, nav, Transition, Routines and overlays; 2% for dense screens. */
const CHROME = 0.01;
const DENSE = 0.02;

/** The drawer text reviewed by the simple reader (also golden/simple_reader.json "harness-review"). */
export const SIMPLE_REVIEW_TEXT = '+6h returns, blocked on data access';

export const STATES: ParityState[] = [
  // ---------------------------------------------------------------- Home
  { id: 'home', surface: 'home', about: 'Home launcher, arrived', maxDiffRatio: CHROME },
  {
    id: 'home-hover-plan',
    surface: 'home',
    about: 'Home, hovering the planning card (plan preview grows)',
    maxDiffRatio: CHROME,
    run: (d) => d.home.hoverCard('plan'),
  },
  {
    id: 'home-hover-textbook',
    surface: 'home',
    about: 'Home, hovering the Textbook card (typed heading and slash menu)',
    maxDiffRatio: CHROME,
    run: (d) => d.home.hoverCard('textbook'),
  },

  // ---------------------------------------------------------------- Today
  { id: 'today', surface: 'app', about: 'Today on Mon 5 Oct (BD3)', maxDiffRatio: DENSE },
  {
    id: 'today-preview-2026-11-04',
    surface: 'app',
    about: 'Today previewing Wed 4 Nov: the first upcoming overload day and BD3 of November',
    maxDiffRatio: DENSE,
    run: (d) => d.app.previewDay('2026-11-04'),
  },
  {
    id: 'today-preview-2026-10-12',
    surface: 'app',
    about: 'Today previewing Mon 12 Oct (BD8, ManCo pack run)',
    maxDiffRatio: DENSE,
    run: (d) => d.app.previewDay('2026-10-12'),
  },
  {
    id: 'today-preview-2027-01-04',
    surface: 'app',
    about: 'Today previewing Mon 4 Jan, the move (rotation BAU)',
    maxDiffRatio: DENSE,
    run: (d) => d.app.previewDay('2027-01-04'),
  },

  // ---------------------------------------------------------------- Notes
  {
    id: 'notes',
    surface: 'app',
    // The prototype's copy says notes go along with every Tell Remi update: true of its
    // window.claude reader. Remi says so only with an AI reader on and recent notes sent
    // (ADR-0004), which is what the `fixture` stand-in sets up.
    claude: 'fixture',
    about: 'Notes for today (with an AI reader that is sent recent notes)',
    maxDiffRatio: DENSE,
    run: (d) => d.app.setScreen('notes'),
  },

  // ---------------------------------------------------------------- Timeline
  { id: 'timeline', surface: 'app', about: 'Timeline, 3-month zoom', maxDiffRatio: DENSE, run: (d) => d.app.setScreen('timeline') },
  {
    id: 'timeline-tip-ret',
    surface: 'app',
    about: 'Timeline tooltip hovering the returns pipeline bar',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('timeline');
      await d.app.hoverTimelineProject('ret');
    },
  },
  {
    id: 'timeline-tip-rotation',
    surface: 'app',
    about: 'Timeline tooltip hovering the Eurozone rotation row',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('timeline');
      await d.app.hoverTimelineRotation();
    },
  },
  {
    id: 'timeline-panel-ret',
    surface: 'app',
    about: 'Timeline side panel for the returns pipeline',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('timeline');
      await d.app.openTimelinePanel('ret');
    },
  },

  // ---------------------------------------------------------------- Calendar
  { id: 'calendar', surface: 'app', about: 'Calendar, October 2026', maxDiffRatio: DENSE, run: (d) => d.app.setScreen('calendar') },
  {
    id: 'calendar-day-2026-10-05',
    surface: 'app',
    about: 'Calendar day panel for today',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('calendar');
      await d.app.openCalendarDay('2026-10-05');
    },
  },
  {
    id: 'calendar-day-2026-11-04',
    surface: 'app',
    about: 'Calendar day panel for the overload day (November)',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('calendar');
      await d.app.openCalendarDay('2026-11-04');
    },
  },

  // ---------------------------------------------------------------- Projects / Workspace
  { id: 'projects', surface: 'app', about: 'Projects (Roll cards)', maxDiffRatio: DENSE, run: (d) => d.app.setScreen('projects') },
  ...['ret', 'manco', 'play', 'fion', 'alpha'].map(
    (ws): ParityState => ({
      id: `workspace-${ws}`,
      surface: 'app',
      about: `Project workspace for ${ws}`,
      maxDiffRatio: DENSE,
      run: (d) => d.app.setScreen('workspace', { ws }),
    }),
  ),
  {
    id: 'workspace-ret-datepicker',
    surface: 'app',
    about: 'Returns pipeline workspace with the target date picker open',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.app.setScreen('workspace', { ws: 'ret' });
      await d.app.openDatePicker('target');
    },
  },

  // ---------------------------------------------------------------- Routines / Transition
  { id: 'routines', surface: 'app', about: 'Routines', maxDiffRatio: CHROME, run: (d) => d.app.setScreen('routines') },
  {
    id: 'routines-open-r-ret',
    surface: 'app',
    about: 'Routines after openRoutine(r-ret): the row highlight',
    maxDiffRatio: CHROME,
    run: (d) => d.app.openRoutine('r-ret'),
  },
  { id: 'transition', surface: 'app', about: 'Transition', maxDiffRatio: CHROME, run: (d) => d.app.setScreen('transition') },

  // ---------------------------------------------------------------- Check-in drawer
  {
    id: 'drawer-compose',
    surface: 'app',
    claude: 'none',
    about: 'Check-in drawer, compose, focused on ManCo',
    maxDiffRatio: CHROME,
    run: (d) => d.app.openCheckIn('manco'),
  },
  {
    id: 'drawer-review-simple',
    surface: 'app',
    claude: 'none',
    about: `Check-in review via the simple reading of "${SIMPLE_REVIEW_TEXT}" (no window.claude)`,
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openCheckIn(null);
      await d.app.typeCheckIn(SIMPLE_REVIEW_TEXT);
      await d.app.sendCheckIn();
    },
  },
  {
    id: 'drawer-review-claude',
    surface: 'app',
    claude: 'fixture',
    about: 'Check-in review from a stubbed window.claude reply (golden/claude-fixture.mjs)',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openCheckIn(null);
      await d.app.typeCheckIn(CLAUDE_FIXTURE_TEXT);
      await d.app.sendCheckIn();
    },
  },
  {
    id: 'drawer-thinking',
    surface: 'app',
    claude: 'pending',
    about: 'Check-in thinking phase (window.claude never answers)',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openCheckIn('ret');
      await d.app.typeCheckIn(CLAUDE_FIXTURE_TEXT);
      await d.app.sendCheckIn();
    },
  },
  {
    id: 'drawer-error',
    surface: 'app',
    claude: 'error',
    about: 'Check-in error phase (window.claude replies without a plan)',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openCheckIn('ret');
      await d.app.typeCheckIn(CLAUDE_FIXTURE_TEXT);
      await d.app.sendCheckIn();
    },
  },
  {
    id: 'drawer-review-offline',
    surface: 'app',
    claude: 'error',
    about: 'Check-in review via the error phase\'s "Use a simple reading" (offline())',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openCheckIn('ret');
      await d.app.typeCheckIn(CLAUDE_FIXTURE_TEXT);
      await d.app.sendCheckIn();
      await d.app.simpleReading();
    },
  },

  // ---------------------------------------------------------------- Palette
  { id: 'palette-empty', surface: 'app', about: '⌘K palette, empty query', maxDiffRatio: CHROME, run: (d) => d.app.openPalette() },
  {
    id: 'palette-quick-add',
    surface: 'app',
    about: '⌘K palette with "+6h returns" (quick add scope)',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openPalette();
      await d.app.typePalette('+6h returns');
    },
  },
  {
    id: 'palette-no-match',
    surface: 'app',
    about: '⌘K palette with a query that matches nothing',
    maxDiffRatio: CHROME,
    run: async (d) => {
      await d.app.openPalette();
      await d.app.typePalette('board minutes');
    },
  },

  // ---------------------------------------------------------------- Textbook
  { id: 'textbook-home', surface: 'textbook', about: 'Textbook home', maxDiffRatio: DENSE },
  {
    id: 'textbook-katex',
    surface: 'textbook',
    about: 'Textbook "Rates primer" page: KaTeX formulas and the live chart',
    maxDiffRatio: DENSE,
    run: (d) => d.textbook.openPage('fi-rates'),
  },
  {
    id: 'textbook-chart-full',
    surface: 'textbook',
    about: 'Textbook live chart full screen',
    maxDiffRatio: DENSE,
    run: async (d) => {
      await d.textbook.openPage('fi-rates');
      await d.textbook.fullscreenChart();
    },
  },

  // ---------------------------------------------------------------- Foundations (dev route)
  { id: 'foundations', surface: 'foundations', about: 'Design foundations (full page)', fullPage: true, maxDiffRatio: DENSE },

  // ---------------------------------------------------------------- Remi only
  // arch-delivery-parity §2-§3: the first run, and every screen's empty state, have an approved
  // baseline. The wizard runs on a fresh install; the rest after a minimal setup (nothing in the
  // plan, no Textbook pages). REMI_ONLY_SURFACES and EMPTY_SCREENS say what must be covered
  // (tests/states.test.ts). The wizard and Settings are taller than the viewport: full page.
  {
    id: 'setup-wizard',
    surface: 'setup',
    remiOnly: true,
    fullPage: true,
    about: 'First-run setup wizard, all four steps (Remi only)',
    maxDiffRatio: CHROME,
  },
  { id: 'empty-home', surface: 'home', remiOnly: true, about: 'Home with nothing in the plan and no Textbook pages (Remi only)', maxDiffRatio: CHROME },
  ...EMPTY_SCREENS.map(
    (screen): ParityState => ({
      id: `empty-${screen}`,
      surface: 'app',
      remiOnly: true,
      about: `Empty state for ${screen} (Remi only: setup done, no projects, routines or notes)`,
      maxDiffRatio: CHROME,
      run: screen === 'today' ? undefined : (d) => d.app.setScreen(screen),
    }),
  ),
  { id: 'empty-textbook', surface: 'textbook', remiOnly: true, about: 'Textbook with no pages (Remi only)', maxDiffRatio: CHROME },
  {
    id: 'settings',
    surface: 'settings',
    remiOnly: true,
    fullPage: true,
    about: 'Settings after a minimal setup, every section (Remi only)',
    maxDiffRatio: CHROME,
  },
];

export const PROTOTYPE_STATES = STATES.filter((s) => !s.remiOnly);

/** Boot the surface a state lives on. */
export async function bootState(d: Drivers, state: ParityState): Promise<void> {
  switch (state.surface) {
    case 'app':
      return d.app.boot({ claude: state.claude });
    case 'home':
      return d.home.boot();
    case 'textbook':
      return d.textbook.boot();
    case 'foundations':
      return d.foundations.boot();
    case 'setup':
      if (!d.setup) throw new Error(`${d.kind} has no setup surface (state ${state.id} is Remi only)`);
      return d.setup.boot();
    case 'settings':
      if (!d.settings) throw new Error(`${d.kind} has no settings surface (state ${state.id} is Remi only)`);
      return d.settings.boot();
  }
}

/** Boot, drive to the state, then wait for readiness. */
export async function reachState(d: Drivers, state: ParityState): Promise<void> {
  await bootState(d, state);
  if (state.run) await state.run(d);
  const surface = state.surface === 'app' ? d.app : state.surface === 'setup' ? d.setup : d[state.surface];
  await surface?.ready();
}
