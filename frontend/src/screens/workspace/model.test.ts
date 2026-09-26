import { describe, expect, it } from 'vitest';

import type { MilestoneOut } from '../../api';
import { findField, horizons, msKey, taskKey } from './model';

const ms = (id: string, horizon: MilestoneOut['horizon'], sortOrder: number) => ({ id, horizon, sortOrder }) as MilestoneOut;

describe('horizons', () => {
  it('splits Now and Next, each in its own order, and leaves the rest out', () => {
    const { now, next } = horizons([
      ms('b', 'now', 2),
      ms('x', 'next', 1),
      ms('a', 'now', 1),
      ms('e', 'explicit', 0),
      ms('w', 'next', 0),
    ]);
    expect(now.map((m) => m.id)).toEqual(['a', 'b']);
    expect(next.map((m) => m.id)).toEqual(['w', 'x']);
  });
});

describe('findField', () => {
  it('finds a field by its focus key, ids included', () => {
    const root = document.createElement('div');
    const field = (tag: string, fk: string) => {
      const el = document.createElement(tag);
      el.setAttribute('data-fk', fk);
      root.append(el);
    };
    field('input', 'goal');
    field('textarea', msKey('m"1'));
    field('input', taskKey('t1'));
    expect(findField(root, 'goal')?.tagName).toBe('INPUT');
    expect(findField(root, 'ms:m"1')?.tagName).toBe('TEXTAREA');
    expect(findField(root, 'task:t1')).not.toBeNull();
    expect(findField(root, 'nope')).toBeNull();
    expect(findField(null, 'goal')).toBeNull();
  });
});
