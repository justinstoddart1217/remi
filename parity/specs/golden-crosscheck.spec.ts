// Proves golden/extract.mjs is faithful: the live prototype's buildModel(), run in Chromium with
// the same pinned clock, must produce exactly the golden files the Node extraction wrote, and
// CheckIn's simple(text) in the page must read the corpus exactly as simple_reader.json says.

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { prototypeDrivers } from '../drivers/prototype.ts';
import { SIMPLE_READER_CORPUS } from '../golden/corpus.mjs';
import { goldenFromModel, MODEL_GOLDEN_FILES } from '../golden/model-golden.mjs';
import { installVendorRoutes, PARITY_DIR } from '../vendor-routes.ts';

const GOLDEN_DIR = path.join(PARITY_DIR, '..', 'backend', 'remi', 'tests', 'golden');
const readGolden = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8'));

test.describe('golden cross-check (browser vs Node)', () => {
  test.beforeEach(async ({ context, page }) => {
    await installVendorRoutes(context);
    await prototypeDrivers(page).app.boot();
  });

  test('buildModel() equals the Node extraction', async ({ page }) => {
    const browser = await page.evaluate((src) => {
      const fn = new Function(`return (${src});`)() as (m: unknown) => Record<string, unknown>;
      return fn((window as unknown as { __remi: { buildModel(): unknown } }).__remi.buildModel());
    }, goldenFromModel.toString());
    for (const [section, file] of Object.entries(MODEL_GOLDEN_FILES)) {
      expect(browser[section], `${file} (section ${section})`).toEqual(readGolden(file));
    }
  });

  test('CheckIn simple(text) equals simple_reader.json', async ({ page }) => {
    const results = await page.evaluate((corpus) => {
      type CheckIn = { state: Record<string, unknown>; simple(text: string): unknown };
      const ci = (window as unknown as { __parity: { dc(name: string): CheckIn | null } }).__parity.dc('CheckIn');
      if (!ci) throw new Error('CheckIn not mounted');
      return corpus.map((e) => {
        const saved = ci.state;
        ci.state = { ...saved, focus: e.focus };
        try {
          return ci.simple(e.text);
        } finally {
          ci.state = saved;
        }
      });
    }, SIMPLE_READER_CORPUS);
    const golden = readGolden('simple_reader.json') as { cases: { id: string; result: unknown }[] };
    expect(results).toEqual(golden.cases.map((c) => c.result));
  });
});
