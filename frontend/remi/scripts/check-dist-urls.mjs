// Stay local (ADR-0003): fail if any built text file references an http(s) URL other than an
// XML namespace identifier. `make dist-urls` runs this after `vite build`; the Vite plugin in
// vite-plugin-stay-local.ts enforces the same rule during the build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NAMESPACE_URIS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
]);
// react-router's URL-parsing base when `window` is undefined: loopback, never fetched.
const LOOPBACK_PARSE_BASES = new Set(['http://localhost']);
const URL_PATTERN = /https?:\/\/[^\s"'`()<>\\]*/g;
const TEXT_FILE = /\.(?:m?js|css|html|svg|json|txt|map|webmanifest)$/;

const root = process.argv[2] ?? 'dist';
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (TEXT_FILE.test(name)) files.push(path);
  }
};
walk(root);

const offenders = [];
for (const file of files) {
  for (const [url] of readFileSync(file, 'utf8').matchAll(URL_PATTERN)) {
    if (!NAMESPACE_URIS.has(url) && !LOOPBACK_PARSE_BASES.has(url)) offenders.push(`${relative(root, file)}: ${url}`);
  }
}
if (offenders.length > 0) {
  console.error(`External URLs in ${root}/ (nothing may load from the network):\n  ${offenders.join('\n  ')}`);
  process.exit(1);
}
console.log(`${root}/: ${String(files.length)} text files, no external URLs (XML namespaces only)`);
