import type { Plugin } from 'vite';

/**
 * Stay local (ADR-0003): the built app must not contain any http(s) URL except XML namespace
 * identifiers, which browsers never fetch.
 *
 * 1. Library error strings that embed documentation links (React's minified-error URL) have
 *    the scheme dropped, so they stay readable but can never become a request.
 * 2. After the bundle is written every text file is scanned, and the build fails on any other
 *    http(s) URL. Fix the source (self-host the asset) rather than widening the allow-list.
 */

/** Inert documentation prefixes whose scheme is stripped: [from, to]. */
const INERT_DOC_LINKS: readonly (readonly [string, string])[] = [
  ['https://react.dev/errors/', 'react.dev/errors/'],
  ['https://reactrouter.com/', 'reactrouter.com/'],
];

/** XML namespace identifiers. They look like URLs but are never fetched. */
const NAMESPACE_URIS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
]);

/**
 * Loopback parse bases. react-router uses `new URL(path, "http://localhost")` only when
 * `window` is undefined; it is a URL-parsing base, never a request, and loopback in any case.
 */
const LOOPBACK_PARSE_BASES = new Set(['http://localhost']);

const URL_PATTERN = /https?:\/\/[^\s"'`()<>\\]*/g;
const TEXT_FILE = /\.(?:m?js|css|html|svg|json|txt|map|webmanifest)$/;

export function findExternalUrls(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)]
    .map((m) => m[0])
    .filter((url) => !NAMESPACE_URIS.has(url) && !LOOPBACK_PARSE_BASES.has(url));
}

export function stripInertDocLinks(code: string): string {
  let out = code;
  for (const [from, to] of INERT_DOC_LINKS) out = out.replaceAll(from, to);
  return out;
}

export function stayLocal(): Plugin {
  return {
    name: 'remi:stay-local',
    apply: 'build',
    enforce: 'post',
    renderChunk(code) {
      const next = stripInertDocLinks(code);
      return next === code ? null : { code: next, map: null };
    },
    writeBundle(_options, bundle) {
      const offenders: string[] = [];
      for (const [fileName, output] of Object.entries(bundle)) {
        if (!TEXT_FILE.test(fileName)) continue;
        const text =
          output.type === 'chunk'
            ? output.code
            : typeof output.source === 'string'
              ? output.source
              : new TextDecoder().decode(output.source);
        for (const url of findExternalUrls(text)) offenders.push(`${fileName}: ${url}`);
      }
      if (offenders.length > 0) {
        this.error(
          `stay-local: the build references external URLs (nothing may load from the network):\n  ${offenders.join('\n  ')}`,
        );
      }
    },
  };
}
