import { describe, expect, it } from 'vitest';

import { findExternalUrls, stripInertDocLinks } from './vite-plugin-stay-local';

describe('stay-local build guard', () => {
  it('allows XML namespaces and flags everything else', () => {
    const text =
      'a="http://www.w3.org/2000/svg" b="https://fonts.googleapis.com/css2?family=X" c="http://localhost:1"';
    expect(findExternalUrls(text)).toEqual([
      'https://fonts.googleapis.com/css2?family=X',
      'http://localhost:1',
    ]);
  });

  it("allows react-router's exact loopback parse base but nothing else on localhost", () => {
    expect(findExternalUrls('new URL(p, "http://localhost")')).toEqual([]);
    expect(findExternalUrls('"http://localhost:1"')).toEqual(['http://localhost:1']);
  });

  it("drops the scheme from react-router's doc link", () => {
    const code = 'see https://reactrouter.com/en/main/routers/picking-a-router.';
    expect(findExternalUrls(stripInertDocLinks(code))).toEqual([]);
  });

  it("drops the scheme from React's minified-error link", () => {
    const code = 'visit https://react.dev/errors/"+e';
    expect(stripInertDocLinks(code)).toBe('visit react.dev/errors/"+e');
    expect(findExternalUrls(stripInertDocLinks(code))).toEqual([]);
  });
});
