import { describe, expect, it } from 'vitest';

import { trapTab } from './focus';

function card(): { root: HTMLElement; first: HTMLButtonElement; last: HTMLTextAreaElement } {
  const root = document.createElement('div');
  const first = document.createElement('button');
  const last = document.createElement('textarea');
  root.append(first, last);
  document.body.append(root);
  return { root, first, last };
}

const tab = (shiftKey = false) => {
  let prevented = false;
  return { key: 'Tab', shiftKey, preventDefault: () => (prevented = true), get prevented() { return prevented; } };
};

describe('trapTab', () => {
  it('wraps Tab from the last element to the first', () => {
    const { root, first, last } = card();
    last.focus();
    const e = tab();
    trapTab(e, root);
    expect(e.prevented).toBe(true);
    expect(document.activeElement).toBe(first);
    root.remove();
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const { root, first, last } = card();
    first.focus();
    const e = tab(true);
    trapTab(e, root);
    expect(e.prevented).toBe(true);
    expect(document.activeElement).toBe(last);
    root.remove();
  });

  it('leaves Tab between inner elements alone', () => {
    const { root, first } = card();
    first.focus();
    const e = tab();
    trapTab(e, root);
    expect(e.prevented).toBe(false);
    root.remove();
  });
});
