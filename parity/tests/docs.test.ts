// The repository's own docs against the files they describe (`make test-harness`, node --test).
//   - README: a "Launching Remi" section for the double-click launchers, every root entry in
//     "Repository layout", and every REMI_* setting that the launchers, the Makefile or the
//     backend config read.
//   - Makefile: `make dev` runs on its own data folder, never the real remi.db.
//   - docs/requests: a request that names a code constant or CSS-module class which no longer
//     exists is marked resolved (a stale request reads as open work to whoever finds it).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const README = read('README.md');

/** The body of a `## <title>` section (up to the next `## `). */
function section(md: string, title: RegExp): string | null {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^## /.test(l) && title.test(l.slice(3)));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

test('README has a "Launching Remi" section for both launchers', () => {
  const body = section(README, /^Launching Remi\b/);
  assert.ok(body, 'README.md has a "## Launching Remi" section');
  for (const launcher of ['launch.command', 'launch.bat']) {
    assert.ok(fs.existsSync(path.join(REPO, launcher)), `${launcher} exists`);
    assert.ok(body.includes(`\`${launcher}\``), `the section names ${launcher}`);
  }
  for (const [what, re] of [
    ['the prerequisites', /\buv\b[\s\S]*\bNode/],
    ['the address', /127\.0\.0\.1:8765/],
    ['how to stop Remi', /\bstop\b/i],
    ['where the data lives', /Application Support\/Remi/],
    ['REMI_PORT', /REMI_PORT/],
    ['REMI_REBUILD', /REMI_REBUILD/],
  ] as const) {
    assert.match(body, re, `the section covers ${what}`);
  }
  const started = README.indexOf('## Launching Remi');
  assert.ok(started >= 0 && started < README.indexOf('## Getting started'), 'it comes before "Getting started"');
});

test('README "Repository layout" lists every entry at the root', () => {
  const body = section(README, /^Repository layout\b/);
  assert.ok(body, 'README.md has a "## Repository layout" section');
  const listed = new Set(
    body
      .split('\n')
      .map((l) => l.match(/^(\S.*?)\/?(?:\s{2,}|$)/)?.[1]?.trim())
      .filter((x): x is string => !!x && !x.startsWith('```')),
  );
  const entries = fs.readdirSync(REPO).filter((e) => !e.startsWith('.') && e !== 'node_modules');
  assert.deepEqual(
    entries.filter((e) => !listed.has(e)),
    [],
    'root entries missing from the layout block',
  );
});

/** The REMI_* names a file mentions. */
const remiVars = (text: string) => new Set(text.match(/\bREMI_[A-Z][A-Z0-9_]*\b/g) ?? []);

/** RemiConfig's fields (backend/remi/core/config.py), as their REMI_<FIELD> variables. */
function configVars(): string[] {
  const src = read('backend/remi/core/config.py');
  const body = src.slice(src.indexOf('class RemiConfig'));
  const end = body.search(/\n(?:class|def) /);
  return [...(end < 0 ? body : body.slice(0, end)).matchAll(/^ {4}([a-z][a-z0-9_]*): /gm)].map((m) => `REMI_${m[1]!.toUpperCase()}`);
}

test('README documents every REMI_* setting the launchers, the Makefile and the backend config read', () => {
  const vars = new Set([...remiVars(read('launch.command')), ...remiVars(read('launch.bat')), ...remiVars(read('Makefile')), ...configVars()]);
  assert.ok(vars.has('REMI_DATA_DIR') && vars.has('REMI_REBUILD'), 'the scan finds the variables');
  const documented = remiVars(README);
  assert.deepEqual(
    [...vars].filter((v) => !documented.has(v)).sort(),
    [],
    'REMI_* variables that README.md never mentions',
  );
});

test('make dev runs on its own data folder, not the real remi.db', () => {
  const make = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync('make', ['--no-print-directory', ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env } });
  // The recipe is read, not run with `make -n`: a recipe line with $(MAKE) runs even under -n.
  const lines = read('Makefile').split('\n');
  const start = lines.findIndex((l) => /^dev:/.test(l));
  assert.ok(start >= 0, 'the Makefile has a dev target');
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('\t'));
  const recipe = lines.slice(start + 1, end).join('\n');
  assert.match(recipe, /data="\$\$\(\$\(DEV_DATA_DIR_SH\)\)"/, 'make dev works out its own data folder');
  assert.match(recipe, /\[ -n "\$\$data" \] \|\|/, 'and stops when it cannot (an empty REMI_DATA_DIR would be the current folder)');
  assert.match(recipe, /REMI_ENV=dev REMI_DATA_DIR="\$\$data"/, 'the backend of make dev gets that folder');
  assert.doesNotMatch(recipe, /\$\(MAKE\)/, 'no recursive make (it would run under make -n)');

  assert.equal(make(['-s', 'dev-data-dir'], { REMI_DEV_DATA_DIR: '/tmp/remi-dev-test' }).trim(), '/tmp/remi-dev-test');
  const clean = { ...process.env };
  delete clean.REMI_DEV_DATA_DIR;
  delete clean.REMI_DATA_DIR;
  const dir = execFileSync('make', ['--no-print-directory', '-s', 'dev-data-dir'], { cwd: REPO, encoding: 'utf8', env: clean }).trim();
  assert.equal(path.basename(dir), 'dev', `the default dev folder (${dir}) is <data dir>/dev`);
  assert.equal(path.basename(path.dirname(dir)), 'Remi', `the default dev folder (${dir}) sits in Remi's data folder`);
  // Even an exported REMI_DATA_DIR (a custom real folder) does not leak into make dev.
  assert.equal(make(['-s', 'dev-data-dir'], { REMI_DATA_DIR: '/tmp/real-remi', REMI_DEV_DATA_DIR: '' }).trim(), dir);
});

// ------------------------------------------------------------------ request docs
const SOURCE_DIRS = ['frontend/remi/src', 'frontend/remi/scripts', 'backend/remi', 'parity', 'contracts'];
const SKIP = new Set(['node_modules', 'report', 'baselines', 'test-results', 'playwright-report', '.remi-run', '__pycache__', 'dist']);
const SOURCE_EXT = /\.(ts|tsx|mts|mjs|js|css|py|json|html)$/;

function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(e.name) && !p.includes(`${path.sep}tests${path.sep}docs.test.ts`)) parts.push(fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of SOURCE_DIRS) if (fs.existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  for (const f of ['Makefile', 'launch.command', 'launch.bat']) parts.push(read(f));
  return parts.join('\n');
}

/**
 * Code names in backticks that a request doc points at: UPPER_SNAKE constants
 * (`ROUTINE_ROW_LABELS`) and CSS-module classes (`.barAnchor`).
 */
const CODE_NAME = /`(\.[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g;
const DONE = /\bresolved\b/i;

interface Block {
  text: string;
  /** The heading chain above the block, each with the first block under it (its status line). */
  context: string[];
}

/** Paragraphs and list items, each with the headings (and their intro blocks) above it. */
function blocks(md: string): Block[] {
  const out: Block[] = [];
  const chain: { level: number; text: string; intro: string | null }[] = [];
  let cur: string[] = [];
  const flush = () => {
    const text = cur.join('\n').trim();
    cur = [];
    if (!text) return;
    const top = chain.at(-1);
    if (top && top.intro === null) top.intro = text;
    out.push({ text, context: chain.flatMap((h) => [h.text, h.intro ?? '']) });
  };
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{1,6}) (.*)/);
    if (h) {
      flush();
      const level = h[1]!.length;
      while (chain.length && chain.at(-1)!.level >= level) chain.pop();
      chain.push({ level, text: h[2]!, intro: null });
    } else if (!line.trim() || /^(\d+\.|-|\*) /.test(line)) {
      flush();
      cur.push(line);
    } else {
      cur.push(line);
    }
  }
  flush();
  return out;
}

test('a request that names code which no longer exists is marked resolved', () => {
  const src = sourceText();
  const dir = path.join(REPO, 'docs', 'requests');
  const stale: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    for (const b of blocks(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (DONE.test(b.text) || b.context.some((c) => DONE.test(c))) continue;
      for (const m of b.text.matchAll(CODE_NAME)) {
        const name = m[1]!.replace(/^\./, '');
        if (!src.includes(name)) stale.push(`${f}: \`${m[1]!}\` (in "${b.text.slice(0, 70).replace(/\n/g, ' ')}…")`);
      }
    }
  }
  assert.deepEqual(stale, [], 'mark the item resolved (the word "Resolved" in it or its heading), or update it');
});

test('the request-doc check catches a stale request and accepts a resolved one', () => {
  const md = [
    '# Requests',
    '',
    '## 1. A stopgap',
    'The screen keeps `NO_SUCH_TABLE_ANYWHERE` until the field exists.',
    '',
    '## 2. Resolved: another stopgap',
    'The screen kept `ALSO_NOT_IN_THE_CODE`.',
    '',
    '## 3. A group',
    '',
    '**Status: resolved.**',
    '',
    '### 3a',
    '- drop `.gone` and `.noSuchClassAnywhere`',
  ].join('\n');
  const flagged = blocks(md)
    .filter((b) => !DONE.test(b.text) && !b.context.some((c) => DONE.test(c)))
    .flatMap((b) => [...b.text.matchAll(CODE_NAME)].map((m) => m[1]));
  assert.deepEqual(flagged, ['NO_SUCH_TABLE_ANYWHERE']);
});
