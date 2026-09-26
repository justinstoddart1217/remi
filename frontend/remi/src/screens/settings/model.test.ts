import { describe, expect, it } from 'vitest';

import { fixtureAiStatus, fixtureMovement, fixtureProject, fixtureRoutine, fixtureSettings } from '../../test/msw';
import type { SegmentDraft } from '../setup/rotation/model';
import {
  ACCENT_PAIRS,
  accentById,
  accentFor,
  aiStatusLine,
  appearanceFromSettings,
  assignSavedIds,
  keyProjectChoices,
  keyRoutineChoices,
  movedNote,
  segmentDates,
  settingsRail,
} from './model';

function seg(key: string, id: string | null, code = 'DE', lengthBd = 5): SegmentDraft {
  return { key, id, country: 'Germany', code, lengthBd, pass: 'Build' };
}

describe('accents', () => {
  it('lists the three Ninety One pairs in order, the default first', () => {
    expect(ACCENT_PAIRS.map((a) => [a.pc, a.fi])).toEqual([
      ['#009D80', '#2F6B9A'],
      ['#026E62', '#5B7FA8'],
      ['#34C1A3', '#1F4E79'],
    ]);
    expect(ACCENT_PAIRS.map((a) => a.name)).toEqual(['Teal and blue', 'Deep teal and slate', 'Mint and navy']);
  });

  it('finds a pair by its hex values, ignoring case', () => {
    expect(accentFor('#026e62', '#5b7fa8').id).toBe('deep');
    expect(accentFor('#34C1A3', '#000000').id).toBe('mint');
    expect(accentFor('#123456', '#654321').id).toBe('teal');
    expect(accentFor('#526e2a', '#47619c').id).toBe('teal');
    expect(accentFor(null, undefined).id).toBe('teal');
    expect(accentById('deep').pc).toBe('#026E62');
  });

  it('turns settings into the ui store appearance', () => {
    expect(
      appearanceFromSettings(
        fixtureSettings({ accentPc: '#026E62', accentFi: '#5B7FA8', serifDisplay: false, motionPreference: 'reduced' }),
      ),
    ).toEqual({ accent: 'deep', serif: false, motion: 'reduced' });
  });
});

describe('key choices', () => {
  const ret = fixtureProject({ id: 'ret', name: 'Returns pipeline', domain: 'pc', sortOrder: 1 });
  const manco = fixtureProject({ id: 'manco', name: 'ManCo pack', domain: 'pc', sortOrder: 0 });
  const fion = fixtureProject({ id: 'fion', name: 'FI onboarding', domain: 'fi', sortOrder: 0 });

  it('offers Private Credit projects in order, then None', () => {
    expect(keyProjectChoices([ret, fion, manco], 'ret').map((c) => c.value)).toEqual(['manco', 'ret', null]);
  });

  it('keeps a key project from another domain listed', () => {
    const choices = keyProjectChoices([ret, fion], 'fion');
    expect(choices.map((c) => c.value)).toEqual(['ret', 'fion', null]);
    expect(choices[1]?.hint).toBe('Fixed Income');
  });

  it('offers Private Credit routines first', () => {
    const a = fixtureRoutine({ id: 'a', name: 'FI desk', domain: 'fi', sortOrder: 0 });
    const b = fixtureRoutine({ id: 'b', name: 'Returns', domain: 'pc', sortOrder: 2 });
    const c = fixtureRoutine({ id: 'c', name: 'ManCo', domain: 'pc', sortOrder: 1 });
    expect(keyRoutineChoices([a, b, c]).map((x) => x.value)).toEqual(['c', 'b', 'a', null]);
  });
});

describe('movedNote', () => {
  it('counts projects whose forecast moved', () => {
    expect(movedNote({ movements: [] })).toBeNull();
    expect(movedNote({ movements: [fixtureMovement({ projectId: 'ret', deltaBd: 0 })] })).toBeNull();
    expect(
      movedNote({
        movements: [
          fixtureMovement({ projectId: 'ret', deltaBd: 3 }),
          fixtureMovement({ projectId: 'manco', deltaBd: -1 }),
        ],
      }),
    ).toBe('2 forecasts moved');
    expect(movedNote({ movements: [fixtureMovement({ projectId: 'ret', deltaBd: 1 })] })).toBe('1 forecast moved');
  });
});

describe('aiStatusLine', () => {
  it('says nothing for None and waits for a matching status', () => {
    expect(aiStatusLine(fixtureAiStatus(), 'none')).toBeNull();
    expect(aiStatusLine(fixtureAiStatus({ provider: 'none' }), 'anthropic')).toEqual({ tone: 'off', text: 'Checking…' });
  });

  it('points a missing key at the field below, not at the environment', () => {
    const line = aiStatusLine(
      fixtureAiStatus({
        provider: 'anthropic',
        available: false,
        keySet: false,
        reason: 'No API key. Add one in Settings, or set REMI_ANTHROPIC_API_KEY. Until then Remi reads simply.',
      }),
      'anthropic',
    );
    expect(line).toEqual({ tone: 'wait', text: 'No key yet. Add it below. Until then Remi reads simply.' });
  });

  it('says the Anthropic package is missing without naming the install command', () => {
    const line = aiStatusLine(
      fixtureAiStatus({
        provider: 'anthropic',
        available: false,
        keySet: true,
        sdkInstalled: false,
        reason: 'The anthropic package is not installed (uv sync --extra anthropic)',
      }),
      'anthropic',
    );
    expect(line).toEqual({
      tone: 'wait',
      text: 'Anthropic reading is not installed in this copy of Remi. Until then Remi reads simply.',
    });
  });

  it("gives the server's reason for any other wait, without doubling the full stop", () => {
    const line = aiStatusLine(
      fixtureAiStatus({
        provider: 'anthropic',
        available: false,
        keySet: true,
        sdkInstalled: true,
        reason: 'Anthropic is not answering.',
      }),
      'anthropic',
    );
    expect(line).toEqual({ tone: 'wait', text: 'Anthropic is not answering. Until then Remi reads simply.' });
  });

  it('names the model and where Ollama runs', () => {
    const line = aiStatusLine(
      fixtureAiStatus({ provider: 'ollama', available: true, model: 'llama3.1', ollamaBaseUrl: 'http://127.0.0.1:11434' }),
      'ollama',
    );
    expect(line?.tone).toBe('ok');
    expect(line?.text).toBe('Ready with llama3.1. Remi asks the Ollama model on this computer at 127.0.0.1:11434.');
  });
});

describe('settingsRail', () => {
  it('summarises each section', () => {
    const rail = settingsRail({
      settings: fixtureSettings(),
      regionName: 'England and Wales',
      countdownBd: 61,
      segments: [seg('a', 'a'), seg('b', 'b', 'FR', 3)],
    });
    expect(rail.move).toEqual({ summary: 'Mon 4 Jan 2027 · 61 business days', state: 'done' });
    expect(rail.day.summary).toBe('8h a day · England & Wales · Europe/London');
    expect(rail.rotation).toEqual({ summary: '2 countries · 8 BD', state: 'done' });
    expect(rail.ai.summary).toBe('Simple reading, offline');
    expect(rail.appearance.summary).toBe('Teal and blue · display face on · system motion');
  });

  it('flags Anthropic without a key and an empty rotation', () => {
    const rail = settingsRail({
      settings: fixtureSettings({ aiProvider: 'anthropic', aiKeyConfigured: false }),
      regionName: 'South Africa',
      countdownBd: null,
      segments: [],
    });
    expect(rail.ai).toEqual({ summary: 'Anthropic, waiting for a key', state: 'todo' });
    expect(rail.rotation).toEqual({ summary: 'Not set up yet', state: 'optional' });
    expect(rail.move.summary).toBe('Mon 4 Jan 2027');
  });
});

describe('assignSavedIds', () => {
  it('gives new entries the ids the server created, by position in what was sent', () => {
    const sent = [seg('k1', 'rot-0'), seg('new-1', null, 'FR')];
    const out = assignSavedIds(sent, sent, [{ id: 'rot-0' }, { id: 'rot-9' }]);
    expect(out.map((s) => [s.key, s.id])).toEqual([
      ['k1', 'rot-0'],
      ['new-1', 'rot-9'],
    ]);
  });

  it('keeps edits made while the save was in flight', () => {
    const sent = [seg('new-1', null, 'FR')];
    const draft = [seg('new-2', null, 'IT'), { ...seg('new-1', null, 'FR'), lengthBd: 8 }];
    const out = assignSavedIds(draft, sent, [{ id: 'rot-5' }]);
    expect(out.map((s) => [s.key, s.id, s.lengthBd])).toEqual([
      ['new-2', null, 5],
      ['new-1', 'rot-5', 8],
    ]);
  });

  it('returns the same list when nothing changes', () => {
    const draft = [seg('k1', 'rot-0')];
    expect(assignSavedIds(draft, draft, [{ id: 'rot-0' }])).toBe(draft);
    expect(assignSavedIds(draft, [seg('x', null)], [])).toBe(draft);
  });
});

describe('segmentDates', () => {
  it('labels placed segments by id', () => {
    const draft = [seg('k1', 'rot-0'), seg('new-1', null)];
    const out = segmentDates(draft, [{ id: 'rot-0', start: '2027-01-04', end: '2027-01-11' }], (iso) => iso.slice(5));
    expect(out).toEqual({ k1: '01-04 – 01-11' });
  });
});
