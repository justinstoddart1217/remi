import { describe, expect, it } from 'vitest';

import { paths, screenFromPath, screenPath } from './screens';

describe('screens and paths', () => {
  it('maps pathnames to screens', () => {
    expect(screenFromPath('/app/today')).toBe('today');
    expect(screenFromPath('/app/today/2026-10-12')).toBe('today');
    expect(screenFromPath('/app/projects')).toBe('projects');
    expect(screenFromPath('/app/projects/ret')).toBe('workspace');
    expect(screenFromPath('/app/calendar/2026-11')).toBe('calendar');
    expect(screenFromPath('/textbook')).toBeNull();
    expect(screenFromPath('/app/nope')).toBeNull();
  });

  it('builds URLs', () => {
    expect(paths.today('2026-10-12')).toBe('/app/today/2026-10-12');
    expect(paths.calendar('2026-11', '2026-11-04')).toBe('/app/calendar/2026-11?day=2026-11-04');
    expect(paths.routines({ focus: 'r-ret' })).toBe('/app/routines?focus=r-ret');
    expect(paths.routines({ rotation: true })).toBe('/app/routines#rotation');
    expect(paths.project('a b')).toBe('/app/projects/a%20b');
    expect(screenPath('workspace', 'ret')).toBe('/app/projects/ret');
    expect(screenPath('workspace', null)).toBe('/app/projects');
    expect(paths.settings()).toBe('/settings');
    expect(paths.settings('rotation')).toBe('/settings#rotation');
    expect(paths.settings('appearance')).toBe('/settings#appearance');
  });
});
