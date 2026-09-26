// Offline vendor routes for the prototype (docs/design-spec/arch-delivery-parity.md section 3).
//
// The design export loads React, Babel, Google Fonts and KaTeX from CDNs. Every non-loopback
// request is intercepted at the browser-context level (all frames, including sandboxed chart
// iframes) and answered from local files, so the harness runs with the network off:
//
//   unpkg react@18.3.1 / react-dom@18.3.1 UMD, @babel/standalone@7.29.0
//        -> parity/node_modules, byte-identical to unpkg, so support.js's SRI checks pass
//   fonts.googleapis.com/css2?...  -> CSS built from the @fontsource packages (text faces) or the
//        committed Material Symbols subset (frontend/src/assets/fonts/material-symbols-remi.woff2)
//   fonts.gstatic.com/__remi_local__/... -> those woff2 files
//   cdn.jsdelivr.net/npm/katex@0.16.11/... -> parity/node_modules/katex/...
//
// Anything else is aborted and recorded in the VendorLog, and the specs fail on it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Route } from '@playwright/test';

export const PARITY_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(PARITY_DIR, '..');
export const DESIGN_DIR = path.join(REPO_DIR, 'Remi Dashboard Design Review');
const NODE_MODULES = path.join(PARITY_DIR, 'node_modules');
export const MATERIAL_SYMBOLS_WOFF2 = path.join(REPO_DIR, 'frontend/src/assets/fonts/material-symbols-remi.woff2');

const LOCAL_FONT_BASE = 'https://fonts.gstatic.com/__remi_local__/';
const ICON_FONT_URL = LOCAL_FONT_BASE + 'material-symbols-remi.woff2';

/** CDN scripts the runtime loads with SRI (support.js src/cdn.ts). */
export const CDN_SCRIPTS: Record<string, string> = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'react/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js': '@babel/standalone/babel.min.js',
};
const KATEX_PREFIX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/';

export interface VendorLog {
  /** URLs answered from local files. */
  served: string[];
  /** Non-loopback URLs that had no local mapping: aborted. */
  blocked: string[];
}

export const newVendorLog = (): VendorLog => ({ served: [], blocked: [] });

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const CORS = { 'access-control-allow-origin': '*', 'timing-allow-origin': '*', 'cache-control': 'public, max-age=31536000' };

function isLoopback(url: URL): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
function inside(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  return full.startsWith(root + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

// ------------------------------------------------------------------ fonts CSS
interface FaceSource {
  pkg: string;
  css: string;
  family: string;
  /** Google's declared weight range for the requested axis (css2 ital,wght@0,300..700;1,400..600). */
  weight?: string;
}

// The families and weights the design requests (Remi.dc.html line 15).
const TEXT_FACES: FaceSource[] = [
  { pkg: '@fontsource-variable/albert-sans', css: 'wght.css', family: 'Albert Sans', weight: '300 700' },
  { pkg: '@fontsource-variable/albert-sans', css: 'wght-italic.css', family: 'Albert Sans', weight: '400 600' },
  { pkg: '@fontsource/jetbrains-mono', css: '400.css', family: 'JetBrains Mono' },
  { pkg: '@fontsource/jetbrains-mono', css: '500.css', family: 'JetBrains Mono' },
  { pkg: '@fontsource/libre-caslon-text', css: '400.css', family: 'Libre Caslon Text' },
  { pkg: '@fontsource/libre-caslon-text', css: '700.css', family: 'Libre Caslon Text' },
  { pkg: '@fontsource/libre-caslon-text', css: '400-italic.css', family: 'Libre Caslon Text' },
];
const KNOWN_FAMILIES = new Set(['Albert Sans', 'JetBrains Mono', 'Libre Caslon Text', 'Material Symbols Outlined']);

let textCssCache: string | null = null;

/** @font-face rules for the text families, rewritten from the @fontsource CSS (all subsets, woff2 only). */
export function textFontsCss(): string {
  if (textCssCache) return textCssCache;
  const out: string[] = [];
  for (const src of TEXT_FACES) {
    const cssPath = path.join(NODE_MODULES, src.pkg, src.css);
    const css = fs.readFileSync(cssPath, 'utf8');
    for (const block of css.match(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g) ?? []) {
      const get = (prop: string) => block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim();
      const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
      const comment = block.match(/\/\*\s*([^*]+?)\s*\*\//)?.[1];
      if (!file) throw new Error(`${cssPath}: @font-face without a woff2 source`);
      out.push(
        `/* ${comment} */\n@font-face {\n  font-family: '${src.family}';\n  font-style: ${get('font-style')};\n` +
          `  font-weight: ${src.weight ?? get('font-weight')};\n  font-display: swap;\n` +
          `  src: url(${LOCAL_FONT_BASE}node_modules/${src.pkg}/files/${file}) format('woff2');\n` +
          `  unicode-range: ${get('unicode-range')};\n}\n`,
      );
    }
  }
  textCssCache = out.join('\n');
  return textCssCache;
}

/** Material Symbols: the committed 30-icon subset, declared the way Google's css2 response is. */
export function iconFontCss(): string {
  return `@font-face {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 300;
  font-display: block;
  src: url(${ICON_FONT_URL}) format('woff2');
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}
`;
}

/** Families named in a css2 URL: family=Albert+Sans:ital,wght@... -> "Albert Sans". */
function requestedFamilies(url: URL): string[] {
  return url.searchParams.getAll('family').map((f) => (f.split(':')[0] ?? '').replace(/\+/g, ' ').trim());
}

// ------------------------------------------------------------------ integrity
/** Check the local React/ReactDOM/Babel files hash to the SRI values support.js pins. */
export function verifyVendorIntegrity(): void {
  const support = fs.readFileSync(path.join(DESIGN_DIR, 'support.js'), 'utf8');
  const pairs: [string, string][] = [
    ['REACT_URL', 'REACT_SRI'],
    ['REACT_DOM_URL', 'REACT_DOM_SRI'],
    ['BABEL_URL', 'BABEL_SRI'],
  ];
  for (const [urlVar, sriVar] of pairs) {
    const url = support.match(new RegExp(`var ${urlVar} = "([^"]+)"`))?.[1];
    const sri = support.match(new RegExp(`var ${sriVar} = "([^"]+)"`))?.[1];
    if (!url || !sri) throw new Error(`support.js: cannot find ${urlVar}/${sriVar}`);
    const rel = CDN_SCRIPTS[url];
    if (!rel) throw new Error(`vendor-routes: no local mapping for ${url}`);
    const [algo, expected] = sri.split('-', 2) as [string, string];
    const actual = crypto.createHash(algo).update(fs.readFileSync(path.join(NODE_MODULES, rel))).digest('base64');
    if (actual !== expected) throw new Error(`SRI mismatch for ${url}: node_modules/${rel} is ${algo}-${actual}, support.js pins ${sri}`);
  }
  if (!fs.existsSync(MATERIAL_SYMBOLS_WOFF2)) throw new Error(`missing icon font ${MATERIAL_SYMBOLS_WOFF2}`);
}

// ------------------------------------------------------------------ routing
async function fulfilFile(route: Route, file: string, log: VendorLog): Promise<void> {
  log.served.push(route.request().url());
  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': type }, body: fs.readFileSync(file) });
}

async function fulfilCss(route: Route, css: string, log: VendorLog): Promise<void> {
  log.served.push(route.request().url());
  await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': CONTENT_TYPES['.css']! }, body: css });
}

async function block(route: Route, log: VendorLog, why = ''): Promise<void> {
  log.blocked.push(route.request().url() + (why ? ` (${why})` : ''));
  await route.abort('blockedbyclient');
}

async function handle(route: Route, log: VendorLog): Promise<void> {
  const href = route.request().url();
  const url = new URL(href);

  const cdn = CDN_SCRIPTS[href.split('#')[0]!.split('?')[0]!];
  if (cdn) return fulfilFile(route, path.join(NODE_MODULES, cdn), log);

  if (url.hostname === 'fonts.googleapis.com' && (url.pathname === '/css2' || url.pathname === '/css')) {
    const families = requestedFamilies(url);
    const unknown = families.filter((f) => !KNOWN_FAMILIES.has(f));
    if (unknown.length) return block(route, log, `unmapped font family: ${unknown.join(', ')}`);
    const icons = families.includes('Material Symbols Outlined');
    const text = families.some((f) => f !== 'Material Symbols Outlined');
    return fulfilCss(route, [text ? textFontsCss() : '', icons ? iconFontCss() : ''].join('\n'), log);
  }

  if (href.startsWith(LOCAL_FONT_BASE)) {
    const rel = href.slice(LOCAL_FONT_BASE.length).split('?')[0]!;
    if (rel === 'material-symbols-remi.woff2') return fulfilFile(route, MATERIAL_SYMBOLS_WOFF2, log);
    const file = rel.startsWith('node_modules/') ? inside(NODE_MODULES, rel.slice('node_modules/'.length)) : null;
    if (file && file.endsWith('.woff2')) return fulfilFile(route, file, log);
    return block(route, log, 'unknown local font');
  }

  if (href.startsWith(KATEX_PREFIX)) {
    const file = inside(path.join(NODE_MODULES, 'katex'), href.slice(KATEX_PREFIX.length).split(/[?#]/)[0]!);
    if (file) return fulfilFile(route, file, log);
    return block(route, log, 'unknown katex file');
  }

  return block(route, log);
}

/**
 * Route every non-loopback request of the context (all pages and frames) to local files.
 * Loopback requests (the prototype's http.server, the Remi server) are not intercepted.
 */
export async function installVendorRoutes(context: BrowserContext, log: VendorLog = newVendorLog()): Promise<VendorLog> {
  await context.route(
    (url) => !isLoopback(url),
    (route) => handle(route, log),
  );
  return log;
}
