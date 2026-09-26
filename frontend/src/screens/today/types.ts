/** Contract types the Today screen reads (short names over the generated schema). */

import type { Schemas } from '../../api';

export type {
  DayLoadOut,
  DayOut,
  MonthSnapshotOut,
  ProjectOut,
  RoutineOut,
  RoutineRuleOut,
  VerdictState,
} from '../../api';

export type BauRowOut = Schemas['BauRowOut'];
export type BauChecklistItemOut = Schemas['BauChecklistItemOut'];
export type FocusBlockOut = Schemas['FocusBlockOut'];
export type FocusTaskOut = Schemas['FocusTaskOut'];
export type NextRunOut = Schemas['NextRunOut'];
export type MonthSnapshotRowOut = Schemas['MonthSnapshotRowOut'];
export type MonthSnapshotBarOut = Schemas['MonthSnapshotBarOut'];
