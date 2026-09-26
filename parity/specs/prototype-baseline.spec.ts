// Captures the prototype baselines: for every state in states.ts, a PNG and a JSON dump of the
// normalised innerText and boxes of every [data-screen-label] region, into baselines/prototype/.
// Run with `make parity-baseline` (or `npm run baseline` in parity/). Offline: every external
// request is answered by vendor-routes.ts, and the test fails if anything was not.

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { captureRegions, FIXED_NOW, HARNESS_NOISE } from '../drivers/common.ts';
import { prototypeDrivers, tagPrototypeAnchors } from '../drivers/prototype.ts';
import { PROTOTYPE_STATES, reachState } from '../states.ts';
import { installVendorRoutes, PARITY_DIR, verifyVendorIntegrity } from '../vendor-routes.ts';

const OUT_DIR = path.join(PARITY_DIR, 'baselines', 'prototype');

test.beforeAll(() => {
  verifyVendorIntegrity();
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const state of PROTOTYPE_STATES) {
  test(state.id, async ({ page, context, browser }) => {
    const vendor = await installVendorRoutes(context);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const harnessNoise: string[] = [];
    page.on('pageerror', (e) => (HARNESS_NOISE.test(String(e)) ? harnessNoise : pageErrors).push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    const drivers = prototypeDrivers(page);
    await reachState(drivers, state);

    const png = path.join(OUT_DIR, `${state.id}.png`);
    await page.screenshot({ path: png, fullPage: !!state.fullPage, animations: 'disabled', caret: 'hide' });
    await tagPrototypeAnchors(page);
    const capture = await captureRegions(page);

    const record = {
      state: { id: state.id, surface: state.surface, about: state.about, claude: state.claude ?? 'none', fullPage: !!state.fullPage, maxDiffRatio: state.maxDiffRatio },
      app: 'prototype',
      capturedWith: {
        browser: `chromium ${browser.version()}`,
        clock: FIXED_NOW.toISOString(),
        timezone: 'Europe/London',
        locale: 'en-GB',
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      },
      screenshot: path.basename(png),
      ...capture,
      vendor: { served: [...new Set(vendor.served)].sort(), blocked: vendor.blocked },
      pageErrors,
      consoleErrors,
      harnessNoise: [...new Set(harnessNoise)],
    };
    fs.writeFileSync(path.join(OUT_DIR, `${state.id}.json`), JSON.stringify(record, null, 2) + '\n');

    expect(vendor.blocked, 'external requests with no local mapping').toEqual([]);
    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(capture.regions.length, 'labelled regions captured').toBeGreaterThan(0);
  });
}
