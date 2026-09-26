// Realistic check-in updates for the "simple reading" golden (CheckIn.dc.html simple(text)).
//
// focus is the drawer's focus project (the pid the drawer was opened with), or null when the
// drawer was opened from the header. It matters: sentences that name no project fall back to it.
// The first entry is the parity harness's drawer-review text (arch-delivery-parity section 3).

export const SIMPLE_READER_CORPUS = [
  { id: 'harness-review', focus: null, text: '+6h returns, blocked on data access' },
  { id: 'fx-attribution-scope', focus: 'ret', text: 'They want FX attribution too, about 6h.' },
  { id: 'waiting-admin-extract', focus: 'ret', text: 'Still waiting on the admin extract.' },
  { id: 'push-playbook-target', focus: null, text: 'Push the playbook target to 8 Jan.' },
  { id: 'manco-hours-a-day', focus: null, text: 'I can give ManCo 2h a day now.' },
  { id: 'returns-bau-done', focus: null, text: 'Returns are done for today.' },
  { id: 'fx-share-classes-finished', focus: 'ret', text: 'Finished the FX share classes.' },
  { id: 'nav-bridge-spec-sent', focus: null, text: 'Sent the NAV bridge spec to Finance.' },
  { id: 'extract-parsed', focus: 'ret', text: 'Parsed and validated the extract, all done.' },
  { id: 'pipeline-confidence-2', focus: null, text: 'Confidence is 2 on the pipeline now.' },
  { id: 'playbook-slow-confidence', focus: null, text: 'The playbook is going slowly. Confidence at 3.' },
  { id: 'nav-bridge-blocked', focus: null, text: 'Blocked by Finance sign-off on the NAV bridge.' },
  { id: 'entitlements-approved', focus: null, text: 'Entitlement forms submitted and approved.' },
  { id: 'entitlements-done', focus: null, text: 'Submitted the entitlement forms, done.' },
  { id: 'curve-sources-wrapped', focus: null, text: 'Wrapped up agreeing the curve data sources with the FI desk.' },
  { id: 'alpha-can-wait', focus: null, text: 'Alpha engine signal research can wait until January.' },
  { id: 'unrelated-chat', focus: null, text: 'Had a good chat with the team about lunch.' },
  { id: 'bd3-run-recorded', focus: 'play', text: 'Recorded the October BD3 run step by step, done.' },
  { id: 'successor-walkthrough-scope', focus: null, text: 'The successor wants a walkthrough of the scheduler too, about 3 hours.' },
  { id: 'attribution-extra-4h', focus: null, text: 'Security-level attribution needs an extra 4h for FX.' },
  {
    id: 'manco-two-sentences',
    focus: null,
    text: 'ManCo exposure tables are taking longer; waiting for source access. Confidence now 3.',
  },
  { id: 'returns-run-done', focus: null, text: 'Returns run done, all 12 funds.' },
  { id: 'pipeline-4h-a-day', focus: null, text: 'I can give the pipeline 4 hours a day from Monday.' },
  { id: 'onboarding-stuck', focus: null, text: 'Onboarding: data access still stuck with IT.' },
  { id: 'source-files-mapped', focus: 'ret', text: 'Mapped source files for the last 4 funds, finished.' },
  {
    id: 'cash-bridge-scope',
    focus: null,
    text: 'New request from Finance: add a cash bridge to the ManCo pack, roughly 5h.',
  },
  {
    id: 'september-reconciled',
    focus: 'ret',
    text: 'Reconciled September to administrator NAVs. Everything ties out.',
  },
  {
    id: 'performance-section-done',
    focus: 'manco',
    text: 'Templated the performance section and tested the build against the September pack, both done.',
  },
  { id: 'dry-run-booked', focus: 'fion', text: 'Dry run for day one booked for 17 Dec.' },
  {
    id: 'multi-line',
    focus: null,
    text: 'Pipeline: engine now reconciles 11 of 12 funds.\nPlaybook: outline drafted.\nReturns are done for today.',
  },
  { id: 'confidence-unchanged', focus: null, text: 'Target for the playbook moves to 8 January; confidence is 4.' },
  {
    id: 'mixed-focus-fallback',
    focus: 'manco',
    text: 'Exposure tables from source are half done. They also asked for a pipeline section, about 1.5h. Stuck on the NAV bridge sign-off.',
  },
  { id: 'empty', focus: 'manco', text: '   ' },
];
