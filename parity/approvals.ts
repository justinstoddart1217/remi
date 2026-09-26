// Who approved each Remi-only baseline, and whether a person has signed it off
// (baselines/remi-approved/approvals.json, committed with the PNGs).
//
// A Remi-only state (the first-run wizard, the empty states, Settings) has no prototype to be
// compared against, so its reference is a Remi capture that someone looked at and accepted.
// Two steps, recorded here against the sha256 of the approved PNG:
//   1. Approve: `make parity STATE=<id> PARITY_APPROVE=1 PARITY_APPROVER="<who>"` copies the
//      capture into baselines/remi-approved/ and records who approved it and when. An agent may
//      do this after looking at the capture; it drops any earlier sign-off (the picture changed).
//   2. Sign off: a person looks at the approved PNG and runs
//      `make parity-confirm STATE=<regex> BY="<name>"` (`node approvals.ts confirm <regex> <name>`),
//      which records their sign-off for that same sha256.
// specs/parity.spec.ts fails a Remi-only state whose PNG has no matching approval;
// tests/states.test.ts checks the committed ledger; docs/parity-report.md lists the sign-offs
// still pending.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATES } from './states.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APPROVED_DIR = path.join(HERE, 'baselines', 'remi-approved');
export const LEDGER = path.join(APPROVED_DIR, 'approvals.json');

export interface Approval {
  /** sha256 (hex) of the approved PNG. */
  png: string;
  approvedBy: string;
  /** ISO time. */
  approvedAt: string;
  /** What the approver saw that still needs work (PARITY_APPROVAL_NOTE), e.g. a copy question. */
  note?: string;
  /** A person's sign-off of this same PNG. */
  signedOffBy?: string;
  signedOffAt?: string;
}

export type Ledger = Record<string, Approval>;

export type ApprovalStatus =
  | { kind: 'none' }
  | { kind: 'mismatch'; approval: Approval; png: string }
  | { kind: 'approved'; approval: Approval }
  | { kind: 'signed-off'; approval: Approval };

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readLedger(file = LEDGER): Ledger {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger;
}

/** Written in states.ts order, so a diff shows only the states that changed. */
export function writeLedger(ledger: Ledger, file = LEDGER): void {
  const order = STATES.map((s) => s.id);
  const ids = Object.keys(ledger).sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9) || a.localeCompare(b));
  const out: Ledger = {};
  for (const id of ids) out[id] = ledger[id]!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

/** Where a state's approved PNG stands against the ledger. */
export function approvalStatus(id: string, ledger: Ledger = readLedger(), dir = APPROVED_DIR): ApprovalStatus {
  const approval = ledger[id];
  const pngFile = path.join(dir, `${id}.png`);
  if (!approval || !fs.existsSync(pngFile)) return { kind: 'none' };
  const png = sha256File(pngFile);
  if (png !== approval.png) return { kind: 'mismatch', approval, png };
  return approval.signedOffBy ? { kind: 'signed-off', approval } : { kind: 'approved', approval };
}

/** Step 1: the PNG now in baselines/remi-approved/<id>.png is approved by `by` (sign-off cleared). */
export function recordApproval(id: string, by: string, opts: { note?: string; at?: Date; file?: string; dir?: string } = {}): Approval {
  const { at = new Date(), file = LEDGER, dir = APPROVED_DIR } = opts;
  const who = by.trim();
  if (!who) throw new Error('an approval needs a name: set PARITY_APPROVER="<who looked at the capture>"');
  const ledger = readLedger(file);
  const note = opts.note?.trim();
  const approval: Approval = { png: sha256File(path.join(dir, `${id}.png`)), approvedBy: who, approvedAt: at.toISOString(), ...(note ? { note } : {}) };
  ledger[id] = approval;
  writeLedger(ledger, file);
  return approval;
}

/**
 * Step 2: a person signs off every Remi-only state whose id matches `pattern` (a regex, as
 * STATE= is for `make parity`). Refuses a state whose PNG is not the approved one.
 */
export function signOff(pattern: string, by: string, opts: { at?: Date; file?: string; dir?: string } = {}): string[] {
  const { at = new Date(), file = LEDGER, dir = APPROVED_DIR } = opts;
  const who = by.trim();
  if (!who) throw new Error('a sign-off needs the name of the person who looked at the baselines: BY="<name>"');
  const re = new RegExp(pattern);
  const ids = STATES.filter((s) => s.remiOnly && re.test(s.id)).map((s) => s.id);
  if (!ids.length) throw new Error(`no Remi-only state matches ${pattern}`);
  const ledger = readLedger(file);
  for (const id of ids) {
    const status = approvalStatus(id, ledger, dir);
    if (status.kind === 'none') throw new Error(`${id} has no approved baseline to sign off (approve it first with PARITY_APPROVE=1)`);
    if (status.kind === 'mismatch') throw new Error(`${id}.png is not the PNG that was approved; re-approve it before signing off`);
  }
  for (const id of ids) ledger[id] = { ...ledger[id]!, signedOffBy: who, signedOffAt: at.toISOString() };
  writeLedger(ledger, file);
  return ids;
}

function main(argv: string[]): number {
  const [cmd, pattern, ...rest] = argv;
  if (cmd === 'confirm' && pattern) {
    const ids = signOff(pattern, rest.join(' '));
    console.log(`Signed off by ${rest.join(' ').trim()}: ${ids.join(', ')}`);
    return 0;
  }
  if (cmd === 'status') {
    const ledger = readLedger();
    for (const s of STATES.filter((x) => x.remiOnly)) {
      const st = approvalStatus(s.id, ledger);
      const line =
        st.kind === 'none'
          ? 'no approved baseline'
          : st.kind === 'mismatch'
            ? `PNG differs from the one ${st.approval.approvedBy} approved`
            : `approved by ${st.approval.approvedBy} (${st.approval.approvedAt.slice(0, 10)}); ` +
              (st.kind === 'signed-off' ? `signed off by ${st.approval.signedOffBy!} (${st.approval.signedOffAt!.slice(0, 10)})` : 'sign-off pending') +
              (st.approval.note ? `\n${' '.repeat(19)}note: ${st.approval.note}` : '');
      console.log(`${s.id.padEnd(18)} ${line}`);
    }
    return 0;
  }
  console.error('usage: node approvals.ts status | node approvals.ts confirm <state regex> <your name>');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
