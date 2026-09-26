// @vitest-environment node
/**
 * Every animation a component's CSS Module names must resolve to real keyframes.
 *
 * CSS Modules hash bare keyframe names (`animation: remi-pulse …` becomes `_remi-pulse_x1y2z_1`),
 * so a module that uses a keyframe from styles/keyframes.css must write `global(remi-pulse)`.
 * A wrong name fails silently in the browser, and the reduced-motion visual check cannot see it,
 * so this compiles each module with the project's Vite config and checks the output.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preprocessCSS, resolveConfig } from 'vite';
import type { ResolvedConfig } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const ROOT = join(SRC, '..');
const MODULE_DIRS = [join(SRC, 'components'), join(SRC, 'screens', 'foundations')];

const NON_NAME = new Set([
  'none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused',
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
  'initial', 'inherit', 'unset', 'revert', 'revert-layer',
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return d.name.endsWith('.module.css') ? [p] : [];
  });
}

function keyframeNames(css: string): Set<string> {
  return new Set([...css.matchAll(/@keyframes\s+([-\w]+)/g)].map((m) => m[1] ?? ''));
}

/** Strips functions (var(), cubic-bezier(), steps()) so their arguments are not read as names. */
function stripFunctions(v: string): string {
  let out = v;
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/[-\w]*\([^()]*\)/g, ' ');
  }
  return out;
}

/** The keyframe names used by `animation` and `animation-name` declarations. */
function animationNames(css: string): string[] {
  const names: string[] = [];
  for (const m of css.matchAll(/(?:^|[;{\s])animation(-name)?\s*:\s*([^;}]+)/g)) {
    const isNameOnly = m[1] !== undefined;
    for (const layer of stripFunctions(m[2] ?? '').split(',')) {
      const idents = layer
        .trim()
        .split(/\s+/)
        .filter((t) => t && !NON_NAME.has(t) && !/^[-+.\d]/.test(t) && !t.startsWith('!'));
      if (isNameOnly || idents.length) names.push(...idents);
    }
  }
  return names;
}

const GLOBAL_KEYFRAMES = keyframeNames(readFileSync(join(SRC, 'styles', 'keyframes.css'), 'utf8'));
const FILES = MODULE_DIRS.flatMap(walk);

let config: ResolvedConfig;
beforeAll(async () => {
  config = await resolveConfig({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'silent' }, 'serve');
});

describe('animationNames', () => {
  it('reads the name from shorthands and skips timing, var() and keywords', () => {
    expect(animationNames('.a{animation: remi-pulse 600ms var(--ease-out) 1;}')).toEqual(['remi-pulse']);
    expect(animationNames('.a{animation: 1s cubic-bezier(.2,0,0,1) infinite both spin, fade 2s;}')).toEqual([
      'spin',
      'fade',
    ]);
    expect(animationNames('.a{animation: none;} .b{animation-name: _x_abc_1;}')).toEqual(['_x_abc_1']);
    expect(animationNames('.a{animation-delay: 80ms; animation-duration: 1s}')).toEqual([]);
  });
});

describe('CSS Module animations resolve to defined keyframes', () => {
  it('finds the global keyframes', () => {
    expect(GLOBAL_KEYFRAMES.has('remi-pulse')).toBe(true);
  });

  it.each(FILES.map((f) => [relative(SRC, f), f]))('%s', async (_label, file) => {
    const { code } = await preprocessCSS(readFileSync(file, 'utf8'), file, config);
    const local = keyframeNames(code);
    for (const name of animationNames(code)) {
      expect(GLOBAL_KEYFRAMES.has(name) || local.has(name), `animation name "${name}" has no @keyframes`).toBe(true);
    }
  });

  it('the CapacityBar overload ring plays the global remi-pulse', async () => {
    const file = join(SRC, 'components', 'CapacityBar', 'CapacityBar.module.css');
    const { code } = await preprocessCSS(readFileSync(file, 'utf8'), file, config);
    expect(animationNames(code)).toContain('remi-pulse');
  });
});
