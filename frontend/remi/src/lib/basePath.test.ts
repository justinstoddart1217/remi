import { afterEach, describe, expect, it, vi } from 'vitest';

import { appHref, appPath, basePath } from './basePath';

/** The page's <base href>, as the backend writes it (ADR-0013). */
function setBase(href: string | null): void {
  document.head.querySelectorAll('base').forEach((b) => {
    b.remove();
  });
  if (href === null) return;
  const base = document.createElement('base');
  base.href = href;
  document.head.prepend(base);
}

afterEach(() => {
  setBase(null);
});

describe('basePath', () => {
  it('is empty without a <base> (tests; the document URL is a route, not a base)', () => {
    window.history.replaceState(null, '', '/app/today');
    expect(basePath()).toBe('');
  });

  it('is empty at the root', () => {
    setBase('/');
    expect(basePath()).toBe('');
    expect(appHref('/textbook/p1')).toBe('/textbook/p1');
    expect(appPath('/app/today')).toBe('/app/today');
  });

  it('is the proxy prefix behind APEX, without its trailing slash', () => {
    setBase('/remi/');
    window.history.replaceState(null, '', '/remi/textbook/p1');
    expect(basePath()).toBe('/remi');
    expect(appHref('/textbook/p1')).toBe('/remi/textbook/p1');
    expect(appPath('/remi/app/projects/ret')).toBe('/app/projects/ret');
    expect(appPath('/remi')).toBe('/');
    expect(appPath('/elsewhere')).toBe('/elsewhere');
  });
});

describe('the API client behind the proxy', () => {
  it('builds /remi/api/... addresses, the chart frames included', async () => {
    setBase('/remi/');
    vi.resetModules();
    const client = await import('../api/client');
    expect(client.API_BASE_URL).toBe('/remi/api');
    expect(client.chartUrl('abc 1')).toBe('/remi/api/charts/abc%201');

    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      seen.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response('{"app":"remi","version":"0"}', { headers: { 'content-type': 'application/json' } }));
    });
    await client.api.GET('/health');
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0] ?? '').pathname).toBe('/remi/api/health');
  });

  it('keeps /api at the root', async () => {
    setBase('/');
    vi.resetModules();
    const client = await import('../api/client');
    expect(client.API_BASE_URL).toBe('/api');
  });
});
