import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, useUi } from '../../stores/ui';
import { createTestQueryClient, fixturePlan, fixtureProject, server, setupMockApi } from '../../test/msw';
import { ControlPanelPreview } from './ControlPanelPreview';

const mock = setupMockApi();

afterEach(() => {
  useUi.setState({ appearance: DEFAULT_APPEARANCE });
});

interface Paint {
  heights: string[];
  empty: boolean[];
  diamonds: string[];
}

const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-tone]')];
const diamonds = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[class*="diamond"]')];

/**
 * What the first commit that draws the preview's bars shows. Mutation records arrive before
 * the next animation frame, so this is the state an element mounts in: a height or scale that
 * is already final there never transitions.
 */
function watchFirstPaint(root: HTMLElement): Promise<Paint> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const list = bars(root);
      if (list.length === 0) return;
      observer.disconnect();
      resolve({
        heights: list.map((b) => b.style.height),
        empty: list.map((b) => b.hasAttribute('data-empty')),
        diamonds: diamonds(root).map((d) => d.style.transform),
      });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
  });
}

function planWithMilestone() {
  const project = fixtureProject();
  const today = fixturePlan().loads['2026-10-05'];
  if (!today) throw new Error('fixture: no load on today');
  return fixturePlan({
    // Hours on today only.
    loads: { '2026-10-05': today },
    projects: [
      {
        ...project,
        derived: {
          ...project.derived,
          milestones: [{ date: '2026-10-16', done: false, horizon: 'explicit', milestoneId: 'm1', name: 'Dry run', passed: false }],
        },
      },
    ],
  });
}

function renderPreview(arrived: boolean) {
  const client = createTestQueryClient();
  const container = document.createElement('div');
  document.body.append(container);
  const first = watchFirstPaint(container);
  const view = render(
    <QueryClientProvider client={client}>
      <ControlPanelPreview home={undefined} hover={false} arrived={arrived} />
    </QueryClientProvider>,
    { container },
  );
  const rerender = (next: boolean) => {
    view.rerender(
      <QueryClientProvider client={client}>
        <ControlPanelPreview home={undefined} hover={false} arrived={next} />
      </QueryClientProvider>,
    );
  };
  return { first, container, rerender };
}

describe('ControlPanelPreview arrival', () => {
  it('grows the bars and pops the diamonds in when the plan lands after the card has arrived', async () => {
    mock.api.state.plan = planWithMilestone();
    // The plan answers well after the card's two-frame arrival.
    server.use(
      http.get('*/api/plan', async () => {
        await delay(80);
        return HttpResponse.json(mock.api.state.plan);
      }),
    );
    const { first, container } = renderPreview(true);
    const paint = await first;
    // Mounted at zero: the grow transitions have something to run from.
    expect(paint.heights.every((h) => h === '0%')).toBe(true);
    expect(paint.diamonds).toEqual(['rotate(45deg) scale(0)']);
    await waitFor(() => {
      expect(bars(container).some((b) => b.style.height !== '0%')).toBe(true);
    });
    expect(diamonds(container).map((d) => d.style.transform)).toEqual(['rotate(45deg) scale(1)']);
  });

  it('waits for the card: nothing grows while the card has not arrived', async () => {
    mock.api.state.plan = planWithMilestone();
    const { first, container, rerender } = renderPreview(false);
    await first;
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(bars(container).every((b) => b.style.height === '0%')).toBe(true);
    rerender(true);
    await waitFor(() => {
      expect(bars(container).some((b) => b.style.height !== '0%')).toBe(true);
    });
  });

  it('under reduced motion mounts everything at its final size: no grow, no scale pop', async () => {
    useUi.setState({ appearance: { ...DEFAULT_APPEARANCE, motion: 'reduced' } });
    mock.api.state.plan = planWithMilestone();
    // Even before the card's own arrival: a later flip must have nothing left to animate.
    const { first } = renderPreview(false);
    const paint = await first;
    expect(paint.diamonds).toEqual(['rotate(45deg) scale(1)']);
    expect(paint.heights.some((h) => h !== '0%')).toBe(true);
  });

  it('draws a day with nothing planned as an empty stub, not an accent bar', async () => {
    mock.api.state.plan = planWithMilestone();
    const { first } = renderPreview(true);
    const paint = await first;
    // Hours on today only: one bar holds them, every other day is an empty stub.
    expect(paint.empty).toHaveLength(30);
    expect(paint.empty.filter((e) => !e)).toHaveLength(1);
  });
});
