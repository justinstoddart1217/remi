// globalTeardown for a Remi run: stop the fake AI server, the frontend and the backend, and
// delete the temporary data dir (logs stay in .remi-run/<api>-<web>/logs). After a parity run,
// rewrite docs/parity-report.md from every result on disk (rows from other runs marked stale),
// then release the parity output lock.

import fs from 'node:fs';
import path from 'node:path';

import { RESULTS_DIR, writeReport } from '../report.ts';
import { stopRemi, unlockParityOutputs } from './servers.ts';

function resultsWrittenSince(ms: number): boolean {
  if (!fs.existsSync(RESULTS_DIR)) return false;
  return fs.readdirSync(RESULTS_DIR).some((f) => fs.statSync(path.join(RESULTS_DIR, f)).mtimeMs >= ms);
}

export default async function globalTeardown(): Promise<void> {
  try {
    const started = Number(process.env.REMI_PARITY_STARTED_AT ?? Date.now());
    if (process.env.REMI_PARITY_LOCKED === '1' && resultsWrittenSince(started)) {
      const out = writeReport({ runId: process.env.PARITY_RUN_ID });
      console.log(
        `[remi] docs/parity-report.md: ${String(out.states)} states in run ${process.env.PARITY_RUN_ID ?? '?'} ` +
          `(Tier A ${String(out.tierA)}, Tier B ${String(out.tierB)} passing; ${String(out.stale)} stale rows not counted)`,
      );
    }
  } finally {
    await stopRemi();
    if (process.env.REMI_PARITY_LOCKED === '1') unlockParityOutputs();
  }
}
