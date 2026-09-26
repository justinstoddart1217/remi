import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { usePicker } from './picker';

afterEach(() => {
  document.body.innerHTML = '';
});

function setup() {
  const root = document.createElement('div');
  const trigger = document.createElement('button');
  const panel = document.createElement('div');
  panel.tabIndex = -1;
  root.append(trigger, panel);
  document.body.append(root);
  const { result } = renderHook(() => usePicker({ current: root }));
  const req = { key: 'target', value: '2026-11-27', label: 'Target date', onPick: () => undefined };
  return { result, trigger, panel, req };
}

describe('usePicker', () => {
  it('puts focus back on the trigger when the picker closes (Escape, a pick, Today, the backdrop)', () => {
    const { result, trigger, panel, req } = setup();
    trigger.focus();
    act(() => {
      result.current.open(req, trigger);
    });
    expect(result.current.picker?.key).toBe('target');
    // The picker focuses its panel when it opens.
    panel.focus();
    act(() => {
      result.current.close();
    });
    expect(result.current.picker).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus back to a trigger that has gone', () => {
    const { result, trigger, panel, req } = setup();
    act(() => {
      result.current.open(req, trigger);
    });
    panel.focus();
    trigger.remove();
    act(() => {
      result.current.close();
    });
    expect(document.activeElement).toBe(panel);
  });
});
