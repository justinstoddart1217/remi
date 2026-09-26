import { describe, expect, it } from 'vitest';

/**
 * Remi runs on a Mac or a Windows PC (launch.command, launch.bat), so no screen's copy names one
 * platform: "this computer", "your system", "the secure key store". The Foundations page is the
 * design reference, shown as drawn.
 */
const SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./foundations/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('screen copy', () => {
  it('never names one platform', () => {
    const hits = Object.entries(SOURCES).flatMap(([file, src]) =>
      src
        .split('\n')
        .filter((line) => /\b(?:your|this|on a) Mac\b|Mac's|macOS/.test(line) && !/^\s*(?:\*|\/\/)/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });
});
