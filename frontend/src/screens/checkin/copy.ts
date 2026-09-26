/**
 * Tell Remi copy, verbatim from CheckIn.dc.html and the critique (Check-in drawer section).
 */

import type { CheckinChangeType } from '../../api';

export const TITLE = 'Tell Remi';
export const SUBTITLE = 'Say what happened in your own words. Remi works out what to change and shows you before anything moves.';
export const CLOSE_TITLE = 'Close (esc)';
export const CLEAR_FOCUS_TITLE = 'Not just this project';
export const NO_FOCUS = 'About anything: mention projects or routines by name';

/** CheckIn.dc.html:28 (crit :72). */
export const PLACEHOLDER =
  'e.g. Finished mapping the last four funds and the FX share classes. The administrator now wants FX attribution too, probably 6h. Still waiting on the security-level extract, so confidence is a 3. ManCo: sent the NAV bridge spec to Finance. Returns BAU is done for today.';

/** The "Remi can" list (CheckIn.dc.html:147-154). */
export const CAPS: readonly { k: string; v: string }[] = [
  { k: 'Tick things off', v: '“Finished the FX share classes.”' },
  { k: 'Log new scope', v: '“They want FX attribution too, about 6h.”' },
  { k: 'Note blockers', v: '“Still waiting on the admin extract.”' },
  { k: 'Move dates', v: '“Push the playbook target to 8 Jan.”' },
  { k: 'Change your time', v: '“I can give ManCo 2h a day now.”' },
  { k: 'Close BAU runs', v: '“Returns are done for today.”' },
];

export const CAPS_LABEL = 'Remi can';
export const CAPS_NOTE = "You review every change before it's applied. Nothing is lost if Remi gets it wrong.";

export const SEND_LABEL = 'Send to Remi';
export const SHORTCUT = '⌘↵';

export const HINT_REVIEW = 'Change the text and send again if Remi missed something.';
export const HINT_EMPTY = 'Write it the way you would tell a colleague.';

export const THINKING_LABEL = 'Reading your update';
export const THINKING_NOTE = 'a few seconds';

export const REVIEW_LABEL = 'Remi will change';
export const SIMPLE_NOTE = 'simple reading';
export const SUMMARY_FALLBACK = 'Here is what Remi picked out.';
export const BAU_GROUP = 'BAU · today';
export const UNPLACED_LABEL = 'Not sure where these go';
export const UNPLACED_HINT = 'Name the project in your update and send it again to place these.';
export const NOTHING_FOUND = 'Remi didn’t find anything to change. Try naming a project, a task, hours or a date.';

export const ERROR_TITLE = 'Remi couldn’t read that just now';
export const TRY_AGAIN = 'Try again';
export const USE_SIMPLE = 'Use a simple reading';

export const FOOT_REVIEW = 'Untick anything Remi got wrong. Applying updates forecasts, the timeline and Today.';
export const FOOT_THINKING = 'Nothing changes until you apply.';
export const FOOT_OTHER = 'Nothing changes until you review and apply.';

export const EDIT_UPDATE = 'Edit update';
export const CANCEL = 'Cancel';
export const NOTHING_SELECTED = 'Nothing selected';

/** Shown when apply fails; the drawer reopens in review (arch-frontend-screens §3). */
export const APPLY_FAILED = 'Couldn’t apply that. Your update is still here.';

/** The review row KIND labels (CheckIn.dc.html:267). */
export const KIND: Readonly<Record<CheckinChangeType, string>> = {
  task_done: 'Tick off',
  task_add: 'New task',
  scope_add: 'New scope',
  blocker: 'Blocker',
  confidence: 'Confidence',
  target_move: 'Target',
  hours_per_day: 'Hours a day',
  note: 'Note',
  bau_done: 'BAU done',
};

/** The error panel's text (CheckIn.dc.html:250). */
export function errorText(message: string): string {
  return `The assistant didn’t answer cleanly (${message}). Try again, or use a simple reading that picks out hours, blockers and names.`;
}
