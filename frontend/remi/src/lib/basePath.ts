/**
 * Where Remi is served from, read at runtime (ADR-0013). The backend writes the page's
 * `<base href>`: `/` on the laptop, `/remi/` behind APEX's proxy, which strips that prefix
 * before it reaches Remi. The build's asset links are relative to it, and the router's
 * basename and the API's address come from here, so one build serves any prefix.
 */

/**
 * The base path without its trailing slash: `""` at the root, `/remi` behind the proxy. Without a
 * document or a `<base>` element (unit tests) it is `""`: the document's own URL is a route, not
 * a base.
 */
export function basePath(): string {
  if (typeof document === 'undefined' || !document.querySelector('base[href]')) return '';
  try {
    return new URL(document.baseURI).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** An app path (`/textbook/p1`) as an `href` the browser can follow: under the base. */
export function appHref(path: string): string {
  return `${basePath()}${path}`;
}

/** The app path of a browser pathname: `/remi/app/today` → `/app/today` (unchanged at the root). */
export function appPath(pathname: string): string {
  const base = basePath();
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}
