import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCalendarDays } from '../../test/fixtures/calendar';
import { errorResponse, fixturePlan, fixtureProject, renderWithClient, server, setupMockApi } from '../../test/msw';
import { RemiApiError } from '../client';
import { keys } from '../keys';
import {
  hasRolledOver,
  isPlanOut,
  nextMidnightIn,
  planEtag,
  rolloverDelay,
  ROLLOVER_RETRY_MS,
  ROLLOVER_SLACK_MS,
  planStatusOf,
  useCalendarIndex,
  useLoads,
  usePlan,
  usePlanAliases,
  usePlanStatus,
  useProject,
  useProjects,
  useRoutines,
  useVerdict,
} from './plan';

const mock = setupMockApi();

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function planRequests() {
  return mock.api.requestsTo('/api/plan', 'GET');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('usePlan: ETag / If-None-Match', () => {
  it('sends the ETag back and keeps the same plan object on 304', async () => {
    const { result } = renderWithClient(() => usePlan());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const first = result.current.data;
    expect(first?.revision).toBe(1);
    expect(planRequests()[0]?.headers.get('If-None-Match')).toBeNull();

    await act(() => result.current.refetch());

    const requests = planRequests();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get('If-None-Match')).toBe('"1"');
    expect(result.current.data).toBe(first);
    expect(result.current.isError).toBe(false);
  });

  it('takes a new revision but keeps unchanged subtrees (structural sharing)', async () => {
    const { result } = renderWithClient(() => usePlan());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const first = defined(result.current.data);

    const base = fixturePlan();
    mock.api.state.plan = {
      ...base,
      revision: 2,
      projects: [fixtureProject({ forecastDate: '2026-12-07' })],
    };
    await act(() => result.current.refetch());
    await waitFor(() => {
      expect(result.current.data?.revision).toBe(2);
    });

    const second = defined(result.current.data);
    expect(second).not.toBe(first);
    expect(planRequests()[1]?.headers.get('If-None-Match')).toBe('"1"');
    // Untouched parts keep their identity, so persistent nodes animate from old values.
    expect(second.routines).toBe(first.routines);
    expect(second.calendar).toBe(first.calendar);
    expect(second.verdict).toBe(first.verdict);
    expect(second.projects[0]?.charter).toBe(first.projects[0]?.charter);
    expect(second.projects[0]?.forecastDate).toBe('2026-12-07');
    // And the next request asks about revision 2.
    await act(() => result.current.refetch());
    expect(planRequests()[2]?.headers.get('If-None-Match')).toBe('"2"');
  });

  it('refetches when the page becomes visible again (a 304 on the same day)', async () => {
    const { result } = renderWithClient(() => usePlan());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const first = result.current.data;

    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      expect(planRequests()).toHaveLength(2);
    });
    expect(planRequests()[1]?.headers.get('If-None-Match')).toBe('"1"');
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });
    expect(result.current.data).toBe(first);
  });

  it('fails with SETUP_REQUIRED before setup, without retrying', async () => {
    mock.api.state.plan = null;
    const { result } = renderWithClient(() => usePlan());
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ status: 409, code: 'SETUP_REQUIRED' });
    expect(planRequests()).toHaveLength(1);
  });

  it('rejects a body that is not a plan', async () => {
    server.use(http.get('*/api/plan', () => HttpResponse.json({ required: false })));
    const { result } = renderWithClient(() => usePlan());
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('usePlan: day rollover', () => {
  it('refetches at nextRolloverAt without If-None-Match and refreshes the other reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-05T23:59:58+01:00'));

    const { result, client } = renderWithClient(() => usePlan());
    await vi.waitFor(() => {
      expect(result.current.data?.today.iso).toBe('2026-10-05');
    });
    client.setQueryData(keys.home, { stale: 'yesterday' });

    // Midnight passes on the server; nothing was mutated, so the revision is unchanged.
    const base = fixturePlan();
    mock.api.state.plan = {
      ...base,
      today: { ...base.today, iso: '2026-10-06', w: 2, bdm: 4, nextRolloverAt: '2026-10-07T00:00:00+01:00' },
    };

    await act(() => vi.advanceTimersByTimeAsync(2_000 + ROLLOVER_SLACK_MS + 50));
    await vi.waitFor(() => {
      expect(result.current.data?.today.iso).toBe('2026-10-06');
    });

    const requests = planRequests();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get('If-None-Match')).toBeNull();
    expect(client.getQueryState(keys.home)?.isInvalidated).toBe(true);
  });

  it('computes the rollover delay from nextRolloverAt', () => {
    const plan = fixturePlan();
    const at = Date.parse(plan.today.nextRolloverAt);
    expect(rolloverDelay(plan, at - 60_000)).toBe(60_000 + ROLLOVER_SLACK_MS);
    // Within the slack the refetch still waits for the rest of it; after that, it retries.
    expect(rolloverDelay(plan, at + 400)).toBe(ROLLOVER_SLACK_MS - 400);
    expect(rolloverDelay(plan, at + 5_000)).toBe(ROLLOVER_RETRY_MS);
    expect(rolloverDelay(undefined)).toBe(false);
    expect(hasRolledOver(plan, at - 1)).toBe(false);
    expect(hasRolledOver(plan, at)).toBe(true);
  });

  it('falls back to midnight in the plan timezone', () => {
    const now = Date.parse('2026-10-05T21:30:00Z'); // 22:30 in London (BST)
    expect(nextMidnightIn('Europe/London', now)).toBe(Date.parse('2026-10-05T23:00:00Z'));
    expect(nextMidnightIn('Not/AZone', now)).toBeNull();
    const plan = fixturePlan();
    const bad = { ...plan, today: { ...plan.today, nextRolloverAt: 'soon' } };
    expect(rolloverDelay(bad, now)).toBe(90 * 60_000 + ROLLOVER_SLACK_MS);
  });
});

describe('plan helpers and selectors', () => {
  it('uses the server ETag when it names the cached revision', () => {
    const { client } = renderWithClient(() => null);
    const plan = fixturePlan({ revision: 7 });
    expect(planEtag(client, plan)).toBe('"7"');
    expect(isPlanOut(plan)).toBe(true);
    expect(isPlanOut({ revision: 1 })).toBe(false);
  });

  it('the fixture plan agrees with its own calendar', () => {
    const plan = fixturePlan();
    expect(plan.verdict.bufferBd).toBe(19);
    expect(plan.projects[0]?.derived.bufferBd).toBe(-3);
    expect(plan.move.remaining).toHaveLength(plan.move.countdownBd);
    // ret (after Wed 2 Dec's block) and the key run (before Thu 3 Dec's) share a boundary.
    expect(plan.move.flags.map((f) => [f.kind, f.slot, f.index, f.liftPx, f.stickPx])).toEqual([
      ['project', 42, 0, 2, 10],
      ['key_run', 42, 1, 18, 26],
      ['move', 61, 2, 2, 10],
    ]);
  });

  it('selects projects, verdict and a memoised calendar index', async () => {
    const { result } = renderWithClient(() => ({
      project: useProject('ret'),
      missing: useProject('nope'),
      pc: useProjects('pc'),
      fi: useProjects('fi'),
      verdict: useVerdict(),
      index: useCalendarIndex(),
    }));
    // No plan yet: no answer, not an empty plan.
    expect(result.current.project).toBeUndefined();
    expect(result.current.pc).toBeUndefined();
    expect(result.current.index).toBeUndefined();
    await waitFor(() => {
      expect(result.current.project?.name).toBe('Returns pipeline');
    });
    expect(result.current.missing).toBeNull();
    expect(result.current.pc).toHaveLength(1);
    expect(result.current.fi).toEqual([]);
    expect(result.current.verdict?.state).toBe('on_track_narrowly');
    expect(result.current.index?.bdOfMonth('2026-10-05')).toBe(3);
    expect(result.current.index?.bdBetween('2026-10-05', '2027-01-04')).toBe(61);
    // The verdict's buffer is what the fixture's own calendar says.
    expect(result.current.index?.bdBetween('2026-12-02', '2027-01-04')).toBe(result.current.verdict?.bufferBd);

    const { project, pc, index } = result.current;
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.project).toBe(project);
    expect(result.current.pc).toBe(pc);
    expect(result.current.index).toBe(index);
  });
});

describe('selectors when the plan cannot be read', () => {
  function useEverySelector() {
    return {
      status: usePlanStatus(),
      projects: useProjects('pc'),
      routines: useRoutines(),
      loads: useLoads(),
      aliases: usePlanAliases(),
      project: useProject('ret'),
      verdict: useVerdict(),
      index: useCalendarIndex(),
    };
  }

  it('a failed read is an error, never an empty plan', async () => {
    server.use(http.get('*/api/plan', () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong.')));
    const { result } = renderWithClient(useEverySelector);
    expect(result.current.status.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status.status).toBe('error');
    });
    expect(result.current.status.error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    const { projects, routines, loads, aliases, project, verdict, index } = result.current;
    expect({ projects, routines, loads, aliases, project, verdict, index }).toEqual({
      projects: undefined,
      routines: undefined,
      loads: undefined,
      aliases: undefined,
      project: undefined,
      verdict: undefined,
      index: undefined,
    });
  });

  it('before setup the status is "setup"; once read, empty lists are real', async () => {
    mock.api.state.plan = null;
    const { result } = renderWithClient(useEverySelector);
    await waitFor(() => {
      expect(result.current.status.status).toBe('setup');
    });
    expect(result.current.projects).toBeUndefined();

    mock.api.state.plan = fixturePlan({ projects: [], routines: [] });
    await act(async () => {
      result.current.status.refetch();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.status.status).toBe('ready');
    });
    expect(result.current.status.error).toBeNull();
    expect(result.current.projects).toEqual([]);
    expect(result.current.routines).toEqual([]);
    expect(result.current.project).toBeNull();
  });

  it('planStatusOf: data wins over a later failed refetch', () => {
    const error = new RemiApiError({ status: 0, code: 'NETWORK_ERROR', message: '' });
    expect(planStatusOf({ data: fixturePlan(), error })).toBe('ready');
    expect(planStatusOf({ data: undefined, error })).toBe('error');
    expect(planStatusOf({ data: undefined, error: null })).toBe('loading');
  });
});

describe('useCalendarIndex beyond the plan window', () => {
  it('fetches GET /calendar for the missing range, in the plan region, and merges it', async () => {
    const asked: string[] = [];
    server.use(
      http.get('*/api/calendar', ({ request }) => {
        const url = new URL(request.url);
        asked.push(url.search);
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        return HttpResponse.json({
          from,
          to,
          region: url.searchParams.get('holidayRegion') ?? 'GB-ENG',
          days: buildCalendarDays(from, to),
        });
      }),
    );
    const { result } = renderWithClient(() => useCalendarIndex({ from: '2027-02-01', to: '2027-02-28' }));
    await waitFor(() => {
      expect(result.current?.bdOfMonth('2027-02-26')).toBe(20);
    });
    // Plan days are still there, and the two ranges are one index.
    expect(result.current?.bdOfMonth('2026-10-05')).toBe(3);
    expect(result.current?.monthGrid('2027-02')).not.toBeNull();
    expect(asked).toEqual(['?from=2027-02-01&to=2027-02-28&holidayRegion=GB-ENG']);
  });

  it('does not fetch when the plan covers the range', async () => {
    const { result } = renderWithClient(() => useCalendarIndex({ from: '2026-10-01', to: '2026-12-31' }));
    await waitFor(() => {
      expect(result.current?.bdOfMonth('2026-12-31')).toBe(21);
    });
    expect(mock.api.requestsTo('/api/calendar')).toHaveLength(0);
  });
});
