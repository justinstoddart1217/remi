/**
 * Short names for the contract's schemas (generated `schema.d.ts`), so screens import
 * `PlanOut` instead of spelling `components['schemas']['PlanOut']`.
 */

import type { Schemas } from './client';

// Read models
export type PlanOut = Schemas['PlanOut'];
export type TodayOut = Schemas['TodayOut'];
export type SettingsOut = Schemas['SettingsOut'];
export type CalendarOut = Schemas['CalendarOut'];
export type CalendarDayOut = Schemas['CalendarDayOut'];
export type DayLoadOut = Schemas['DayLoadOut'];
export type DayLoadItemOut = Schemas['DayLoadItemOut'];
export type LoadsOut = Schemas['LoadsOut'];
export type ProjectOut = Schemas['ProjectOut'];
export type ProjectDerivedOut = Schemas['ProjectDerivedOut'];
export type ProjectDomain = ProjectOut['domain'];
export type MilestoneOut = Schemas['MilestoneOut'];
export type DerivedMilestoneOut = Schemas['DerivedMilestoneOut'];
export type TaskOut = Schemas['TaskOut'];
export type CharterItemOut = Schemas['CharterItemOut'];
export type CharterList = CharterItemOut['list'];
export type ReadinessItemOut = Schemas['ReadinessItemOut'];
export type RoutineOut = Schemas['RoutineOut'];
export type RoutineRuleOut = Schemas['RoutineRuleOut'];
export type RoutineRunOut = Schemas['RoutineRunOut'];
export type RoutineChecklistItemOut = Schemas['RoutineChecklistItemOut'];
export type OccurrenceOut = Schemas['OccurrenceOut'];
export type RotationOut = Schemas['RotationOut'];
export type RotationSegmentOut = Schemas['RotationSegmentOut'];
export type MoveOut = Schemas['MoveOut'];
export type VerdictOut = Schemas['VerdictOut'];
export type VerdictState = VerdictOut['state'];
export type FlagsOut = Schemas['FlagsOut'];
export type CountsOut = Schemas['CountsOut'];
export type AliasOut = Schemas['AliasOut'];
export type DayOut = Schemas['DayOut'];
export type MonthSnapshotOut = Schemas['MonthSnapshotOut'];
export type HomeOut = Schemas['HomeOut'];
export type ProjectSnapshotOut = Schemas['ProjectSnapshotOut'];
export type SetupStatusOut = Schemas['SetupStatusOut'];
export type CountdownOut = Schemas['CountdownOut'];
export type AiStatusOut = Schemas['AiStatusOut'];
export type AiAuditPageOut = Schemas['AiAuditPageOut'];
export type HolidayOut = Schemas['HolidayOut'];
export type LeaveDayOut = Schemas['LeaveDayOut'];
export type FeedPageOut = Schemas['FeedPageOut'];
export type EventPageOut = Schemas['EventPageOut'];
export type HealthOut = Schemas['HealthOut'];

// Notes
export type NoteOut = Schemas['NoteOut'];
export type NoteDaysOut = Schemas['NoteDaysOut'];
export type NoteListOut = Schemas['NoteListOut'];
export type RecentNotesOut = Schemas['RecentNotesOut'];
export type DayTextOut = Schemas['DayTextOut'];
export type TagPreviewOut = Schemas['TagPreviewOut'];

// Textbook
export type TextbookTreeOut = Schemas['TextbookTreeOut'];
export type TextbookHomeOut = Schemas['TextbookHomeOut'];
export type TextbookSearchOut = Schemas['TextbookSearchOut'];
export type PageOut = Schemas['PageOut'];
export type PageSummaryOut = Schemas['PageSummaryOut'];
export type PageCreatedOut = Schemas['PageCreatedOut'];
export type PageDeletedOut = Schemas['PageDeletedOut'];
export type PageSavedOut = Schemas['PageSavedOut'];
export type SectionOut = Schemas['SectionOut'];
export type ChartUploadOut = Schemas['ChartUploadOut'];
export type TextbookBlock = Schemas['BlocksPut']['blocks'][number];

// Check-ins
export type CheckinChange = Schemas['PreviewRequest']['changes'][number];
export type CheckinChangeType = CheckinChange['type'];
export type ProposalOut = Schemas['ProposalOut'];
export type PreviewOut = Schemas['PreviewOut'];
export type ProjectPreviewOut = Schemas['ProjectPreviewOut'];
export type ApplyRequest = Schemas['ApplyRequest'];
export type ReplanIn = Schemas['ReplanIn'];
export type ReplanPreviewOut = Schemas['ReplanPreviewOut'];

// Mutations
export type Movement = Schemas['Movement'];
export type MutationOut = Schemas['MutationOut'];
/** Any mutation answer that carries the plan (`MutationOut` and the typed `…MutationOut`s). */
export interface PlanMutationOut {
  plan: PlanOut;
  movements: Movement[];
}

/**
 * `T` with the keys `K` optional. The generated request types mark fields that have a server
 * default as required; hooks take them optionally and fill in the same default.
 */
export type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
