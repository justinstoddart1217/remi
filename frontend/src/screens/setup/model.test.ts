import { describe, expect, it } from 'vitest';

import {
  blockingReason,
  FALLBACK_DEFAULTS,
  formatHoursShort,
  initialDraft,
  PROVIDER_NOTE,
  PROVIDER_SUMMARY,
  regionLabel,
  stepStates,
  stepSummaries,
  toSetupIn,
} from './model';
import type { SetupDraft } from './model';
import type { SegmentDraft } from './rotation/model';

const DE: SegmentDraft = { key: 'a', id: null, country: 'Germany', code: 'DE', lengthBd: 6, pass: 'Build' };

function draft(patch: Partial<SetupDraft> = {}): SetupDraft {
  return { ...initialDraft(FALLBACK_DEFAULTS), ...patch };
}

describe('initialDraft', () => {
  it('takes the server defaults, with no move date and no rotation', () => {
    const d = initialDraft({
      timezone: 'Africa/Johannesburg',
      holidayRegion: 'ZA',
      capacityHoursPerDay: 7.5,
      aiProvider: 'none',
      rotationHoursPerDay: 3,
    });
    expect(d).toEqual({
      moveDate: null,
      hoursPerDay: 7.5,
      region: 'ZA',
      timezone: 'Africa/Johannesburg',
      segments: [],
      rotationHoursPerDay: 3,
      provider: 'none',
    });
    expect(initialDraft(null).hoursPerDay).toBe(8);
  });
});

describe('step states and the start button', () => {
  it('needs only the move date; the rotation is optional', () => {
    expect(stepStates(draft())).toEqual({ move: 'todo', day: 'done', rotation: 'optional', ai: 'done' });
    expect(blockingReason(draft())).toBe('Choose your move date to start.');
    expect(blockingReason(draft({ moveDate: '2027-01-04' }))).toBeNull();
  });

  it('blocks on an unfinished country and a blank time zone', () => {
    const unfinished = { ...DE, code: '' };
    expect(stepStates(draft({ moveDate: '2027-01-04', segments: [unfinished] })).rotation).toBe('invalid');
    expect(blockingReason(draft({ moveDate: '2027-01-04', segments: [unfinished] }))).toBe(
      'Finish or remove the unfinished country in the rotation.',
    );
    expect(blockingReason(draft({ moveDate: '2027-01-04', timezone: '  ' }))).toBe('Choose your time zone to start.');
    expect(stepStates(draft({ moveDate: '2027-01-04', segments: [DE] })).rotation).toBe('done');
  });
});

describe('summaries', () => {
  it('reads each step in one line', () => {
    const out = stepSummaries(draft({ moveDate: '2027-01-04', segments: [DE] }), {
      countdownBd: 61,
      moveLabel: 'Mon 4 Jan 2027',
      regionName: 'England & Wales',
    });
    expect(out).toEqual({
      move: 'Mon 4 Jan 2027 · 61 business days',
      day: '8h a day · England & Wales · Europe/London',
      rotation: '1 country · 6 BD',
      ai: 'Simple reading, offline',
    });
    expect(stepSummaries(draft(), { countdownBd: null, moveLabel: null, regionName: 'x' }).move).toBe('Not chosen yet');
    expect(stepSummaries(draft(), { countdownBd: null, moveLabel: null, regionName: 'x' }).rotation).toBe(
      'Skipped for now',
    );
  });

  it('formats hours and region labels', () => {
    expect(formatHoursShort(8)).toBe('8h');
    expect(formatHoursShort(7.5)).toBe('7.5h');
    expect(formatHoursShort(0.333333)).toBe('0.33h');
    expect(regionLabel('England and Wales')).toBe('England & Wales');
    expect(regionLabel('South Africa')).toBe('South Africa');
  });
});

describe('toSetupIn', () => {
  it('builds the POST /setup body', () => {
    expect(toSetupIn(draft({ moveDate: '2027-01-04', segments: [DE], timezone: ' Europe/London ' }))).toEqual({
      moveDate: '2027-01-04',
      timezone: 'Europe/London',
      holidayRegion: 'GB-ENG',
      capacityHoursPerDay: 8,
      aiProvider: 'none',
      aiModel: null,
      motionPreference: 'system',
      rotation: { hoursPerDay: 4, segments: [{ country: 'Germany', code: 'DE', lengthBd: 6, pass: 'Build' }] },
    });
  });

  it('leaves the rotation out when no country was added', () => {
    expect(toSetupIn(draft({ moveDate: '2027-01-04' })).rotation).toBeNull();
    expect(() => toSetupIn(draft())).toThrow();
  });
});

describe('the provider privacy note', () => {
  it('names this computer, never one platform, and changes with the provider', () => {
    for (const text of [...Object.values(PROVIDER_NOTE), ...Object.values(PROVIDER_SUMMARY)]) {
      expect(text).not.toMatch(/\bMac\b/);
    }
    expect(PROVIDER_NOTE.none).toBe('Simple reading works offline. Nothing leaves this computer unless you choose a provider.');
    // Anthropic is the one provider that sends anything away: say what, and what never goes.
    expect(PROVIDER_NOTE.anthropic).toMatch(/goes to Anthropic/);
    expect(PROVIDER_NOTE.anthropic).toMatch(/Goals, charters and risks never do/);
    expect(PROVIDER_NOTE.ollama).toMatch(/nothing leaves it/);
  });
});
