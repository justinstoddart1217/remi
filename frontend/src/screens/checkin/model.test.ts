import { describe, expect, it } from 'vitest';

import type { CheckinChange, ProjectPreviewOut } from '../../api';
import { fixtureAiStatus, fixtureProject, fixtureRoutine } from '../../test/msw';
import {
  applyLabel,
  echoOf,
  effectChip,
  footNoteFor,
  groupChanges,
  hintFor,
  prefillText,
  providerIndicator,
  rowText,
  selectedChanges,
  sourceNote,
  splitSentences,
  summaryOf,
} from './model';

const ret = fixtureProject({
  id: 'ret',
  name: 'Returns pipeline automation',
  short: 'Returns pipeline',
  rate: 3.5,
  confidence: 3,
  targetDate: '2026-12-04',
  milestones: [
    {
      id: 'm1',
      tasks: [{ id: 't1', text: 'Parse and validate the extract' }],
    } as unknown as ReturnType<typeof fixtureProject>['milestones'][number],
  ],
});
const manco = fixtureProject({ id: 'manco', name: 'ManCo pack automation', short: 'ManCo automation', domain: 'pc', rate: 1.5 });
const routine = fixtureRoutine({
  id: 'r-ret',
  name: 'Fund & security-level returns',
  detail: '12 funds',
  checklistItems: Array.from({ length: 12 }, (_, i) => ({ id: `f${String(i)}`, label: `Fund ${String(i)}`, sortOrder: i })) as never,
});

describe('text helpers', () => {
  it('splits sentences as the prototype and echoes at most five', () => {
    expect(splitSentences('One. Two!\nThree? Four')).toEqual(['One.', 'Two!', 'Three?', 'Four']);
    expect(echoOf('a. b. c. d. e. f. g.')).toHaveLength(5);
  });

  it('writes the hint line (crit :312) and footer notes (crit :319)', () => {
    expect(hintFor('compose', '')).toBe('Write it the way you would tell a colleague.');
    expect(hintFor('compose', 'three small words')).toBe('3 words');
    expect(hintFor('review', 'x')).toBe('Change the text and send again if Remi missed something.');
    expect(footNoteFor('review')).toBe('Untick anything Remi got wrong. Applying updates forecasts, the timeline and Today.');
    expect(footNoteFor('thinking')).toBe('Nothing changes until you apply.');
    expect(footNoteFor('error')).toBe('Nothing changes until you review and apply.');
  });

  it('prefills from Notes and from the palette quick add', () => {
    expect(prefillText(null, null)).toBe('');
    expect(prefillText({ text: '08:41 Admin files landed' }, null)).toBe('08:41 Admin files landed');
    expect(prefillText({ scopeH: 6 }, 'Returns pipeline')).toBe('New scope on Returns pipeline, about 6h: ');
    expect(prefillText({ scopeH: 1.5 }, null)).toBe('New scope on this project, about 1.5h: ');
  });

  it('labels the apply button and the source', () => {
    expect(applyLabel(0)).toBe('Nothing selected');
    expect(applyLabel(1)).toBe('Apply 1 change');
    expect(applyLabel(7)).toBe('Apply 7 changes');
    expect(sourceNote('simple', 2, 2)).toBe('simple reading');
    expect(sourceNote('ai', 7, 8)).toBe('7 of 8 selected');
    expect(summaryOf({ summary: '', changes: [] })).toBe('');
    expect(summaryOf({ summary: '', changes: [{ type: 'note', projectId: 'ret', text: 'x' }] })).toBe('Here is what Remi picked out.');
  });
});

describe('rowText (crit :268-277)', () => {
  const cases: [CheckinChange, string][] = [
    [{ type: 'task_done', projectId: 'ret', taskId: 't1' }, 'Parse and validate the extract'],
    [{ type: 'task_add', projectId: 'ret', text: 'Map FX', hours: 1.5 }, 'Map FX · 1.5h, added to Now'],
    [{ type: 'scope_add', projectId: 'ret', text: 'FX attribution too', hours: 6 }, 'FX attribution too · +6h'],
    [{ type: 'confidence', projectId: 'ret', value: 2 }, '3 → 2 of 5'],
    [{ type: 'target_move', projectId: 'ret', date: '2027-01-08' }, 'Fri 4 Dec → Fri 8 Jan'],
    [{ type: 'hours_per_day', projectId: 'ret', value: 2 }, '3.5h → 2h a day'],
    [{ type: 'blocker', projectId: 'ret', text: 'the admin extract' }, 'the admin extract'],
    [{ type: 'bau_done', routineId: 'r-ret' }, 'Fund & security-level returns, today’s run (ticks all 12 funds)'],
  ];
  it.each(cases)('%o', (change, text) => {
    expect(rowText(change, change.type === 'bau_done' ? null : ret, change.type === 'bau_done' ? routine : null)).toBe(text);
  });
});

describe('groupChanges', () => {
  const changes: CheckinChange[] = [
    { type: 'scope_add', projectId: 'ret', text: 'FX', hours: 6 },
    { type: 'hours_per_day', projectId: 'manco', value: 2 },
    { type: 'blocker', projectId: 'ret', text: 'extract' },
    { type: 'bau_done', routineId: 'r-ret' },
    { type: 'target_move', projectId: 'ret', date: '2027-01-08' },
  ];

  it('groups per project in first-appearance order, BAU under "BAU · today"', () => {
    const groups = groupChanges(changes, {}, [ret, manco], [routine]);
    expect(groups.map((g) => g.name)).toEqual(['Returns pipeline automation', 'ManCo pack automation', 'BAU · today']);
    expect(groups[0]?.rows.map((r) => [r.index, r.kind, r.risk])).toEqual([
      [0, 'New scope', true],
      [2, 'Blocker', true],
      [4, 'Target', false],
    ]);
    expect(groups[0]?.targetMoved).toBe(true);
  });

  it('marks unticked rows and drops them from the selection', () => {
    const groups = groupChanges(changes, { 4: true }, [ret, manco], [routine]);
    expect(groups[0]?.rows[2]?.on).toBe(false);
    expect(groups[0]?.targetMoved).toBe(false);
    expect(selectedChanges(changes, { 1: true, 4: true })).toHaveLength(3);
  });
});

describe('effectChip', () => {
  const preview = (p: Partial<ProjectPreviewOut>): ProjectPreviewOut => ({
    projectId: 'ret',
    from: '2026-12-02',
    to: '2026-12-07',
    deltaBd: 3,
    late: true,
    label: '+3 BD',
    targetAfter: '2026-12-04',
    newOver: [],
    missesKeyRun: false,
    pastTargetBd: 1,
    ...p,
  });

  it('shows the move with the server label, risk-tinted when late', () => {
    expect(effectChip(preview({}), false)).toEqual({ text: '2 Dec → 7 Dec · +3 BD', late: true });
    expect(effectChip(preview({ to: '2026-11-25', deltaBd: -5, late: false, label: '−5 BD', pastTargetBd: null }), false)).toEqual({
      text: '2 Dec → 25 Nov · −5 BD',
      late: false,
    });
  });

  it('says "forecast holds" or how far past target when only the target moved', () => {
    const holds = preview({ to: '2026-12-02', deltaBd: 0, late: false, label: '±0 BD', pastTargetBd: null });
    expect(effectChip(holds, false)).toBeNull();
    expect(effectChip(holds, true)).toEqual({ text: 'forecast holds', late: false });
    // The count is the server's (`pastTargetBd`), never worked out here.
    expect(effectChip({ ...holds, late: true, targetAfter: '2026-11-30', pastTargetBd: 2 }, true)).toEqual({
      text: 'now 2 BD past target',
      late: false,
    });
    expect(effectChip({ ...holds, late: true, targetAfter: '2026-11-30', pastTargetBd: null }, true)).toEqual({
      text: 'now past target',
      late: false,
    });
  });

  it('has no chip without a forecast', () => {
    expect(effectChip(undefined, true)).toBeNull();
    expect(effectChip(preview({ from: null }), false)).toBeNull();
  });
});

describe('providerIndicator', () => {
  it('reads the provider from /ai/status', () => {
    expect(providerIndicator(undefined).state).toBe('offline');
    expect(providerIndicator(fixtureAiStatus({ provider: 'none' })).state).toBe('offline');
    const anthropic = providerIndicator(fixtureAiStatus({ provider: 'anthropic', available: true, egress: true, model: 'claude' }));
    expect(anthropic).toEqual({ state: 'ai', label: 'Reads with Anthropic (claude). Your update is sent to Anthropic.' });
    expect(providerIndicator(fixtureAiStatus({ provider: 'ollama', available: false, reason: 'not running', model: null })).state).toBe(
      'unavailable',
    );
  });
});
