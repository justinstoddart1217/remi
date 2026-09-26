// Documented divergences between the prototype and Remi (ADR-0007's table, ADR-0009, and the
// critique's corrections), in the form the parity comparison uses. A text divergence rewrites
// the prototype's Tier A lines for one region of the listed states before they are compared,
// so Remi must show exactly `remi` where the prototype showed `prototype`; anything else in the
// region must still match. A visual divergence changes only pixels (strip blocks) and is listed
// in the report next to the Tier B figure. Add a row here only together with a row in ADR-0007
// (or another ADR, or the critique line it puts into effect), and cite it in `source`.
//
// Tier A lines are the region's own text lines, then its fields as "[field] <value>" lines, and
// each Roll reads as one line holding its value (compare.ts). A row matches inside one line
// (never across lines); `wholeLine` rows match only a line that is exactly `prototype` (for a
// bare Roll value such as "3.6"). `remi` may hold "\n" to stand for several lines. A `wholeLine`
// row whose `prototype` holds "\n" matches that run of consecutive whole lines, and `remi: ''`
// removes the matched line or lines (a change row Remi does not show).
//
// ADR-0007 rows that no parity state shows (the seed never reaches them, or the design never
// renders the value) are listed as `data` rows, so docs/parity-report.md carries every
// documented divergence, and each one says why no capture shows it.

export interface TextDivergence {
  kind: 'text';
  id: string;
  /** Exact state ids. */
  states: string[];
  /** The data-screen-label of the region. */
  region: string;
  /** What the prototype shows (a substring of the region's Tier A text). */
  prototype: string;
  /** What Remi shows instead ("\n" separates lines). */
  remi: string;
  /** Match only a line that equals `prototype` exactly. */
  wholeLine?: boolean;
  source: string;
  why: string;
}

export interface VisualDivergence {
  kind: 'visual';
  id: string;
  states: string[];
  region: string;
  what: string;
  source: string;
  why: string;
}

/** A documented divergence that no parity state shows (listed in the report only). */
export interface DataDivergence {
  kind: 'data';
  id: string;
  /** Always empty: no state shows it. */
  states: string[];
  region: string;
  what: string;
  source: string;
  why: string;
}

export type Divergence = TextDivergence | VisualDivergence | DataDivergence;

export const DIVERGENCES: Divergence[] = [
  {
    kind: 'text',
    id: 'verdict-buffer-7',
    states: ['transition'],
    region: 'Transition',
    prototype: 'with 8 business days to spare',
    remi: 'with 7 business days to spare',
    source: 'ADR-0007 (verdict buffer), ADR-0009',
    why: 'The buffer counts the business days strictly between the last Private Credit exit (Fri 18 Dec) and the move.',
  },
  {
    kind: 'visual',
    id: 'strip-buffer-7',
    states: ['transition'],
    region: 'Transition',
    what: 'The strip shows 7 "Buffer after the last exit" blocks, not 8.',
    source: 'ADR-0007 (verdict buffer), ADR-0009',
    why: 'Same count as the verdict sentence.',
  },
  {
    kind: 'text',
    id: 'ret-need-3.8',
    states: ['workspace-ret', 'workspace-ret-datepicker'],
    region: 'Project workspace',
    prototype: 'plan 3.6h a day instead of 3.5h',
    remi: 'plan 3.8h a day instead of 3.5h',
    source: 'ADR-0007 (ret "need" rate)',
    why: 'Linear need solver rounded up to 0.1; applying 3.8 lands on the target.',
  },
  {
    kind: 'text',
    id: 'ret-need-3.8-roll',
    states: ['workspace-ret', 'workspace-ret-datepicker'],
    region: 'Project workspace',
    prototype: '3.6',
    remi: '3.8',
    wholeLine: true,
    source: 'ADR-0007 (ret "need" rate)',
    why: 'The "To land on target" Roll shows the same need rate as the sentence.',
  },
  {
    kind: 'text',
    id: 'ret-need-3.8-more',
    states: ['workspace-ret', 'workspace-ret-datepicker'],
    region: 'Project workspace',
    prototype: '0.1h a day more than planned',
    remi: '0.3h a day more than planned',
    source: 'ADR-0007 (ret "need" rate)',
    why: 'The line under the Roll is the need rate minus the planned 3.5h: 3.8 − 3.5.',
  },
  {
    kind: 'text',
    id: 'play-fion-need-1.0',
    states: ['workspace-play', 'workspace-fion'],
    region: 'Project workspace',
    prototype: '0.9',
    remi: '1',
    wholeLine: true,
    source: 'ADR-0007 (play and fion "need" rate)',
    why: 'The "To land on target" Roll: linear need solver rounded up to 0.1 (1.0), the same rule as ret; written as the prototype\'s hr() writes it (Workspace.dc.html:380, 413), so "1".',
  },
  {
    kind: 'text',
    id: 'home-demo-ret-6h',
    states: ['home-hover-plan'],
    region: 'Remi home',
    prototype: 'Fri 4 Dec',
    remi: 'Mon 7 Dec',
    wholeLine: true,
    source: 'ADR-0007 (ret +6h scope)',
    why: 'Hovering the Control Panel card plays the returns pipeline with 6 more hours (Remi Home.dc.html:214 hard-codes the old maths); Remi asks the server, which lands it on Mon 7 Dec.',
  },
  {
    kind: 'text',
    id: 'home-demo-ret-6h-delta',
    states: ['home-hover-plan'],
    region: 'Remi home',
    prototype: '+5 BD',
    remi: '+6 BD',
    wholeLine: true,
    source: 'ADR-0007 (ret +6h scope)',
    why: 'The same demo against the Fri 27 Nov target: one business day later than the prototype.',
  },
  {
    kind: 'text',
    id: 'checkin-error-message',
    states: ['drawer-error'],
    region: 'Check-in drawer',
    prototype: 'Remi couldn’t read that just now',
    remi: 'Remi couldn’t read that just now\nThe assistant didn’t answer cleanly (Remi replied without a plan.). Try again, or use a simple reading that picks out hours, blockers and names.',
    wholeLine: true,
    source: 'critique.md, CheckIn :246 and :250',
    why: 'The prototype\'s renderVals never returns its error message, so its panel shows none; the critique gives the text.',
  },
  {
    kind: 'text',
    id: 'ret-scope-6h',
    states: ['drawer-review-claude', 'drawer-review-offline'],
    region: 'Check-in drawer',
    prototype: '2 Dec → 4 Dec · +2 BD',
    remi: '2 Dec → 7 Dec · +3 BD',
    source: 'ADR-0007 (ret +6h scope)',
    why: 'finish_for counts Thu 3 Dec (a BD3 with 0h for ret) instead of ceil(H/rate).',
  },
  {
    kind: 'text',
    id: 'simple-no-note-beside-task-done',
    states: ['drawer-review-offline'],
    region: 'Check-in drawer',
    prototype: 'NOTE\nFinished parsing the security-level extract.',
    remi: '',
    wholeLine: true,
    source: 'ADR-0007 (simple reading of a sentence that finishes a task)',
    why: 'The simple reading records "Finished parsing the security-level extract." as the task_done it is and adds no note repeating it (arch-backend-engine-api.md: "no note is added next to a task_done"), so the returns pipeline shows TICK OFF without the NOTE row.',
  },
  {
    kind: 'text',
    id: 'simple-no-note-beside-task-done-count',
    states: ['drawer-review-offline'],
    region: 'Check-in drawer',
    prototype: 'Apply 7 changes',
    remi: 'Apply 6 changes',
    wholeLine: true,
    source: 'ADR-0007 (simple reading of a sentence that finishes a task)',
    why: 'One change fewer than the prototype (the note above), so the apply button counts 6.',
  },
  {
    kind: 'visual',
    id: 'simple-no-note-beside-task-done-rows',
    states: ['drawer-review-offline'],
    region: 'Check-in drawer',
    what: 'Without the NOTE row, every change row below "TICK OFF Parse and validate the extract" sits one row higher, which is most of this state\'s Tier B difference.',
    source: 'ADR-0007 (simple reading of a sentence that finishes a task)',
    why: 'Same change as the two text rows above.',
  },
  {
    kind: 'text',
    id: 'textbook-saved-locally',
    states: ['textbook-home'],
    region: 'Textbook',
    prototype: 'Saved in this browser',
    remi: 'Saved locally',
    wholeLine: true,
    source: 'arch-frontend-screens §4 (Textbook save status); Remi Textbook.dc.html:657',
    why: 'The prototype kept pages in localStorage; Remi saves them in the local server\'s database, so "in this browser" would be false. The spec\'s resting status is "Saved locally" (frontend/remi/src/screens/textbook/usePageSaver.ts).',
  },
  // ---------------------------------------------------------------- not shown by any state
  {
    kind: 'data',
    id: 'new-project-define',
    states: [],
    region: 'Project workspace',
    what: 'A new project starts in Define with no forecast (the prototype set forecast = target at 0h a day).',
    source: 'ADR-0007 (new project)',
    why: 'No parity state creates a project; the behaviour suite and the empty states cover it.',
  },
  {
    kind: 'data',
    id: 'holiday-2026-08-31',
    states: [],
    region: 'Calendar',
    what: 'Mon 31 Aug 2026 is the summer bank holiday (the prototype counted it as a business day).',
    source: 'ADR-0007 (31 Aug 2026)',
    why: 'Every parity state starts on Mon 5 Oct 2026, after it; goldens are compared from 1 Sep.',
  },
  {
    kind: 'data',
    id: 'scope-and-stall-rows',
    states: [],
    region: 'Check-in drawer',
    what: 'ret scope other than +6h, manco and play scope, rate and work-left edits that run out of hours (the stall rule with unplaced hours).',
    source: 'ADR-0007 (the ret, manco and play scope rows, rate edits, play work left)',
    why: 'The parity states preview only ret +6h (ret-scope-6h above); the other amounts are covered by the backend goldens.',
  },
  {
    kind: 'data',
    id: 'simple-one-note-per-project',
    states: [],
    region: 'Check-in drawer',
    what: 'The simple reading joins several note sentences for one project into one note.',
    source: 'ADR-0007 (simple reading, september-reconciled)',
    why: 'No parity state reads text with two note sentences for one project.',
  },
  {
    kind: 'data',
    id: 'routine-bau-hours-move',
    states: [],
    region: 'Routines',
    what: 'Moving a routine to another business day moves the projects\' BAU-day hours with it (ManCo pack BD8 → BD10 leaves only the 4 Nov overload).',
    source: 'ADR-0007 (moving a routine\'s business day)',
    why: 'No parity state edits a routine; the behaviour flow "Routines: a rule change" does.',
  },
  {
    kind: 'data',
    id: 'feed-forecast-moved',
    states: [],
    region: '(feed, not rendered)',
    what: 'Feed items report the movement an apply made: "Forecast moved 11 Dec → 25 Nov." after an hours-a-day check-in, and "… 2 Dec → 7 Dec." after ret +6h.',
    source: 'ADR-0007 (feed after an hours-a-day check-in; feed after ret +6h)',
    why: 'Data only: the design never renders the feed (decision 8). The behaviour flow checks the ret +6h feed text.',
  },
  {
    kind: 'data',
    id: 'rate-zero-refused',
    states: [],
    region: 'Project workspace',
    what: 'Hours a day of 0 on a project with a forecast is refused (422 "Hours a day must be more than 0 for a project with a forecast."); the field keeps its old value.',
    source: 'ADR-0007 (hours a day set to 0)',
    why: 'No parity state edits a rate.',
  },
  {
    kind: 'data',
    id: 'notes-rail-future-days',
    states: [],
    region: 'Notes',
    what: 'The Notes rail also lists future days that have notes (newest first), not only today and earlier.',
    source: 'ADR-0007 (Notes rail)',
    why: 'The seed has no future notes, so the notes baseline is unchanged.',
  },
];

export interface AppliedLines {
  /** The prototype's Tier A lines with the divergences applied. */
  lines: string[];
  /** lines joined with single spaces: what Remi's Tier A text must equal. */
  text: string;
  /** Divergences applied to this region. */
  applied: string[];
  /** Divergences listed for this region whose prototype text was not found (stale rows). */
  missing: string[];
}

function textRows(stateId: string, region: string): TextDivergence[] {
  return DIVERGENCES.filter((d): d is TextDivergence => d.kind === 'text' && d.region === region && d.states.includes(stateId));
}

/** The prototype's Tier A lines for a region, with the documented divergences applied in order. */
export function applyDivergences(stateId: string, region: string, prototypeLines: string[]): AppliedLines {
  let lines = [...prototypeLines];
  const applied: string[] = [];
  const missing: string[] = [];
  const remiLines = (d: TextDivergence) => (d.remi === '' ? [] : d.remi.split('\n'));
  for (const d of textRows(stateId, region)) {
    let hit = false;
    if (d.wholeLine && d.prototype.includes('\n')) {
      // A run of whole lines.
      const run = d.prototype.split('\n');
      const out: string[] = [];
      for (let i = 0; i < lines.length; ) {
        if (run.every((l, k) => lines[i + k] === l)) {
          hit = true;
          out.push(...remiLines(d));
          i += run.length;
        } else {
          out.push(lines[i]!);
          i++;
        }
      }
      lines = out;
    } else {
      lines = lines.flatMap((line) => {
        const match = d.wholeLine ? line === d.prototype : line.includes(d.prototype);
        if (!match) return [line];
        hit = true;
        return d.wholeLine ? remiLines(d) : line.split(d.prototype).join(d.remi).split('\n');
      });
    }
    (hit ? applied : missing).push(d.id);
  }
  return { lines, text: lines.join(' '), applied, missing };
}

export function divergencesFor(stateId: string): Divergence[] {
  return DIVERGENCES.filter((d) => d.states.includes(stateId));
}
