import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ScreenActivityContext } from '../lib/arrival';
import { hoverKey, useHover } from '../stores/hover';
import type { HoverKey } from '../stores/hover';
import { useScreenDimMask, useScreenDimmed, useScreenHoverKey } from './linkedHover';

const RET = hoverKey('project', 'ret');
const PLAY = hoverKey('project', 'play');
const RUN = hoverKey('routine', 'r-ret');

afterEach(() => {
  useHover.getState().clear();
});

function Probe({ own, log }: { own: HoverKey; log: string[] }) {
  const dimmed = useScreenDimmed(own);
  const key = useScreenHoverKey();
  const mask = useScreenDimMask([RET, RUN]);
  log.push(`${String(dimmed)}|${key ? key.id : '-'}|${mask}`);
  return null;
}

function mount(active: boolean) {
  const log: string[] = [];
  render(
    <ScreenActivityContext.Provider value={{ screen: 'calendar', active }}>
      <Probe own={RET} log={log} />
    </ScreenActivityContext.Provider>,
  );
  return log;
}

describe('the linked highlight per screen', () => {
  it('dims on the active screen', () => {
    const log = mount(true);
    act(() => {
      useHover.getState().set(PLAY);
    });
    expect(log.at(-1)).toBe('true|play|11');
    act(() => {
      useHover.getState().set(RET);
    });
    expect(log.at(-1)).toBe('false|ret|01');
  });

  it('never re-renders a hidden screen for a hover on the visible one', () => {
    const log = mount(false);
    const before = log.length;
    act(() => {
      useHover.getState().set(PLAY);
    });
    act(() => {
      useHover.getState().set(RET);
    });
    act(() => {
      useHover.getState().clear();
    });
    expect(log.length).toBe(before);
    expect(log.at(-1)).toBe('false|-|');
  });
});
