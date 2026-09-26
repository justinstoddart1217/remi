// The Remi-only states and their approved baselines (`make test-harness`, node --test; no
// browser, no servers). A Remi-only state has no prototype to catch what it leaves out, so
// these checks keep the set complete and each reference whole:
//   - every app screen and every surface outside the app has an empty or Remi-only state
//     (arch-delivery-parity §2: each screen's empty state has an approved baseline);
//   - each approved baseline holds the whole page (a page taller than the viewport is captured
//     full page), and was captured with the state's current settings;
//   - each approved PNG is the one recorded in approvals.json.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { APPROVED_DIR, approvalStatus, readLedger, recordApproval, sha256File, signOff } from '../approvals.ts';
import { VIEWPORT } from '../drivers/common.ts';
import { SCREENS } from '../drivers/types.ts';
import { EMPTY_SCREENS, REMI_ONLY_SURFACES, STATES } from '../states.ts';

const REMI_ONLY = STATES.filter((s) => s.remiOnly);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR', `${file} is a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

interface ApprovedCapture {
  state: { id: string; surface: string; fullPage: boolean };
  viewport: { width: number; height: number };
  document: { width: number; height: number };
}

test('every app screen with an empty state has a Remi-only empty-<screen> state', () => {
  assert.deepEqual(
    EMPTY_SCREENS,
    SCREENS.filter((s) => s !== 'workspace'),
  );
  for (const screen of EMPTY_SCREENS) {
    const state = STATES.find((s) => s.id === `empty-${screen}`);
    assert.ok(state, `states.ts has empty-${screen}`);
    assert.equal(state.remiOnly, true, `empty-${screen} is Remi only`);
    assert.equal(state.surface, 'app', `empty-${screen} is an app state`);
  }
});

test('Home, the Textbook, the first run and Settings each have a Remi-only state', () => {
  assert.deepEqual([...REMI_ONLY_SURFACES].sort(), ['home', 'settings', 'setup', 'textbook']);
  for (const surface of REMI_ONLY_SURFACES) {
    assert.ok(
      REMI_ONLY.some((s) => s.surface === surface),
      `a Remi-only state on the ${surface} surface`,
    );
  }
  assert.ok(STATES.some((s) => s.id === 'empty-home' && s.remiOnly && s.surface === 'home'));
  assert.ok(STATES.some((s) => s.id === 'empty-textbook' && s.remiOnly && s.surface === 'textbook'));
});

test('the wizard is the first Remi-only state (the others run after setup, in order)', () => {
  assert.equal(REMI_ONLY[0]?.id, 'setup-wizard');
  assert.equal(REMI_ONLY[0]?.surface, 'setup');
  assert.equal(new Set(STATES.map((s) => s.id)).size, STATES.length, 'state ids are unique');
});

test('each Remi-only state has an approved baseline that holds the whole page', () => {
  for (const state of REMI_ONLY) {
    const png = path.join(APPROVED_DIR, `${state.id}.png`);
    const json = path.join(APPROVED_DIR, `${state.id}.json`);
    assert.ok(fs.existsSync(png) && fs.existsSync(json), `${state.id}: baselines/remi-approved/${state.id}.png and .json`);
    const cap = JSON.parse(fs.readFileSync(json, 'utf8')) as ApprovedCapture;
    assert.equal(cap.state.id, state.id);
    assert.equal(cap.state.surface, state.surface, `${state.id}: approved on the surface it has now`);
    assert.equal(cap.state.fullPage, !!state.fullPage, `${state.id}: approved with fullPage ${String(!!state.fullPage)}, as states.ts has it; re-approve`);
    assert.deepEqual(cap.viewport, VIEWPORT, `${state.id}: captured at 1920×1080`);
    assert.ok(cap.document.width <= VIEWPORT.width, `${state.id}: no sideways scroll (document ${String(cap.document.width)}px wide)`);
    if (!state.fullPage) {
      assert.ok(
        cap.document.height <= VIEWPORT.height,
        `${state.id}: the page is ${String(cap.document.height)}px tall but the baseline stops at ${String(VIEWPORT.height)}px; set fullPage`,
      );
    }
    const size = pngSize(png);
    assert.deepEqual(size, { width: VIEWPORT.width, height: state.fullPage ? cap.document.height : VIEWPORT.height }, `${state.id}: the PNG is the capture's size`);
  }
});

test('approvals.json records an approval for every approved PNG, and nothing else', () => {
  const ledger = readLedger();
  for (const state of REMI_ONLY) {
    const status = approvalStatus(state.id, ledger);
    assert.ok(
      status.kind === 'approved' || status.kind === 'signed-off',
      `${state.id}: ${status.kind === 'mismatch' ? 'the PNG is not the approved one' : 'no approval recorded'}; approve it with PARITY_APPROVE=1 PARITY_APPROVER=<who>`,
    );
    if (status.kind === 'approved' || status.kind === 'signed-off') {
      assert.ok(status.approval.approvedBy.trim(), `${state.id}: approved by someone`);
      assert.ok(!Number.isNaN(Date.parse(status.approval.approvedAt)), `${state.id}: approval time`);
    }
  }
  const ids = new Set(REMI_ONLY.map((s) => s.id));
  assert.deepEqual(Object.keys(ledger).filter((id) => !ids.has(id)), [], 'approvals for states that no longer exist');
  const files = fs.readdirSync(APPROVED_DIR).filter((f) => f.endsWith('.png') || (f.endsWith('.json') && f !== 'approvals.json'));
  assert.deepEqual(files.filter((f) => !ids.has(f.replace(/\.(png|json)$/, ''))), [], 'baselines for states that no longer exist');
});

test('approving clears a sign-off, and a sign-off needs the approved PNG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remi-approvals-'));
  const file = path.join(dir, 'approvals.json');
  const png = path.join(dir, 'settings.png');
  try {
    fs.writeFileSync(png, 'first');
    assert.throws(() => recordApproval('settings', '  ', { file, dir }), /needs a name/);
    recordApproval('settings', 'agent', { note: 'copy question open', file, dir, at: new Date('2026-09-25T10:00:00Z') });
    assert.equal(approvalStatus('settings', readLedger(file), dir).kind, 'approved');
    assert.equal(readLedger(file).settings?.note, 'copy question open');

    assert.throws(() => signOff('^settings$', '', { file, dir }), /needs the name/);
    assert.throws(() => signOff('^no-such-state$', 'Justin', { file, dir }), /no Remi-only state/);
    assert.deepEqual(signOff('^settings$', 'Justin', { file, dir }), ['settings']);
    assert.equal(approvalStatus('settings', readLedger(file), dir).kind, 'signed-off');

    fs.writeFileSync(png, 'second');
    assert.equal(approvalStatus('settings', readLedger(file), dir).kind, 'mismatch');
    assert.throws(() => signOff('^settings$', 'Justin', { file, dir }), /not the PNG that was approved/);

    recordApproval('settings', 'agent', { file, dir });
    const entry = readLedger(file).settings;
    assert.equal(entry?.png, sha256File(png));
    assert.equal(entry?.signedOffBy, undefined, 'a new approval drops the old sign-off');
    assert.equal(entry?.note, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
