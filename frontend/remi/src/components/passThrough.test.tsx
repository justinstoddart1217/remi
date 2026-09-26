/**
 * The props the screens asked for so they can drop local copies (docs/requests/F4-platform.md):
 * StaleBadge's three items, `data-*` on TimelineBar and RotationSegment, and the linked-highlight
 * `dimmed` flags on BauChip and CapacityBar.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BauChip } from './BauChip';
import { CapacityBar } from './CapacityBar';
import { RotationSegment } from './RotationSegment';
import type { DayLoad } from './shared/domain';
import { StaleBadge } from './StaleBadge';
import { TimelineBar } from './TimelineBar';

const LOAD: DayLoad = {
  items: [
    { refType: 'routine', refId: 'r-ret', domain: 'pc', h: 6, name: 'Returns' },
    { refType: 'project', refId: 'ret', domain: 'pc', h: 1, name: 'Returns pipeline' },
  ],
  bau: 6,
  proj: 1,
  total: 7,
  free: 1,
  capacity: 8,
  over: false,
};

describe('StaleBadge', () => {
  it('lays the words out as three items, as the prototype interpolation does', () => {
    const { container } = render(<StaleBadge days={9} />);
    const badge = container.firstElementChild as HTMLElement;
    const words = [...badge.children].filter((c) => c.getAttribute('aria-hidden') !== 'true').map((c) => c.textContent);
    expect(words).toEqual(['Stale ·', '9', 'days']);
    expect(badge).toHaveTextContent('Stale · 9 days');
  });

  it('keeps one text run for the Foundations specimen', () => {
    const { container } = render(<StaleBadge days={9} dot={false} joined />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.children).toHaveLength(0);
    expect(badge.textContent).toBe('Stale · 9 days');
  });
});

describe('data-* pass-through', () => {
  it('puts TimelineBar attributes on the bar itself, not the overrun', () => {
    const { container } = render(
      <div>
        <TimelineBar state="risk" width={100} overrun={20} data-parity="timeline-bar:ret" aria-hidden />
      </div>,
    );
    const [bar, overrun] = [...(container.firstElementChild?.children ?? [])];
    expect(bar).toHaveAttribute('data-parity', 'timeline-bar:ret');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(overrun).not.toHaveAttribute('data-parity');
  });

  it('puts RotationSegment attributes on the stop', () => {
    render(
      <RotationSegment pass="Build" width={40} data-parity="timeline-rotation-segment" title="Germany · Build">
        DE
      </RotationSegment>,
    );
    const stop = screen.getByTitle('Germany · Build');
    expect(stop).toHaveAttribute('data-parity', 'timeline-rotation-segment');
    expect(stop).toHaveStyle({ width: '40px' });
  });
});

describe('dimmed', () => {
  it('marks a dimmed BauChip with data-dim, and an explicit opacity still wins', () => {
    const { rerender } = render(<BauChip dimmed>Returns · 6h</BauChip>);
    const chip = screen.getByText('Returns · 6h');
    expect(chip).toHaveAttribute('data-dim');
    rerender(<BauChip>Returns · 6h</BauChip>);
    expect(chip).not.toHaveAttribute('data-dim');
    rerender(<BauChip opacity={0.5}>Returns · 6h</BauChip>);
    expect(chip).toHaveStyle({ opacity: '0.5' });
  });

  it('dims CapacityBar segments per item, or the whole bar', () => {
    const { container, rerender } = render(
      <CapacityBar variant="panel" load={LOAD} itemDimmed={(item) => item.refType === 'project'} />,
    );
    const bar = container.firstElementChild as HTMLElement;
    const segs = [...bar.children];
    // BAU, project, free.
    expect(segs.map((sg) => sg.hasAttribute('data-dim'))).toEqual([false, true, false]);
    expect(bar).not.toHaveAttribute('data-dim');
    rerender(<CapacityBar variant="panel" load={LOAD} dimmed />);
    expect(bar).toHaveAttribute('data-dim');
  });
});
