// Parity harness config. Both apps run in the same bundled Chromium with identical context
// options (docs/design-spec/arch-delivery-parity.md section 3). The clock is pinned per page by
// the drivers (page.clock.setFixedTime), because Playwright has no config-level clock.
//
// One invocation drives one app:
//   prototype run (default)   the design folder on an http.server; project "prototype"
//   Remi run                  PARITY_TARGET=remi, or --project=remi|behaviour|egress. globalSetup
//                             starts the backend (REMI_ENV=test, REMI_TODAY=2026-10-05, a fresh
//                             data dir, the design or empty fixture) and the frontend (Vite, or a
//                             fresh production build for egress); globalTeardown stops both.
//                             See remi/env.ts and remi/servers.ts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

import { isRemiRun, PORT_PAIR, WEB_URL } from './remi/env.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PROTOTYPE_PORT = Number(process.env.PARITY_PROTOTYPE_PORT ?? 4800);
export const PROTOTYPE_URL = `http://127.0.0.1:${String(PROTOTYPE_PORT)}`;

const REMI = isRemiRun();
/**
 * Playwright empties its output folder when a run starts, so each port pair (and the prototype)
 * writes its own: a run on other ports never deletes this run's traces.
 */
const OUT = REMI ? `remi-${PORT_PAIR}` : 'prototype';

/** The context options both apps share (arch-delivery-parity §3). */
const SHARED_USE: PlaywrightTestConfig['use'] = {
  browserName: 'chromium',
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  colorScheme: 'light',
  locale: 'en-GB',
  timezoneId: 'Europe/London',
  serviceWorkers: 'block',
  trace: 'retain-on-failure',
};

const prototypeProjects: PlaywrightTestConfig['projects'] = [
  {
    name: 'prototype',
    testMatch: ['prototype-*.spec.ts', 'golden-*.spec.ts'],
    use: { baseURL: PROTOTYPE_URL },
  },
];

// The drivers build absolute URLs from REMI_PARITY_BASE_URL (set by globalSetup, which may pick
// the backend-served build); baseURL is only the default for ad hoc page.goto('/...') calls.
// Interactions are bounded so a control that does not exist yet fails its state or flow in
// seconds instead of running into the test timeout.
const REMI_USE: PlaywrightTestConfig['use'] = { baseURL: WEB_URL, actionTimeout: 10_000, navigationTimeout: 30_000 };
const remiProjects: PlaywrightTestConfig['projects'] = [
  { name: 'remi', testMatch: ['parity.spec.ts'], use: REMI_USE },
  { name: 'behaviour', testMatch: ['behaviour.spec.ts'], fullyParallel: false, use: REMI_USE },
  { name: 'egress', testMatch: ['egress.spec.ts'], use: REMI_USE },
];

export default defineConfig({
  testDir: path.join(HERE, 'specs'),
  outputDir: path.join(HERE, 'test-results', OUT),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.PARITY_WORKERS ? Number(process.env.PARITY_WORKERS) : 4,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: path.join(HERE, 'playwright-report', OUT), open: 'never' }]],
  use: SHARED_USE,
  projects: REMI ? remiProjects : prototypeProjects,
  ...(REMI
    ? {
        globalSetup: path.join(HERE, 'remi', 'global-setup.ts'),
        globalTeardown: path.join(HERE, 'remi', 'global-teardown.ts'),
      }
    : {
        webServer: [
          {
            // The design folder is served read-only; sibling .dc.html files cannot load over file://.
            command: `python3 -m http.server ${String(PROTOTYPE_PORT)} --bind 127.0.0.1 --directory "../Remi Dashboard Design Review"`,
            cwd: HERE,
            url: `${PROTOTYPE_URL}/Remi.dc.html`,
            reuseExistingServer: !process.env.CI,
            stdout: 'ignore',
            stderr: 'ignore',
            timeout: 30_000,
          },
        ],
      }),
});
