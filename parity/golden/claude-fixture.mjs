// The stubbed window.claude reply used by the drawer-review-claude parity state, and replayed
// through applyUpdate() by the "claude-fixture-apply" scenario golden. Ids are prototype seed ids.

export const CLAUDE_FIXTURE_TEXT =
  'Finished parsing the security-level extract. They want FX attribution too, about 6h. ' +
  'Still waiting on the administrator for the last 4 funds, so confidence is down to 2. ' +
  'I can give ManCo 2h a day now. Push the playbook target to 8 Jan. Returns are done for today.';

export const CLAUDE_FIXTURE_REPLY = {
  summary:
    'You finished parsing the extract and added FX attribution to the returns pipeline. ManCo moves to 2h a day, the playbook target moves to Fri 8 Jan, and today’s returns run is done.',
  changes: [
    { type: 'task_done', project_id: 'ret', task_id: 'ret-2' },
    { type: 'scope_add', project_id: 'ret', text: 'FX attribution', hours: 6 },
    { type: 'blocker', project_id: 'ret', text: 'Administrator files for the last 4 funds' },
    { type: 'confidence', project_id: 'ret', value: 2 },
    { type: 'hours_per_day', project_id: 'manco', value: 2 },
    { type: 'note', project_id: 'manco', text: 'Moving to 2h a day to protect the November pack.' },
    { type: 'target_move', project_id: 'play', date: '2027-01-08' },
    { type: 'bau_done', routine_id: 'r-ret' },
  ],
  unplaced: ['the team lunch on Friday'],
};

/** What window.claude.complete() resolves to: prose around the JSON, as a model would reply. */
export const CLAUDE_FIXTURE_RAW = 'Here is the plan.\n' + JSON.stringify(CLAUDE_FIXTURE_REPLY) + '\n';

/** A reply with no JSON object: CheckIn shows its error phase ("Remi replied without a plan."). */
export const CLAUDE_ERROR_RAW = 'Sorry, I could not work out a plan from that.';
