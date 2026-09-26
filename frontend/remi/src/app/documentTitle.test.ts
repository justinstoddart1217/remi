import { describe, expect, it } from 'vitest';

import { documentTitleFor, routeId } from './documentTitle';

describe('documentTitleFor', () => {
  it('names each app screen after its rail label, the workspace after its project', () => {
    expect(documentTitleFor('/app/today')).toBe('Today · Remi');
    expect(documentTitleFor('/app/today/2026-10-06')).toBe('Today · Remi');
    expect(documentTitleFor('/app/calendar/2026-11')).toBe('Calendar · Remi');
    expect(documentTitleFor('/app/projects')).toBe('Projects · Remi');
    expect(documentTitleFor('/app/projects/ret', { project: 'Returns pipeline automation' })).toBe('Returns pipeline automation · Remi');
    expect(documentTitleFor('/app/projects/ret')).toBe('Project workspace · Remi');
  });

  it("keeps the prototype's product titles for Home, the Textbook and Foundations", () => {
    expect(documentTitleFor('/')).toBe('Remi');
    expect(documentTitleFor('/textbook')).toBe('Remi · Textbook');
    expect(documentTitleFor('/textbook/fi-rates', { page: 'Rates primer' })).toBe('Rates primer · Remi · Textbook');
    expect(documentTitleFor('/textbook/fi-rates', { page: '  ' })).toBe('Remi · Textbook');
    expect(documentTitleFor('/foundations')).toBe('Remi · Foundations');
    expect(documentTitleFor('/dev/foundations/library')).toBe('Library · Remi · Foundations');
  });

  it('names Settings and the first-run wizard', () => {
    expect(documentTitleFor('/settings')).toBe('Settings · Remi');
    expect(documentTitleFor('/setup')).toBe('Set up · Remi');
  });

  it('reads the ids a title needs from the path', () => {
    expect(routeId('/app/projects/a%20b')).toEqual({ projectId: 'a b', pageId: null });
    expect(routeId('/textbook/fi-rates')).toEqual({ projectId: null, pageId: 'fi-rates' });
    expect(routeId('/app/today')).toEqual({ projectId: null, pageId: null });
  });
});
