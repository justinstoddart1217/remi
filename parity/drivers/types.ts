// The driver interface shared by the prototype (drivers/prototype.ts) and the production app
// (drivers/remi.ts). states.ts is written only against these interfaces, so every state can be
// replayed on both apps. Days are ISO dates (YYYY-MM-DD); ids are the prototype seed ids.

import type { Page } from '@playwright/test';

/** The planning app's screens (a runtime list, so states.ts can check it covers each one). */
export const SCREENS = ['today', 'notes', 'timeline', 'calendar', 'projects', 'workspace', 'routines', 'transition'] as const;
export type Screen = (typeof SCREENS)[number];

/**
 * What window.claude does in the prototype (the Remi driver maps these to its AI provider stub):
 *   none     no window.claude: CheckIn falls back to the simple reading on send
 *   fixture  complete() resolves to golden/claude-fixture.mjs CLAUDE_FIXTURE_RAW
 *   error    complete() resolves to prose with no JSON: CheckIn's error phase
 *   pending  complete() never resolves: CheckIn stays in its thinking phase
 */
export type ClaudeStub = 'none' | 'fixture' | 'error' | 'pending';

export interface BootOptions {
  claude?: ClaudeStub;
}

/** The planning app: the Remi.dc.html shell in the prototype, /app/* in Remi. */
export interface AppDriver {
  readonly page: Page;
  boot(opts?: BootOptions): Promise<void>;
  /** Waits for fonts, no streaming placeholders, settled animations, then two frames. */
  ready(): Promise<void>;

  setScreen(screen: Screen, extra?: { ws?: string }): Promise<void>;
  openProject(id: string): Promise<void>;
  /** Today's day preview (the prototype's model.previewDay). */
  previewDay(iso: string): Promise<void>;
  openRoutine(id: string): Promise<void>;

  openCheckIn(pid: string | null): Promise<void>;
  typeCheckIn(text: string): Promise<void>;
  /** ⌘↵ in the drawer (send in compose/error, apply in review). */
  sendCheckIn(): Promise<void>;
  /** The error phase's "Use a simple reading" (CheckIn offline()). */
  simpleReading(): Promise<void>;

  openPalette(): Promise<void>;
  typePalette(query: string): Promise<void>;

  hoverTimelineProject(pid: string): Promise<void>;
  hoverTimelineRotation(): Promise<void>;
  openTimelinePanel(pid: string): Promise<void>;
  openCalendarDay(iso: string): Promise<void>;
  openDatePicker(field: 'start' | 'target'): Promise<void>;
}

export interface HomeDriver {
  readonly page: Page;
  boot(): Promise<void>;
  ready(): Promise<void>;
  hoverCard(card: 'plan' | 'textbook'): Promise<void>;
}

export interface TextbookDriver {
  readonly page: Page;
  boot(): Promise<void>;
  ready(): Promise<void>;
  openPage(pageId: string): Promise<void>;
  /** Opens the first live chart on the current page full screen. */
  fullscreenChart(): Promise<void>;
}

export interface FoundationsDriver {
  readonly page: Page;
  boot(): Promise<void>;
  ready(): Promise<void>;
}

/** Remi only: the first-run wizard at /setup (a fresh install, before setup). */
export interface SetupDriver {
  readonly page: Page;
  boot(): Promise<void>;
  ready(): Promise<void>;
}

/** Remi only: the Settings page at /settings (ADR-0010), after setup. */
export interface SettingsDriver {
  readonly page: Page;
  boot(): Promise<void>;
  ready(): Promise<void>;
}

export interface Drivers {
  readonly kind: 'prototype' | 'remi';
  readonly app: AppDriver;
  readonly home: HomeDriver;
  readonly textbook: TextbookDriver;
  readonly foundations: FoundationsDriver;
  /** Remi only (the prototype has no first run). */
  readonly setup?: SetupDriver;
  /** Remi only (the prototype has no Settings page). */
  readonly settings?: SettingsDriver;
}
