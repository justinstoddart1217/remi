// globalSetup for a Remi run: start the backend (fresh data dir, the design or empty fixture),
// the frontend and the fake AI server, then hand their URLs to the workers through env vars.
// A run that includes the parity project takes the parity output lock first (servers.ts), and
// names its run (PARITY_RUN_ID, unless `make parity` already did for both of its invocations).

import { fixtureName, PORT_PAIR, selectedRemiProjects, serveMode } from './env.ts';
import { lockParityOutputs, startRemi, stopRemi, unlockParityOutputs } from './servers.ts';

export default async function globalSetup(): Promise<void> {
  const serve = serveMode();
  const fixture = fixtureName();
  const parity = selectedRemiProjects().includes('remi');
  process.env.REMI_PARITY_STARTED_AT = String(Date.now());
  process.env.PARITY_RUN_ID ??= new Date().toISOString();
  if (parity) {
    lockParityOutputs();
    process.env.REMI_PARITY_LOCKED = '1';
  }
  try {
    const run = await startRemi({ serve, fixture });
    process.env.REMI_PARITY_BASE_URL = run.baseURL;
    process.env.REMI_PARITY_SERVED_BY = run.servedBy;
    process.env.REMI_PARITY_FAKE_AI_URL = run.fakeAiUrl;
    if (run.buildError) process.env.REMI_PARITY_BUILD_ERROR = run.buildError;
    console.log(
      `[remi] ${fixture} fixture on ${PORT_PAIR}; frontend served by ${run.servedBy} at ${run.baseURL}` +
        (run.buildError ? ` (the production build failed, so Vite serves it; see .remi-run/${PORT_PAIR}/logs/build.log)` : ''),
    );
  } catch (e) {
    await stopRemi();
    if (parity) unlockParityOutputs();
    throw e;
  }
}
