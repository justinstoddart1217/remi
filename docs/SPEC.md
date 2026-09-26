# Remi: Product Spec

**Version 0.1 · 23 Sep 2026 · Draft, based on the discovery Q&A. Open questions are in §10.**

## 1. What Remi is

Remi is a personal workflow dashboard that runs only on this Mac. It plans BAU and project work across Private Credit and Fixed Income, three months ahead, one day at a time. When something changes, Remi recalculates the plan instead of relying on documents that go stale within a week.

## 2. Context that shapes everything

- **The transition.** Over the next ~3 months (to around the end of December 2026) the user moves from Private Credit to Fixed Income as a sovereign rates investment analyst. Each PC project has to be finished, automated, handed over or stopped, while FI work ramps up. Remi's first job is to show that wind-down clearly and keep it on schedule.
- **One user, local data.** Nothing leaves the Mac.
- **BAU is always recurring.** PC BAU runs on fixed business days, for example fund- and security-level returns for 12 funds, and the Managing Committee pack. FI BAU is a rotation through eurozone sovereigns: build each country's analysis and model in turn, then return to the first country and refresh.
- **BAU first, then projects.** BAU takes its business days, and any time left over is project time.
- **Order.** Private Credit always comes before Fixed Income.
- **Main source of change: scope growth.** Task dependencies are not needed.
- **Priority is by date.** There is no P1–P4 scale.

## 3. Core concepts

| Concept | Meaning |
|---|---|
| **Domain** | Private Credit or Fixed Income, always in that order. |
| **Routine** | A BAU process pinned to a business-day rule, e.g. "BD3, monthly, 6h". |
| **Occurrence** | One dated instance of a routine. Occurrences are generated from the rule and never typed in. |
| **Rotation** | A BAU sequence rather than a date rule, e.g. Germany → France → … → Germany (refresh). Each item uses the *build* template on its first pass and the *refresh* template after that. |
| **Project** | Goal-first work with a charter, milestones, tasks, check-ins and a scope log. Typically 4–8 are live at once. |
| **Milestone** | An outcome, not an activity. Each sits in one of three horizons: *Now* (next 2 weeks), *Next* (2–6 weeks) or *Later*. |
| **Task** | An estimated unit of work. Tasks exist only for Now-horizon milestones. |
| **Check-in** | A 2-minute status update on a project. It records what's done, what changed, new scope, blockers and confidence. |
| **Scope change** | One addition to a project, logged with its hours and its effect on the forecast. |
| **Snapshot** | The whole plan as it stood at a check-in. Snapshots make up the history. |
| **Capacity** | Working hours per business day, minus BAU, minus leave (and later meetings). |

## 4. The dynamic engine

Every edit is appended to an event log, and the whole plan is recalculated from that log. The UI animates the difference: bars slide to their new dates and the previous position fades out.

1. **Calendar.** Business days come from the holiday calendar (TBC), plus working hours per day and leave.
2. **BAU.** Routines expand into occurrences on their business days, and those hours are reserved.
3. **Free capacity.** Each day's working hours minus BAU hours (minus meetings, later).
4. **Forecast.** Remaining project estimates are poured into free capacity, earliest target date first. This gives a forecast finish for every task, milestone and project.
5. **Flags.**
   - *Overload*: a day where BAU alone exceeds capacity, or a week where the total does.
   - *At risk*: a project's forecast is later than its target.
   - *Stale*: a project has had no check-in for 7+ days.

The engine is a set of pure, unit-tested TypeScript functions: `businessDays`, `expandRoutines`, `capacity`, `forecast` and `flags`. It works the same way whether a change was typed by hand, imported, or (later) proposed by AI.

## 5. Planning framework: Define → Plan → Run → Close

This builds on the four-phase model in *Harvard Business Essentials: Managing Projects Large and Small*, adds Gary Klein's premortem (HBR, 2007), and uses rolling-wave planning so that plans have little far-off detail that can go stale.

1. **Define (the charter).**
   - **Goal**: one required sentence, shown as the most prominent text on every view of the project.
   - Why now.
   - Success measures.
   - In scope and out of scope.
   - Target date and hard constraints, e.g. "before the FI move".
   - *PC projects only*, the exit route: **Finish / Automate / Hand over / Stop**.
2. **Premortem.** Ask: "It's January and this failed. Why?" Each answer becomes a risk with a mitigation.
3. **Plan (rolling wave).**
   - 3–7 outcome milestones.
   - Only Now-horizon milestones are broken into estimated tasks.
   - Next-horizon milestones stay as milestones, and Later is a single line of intent.
   - Detail is added as work moves closer.
4. **Run (check-ins).**
   - Each project gets a structured update: done / changed / new scope (+hours) / blocked / confidence 1–5.
   - Before you save, Remi shows the forecast impact, e.g. *"27 Nov → 2 Dec, +3 BD"*.
   - Every check-in saves a snapshot, so you can scrub back and see the plan as it stood three weeks ago.
5. **Close.**
   - Compare planned with actual, and note what to keep and what to change (an after-action review).
   - *PC projects only*: write handover notes.

**Templates.**
- Project templates contain charter prompts and a milestone skeleton.
- Rotation templates cover a *country build* and a *country refresh*.

## 6. Screens (v1)

| # | Screen | Purpose |
|---|---|---|
| 1 | **Today** (home) | What's on today. Shows today's date and business-day number, the countdown to the FI move, today's BAU and project focus blocks, the day's capacity, a strip for this week, what has changed since yesterday, anything needing attention (stale, at risk, overload), and a prompt to check in. |
| 2 | **Timeline** | A daily Gantt chart covering 3 months. Lanes run PC BAU → PC Projects → FI BAU → FI Projects. Shows a capacity strip, lines for today and the FI move, forecast bars against target markers, and a ghost of the previous plan. |
| 3 | **Calendar** | A month grid. Each day shows its business-day number, BAU chips, project allocations and a load meter. |
| 4 | **Projects** | 4–8 project cards, PC first. Each card leads with the goal sentence and shows phase, forecast against target, scope growth, confidence and time since the last check-in. |
| 5 | **Project workspace** | Charter, Now/Next/Later plan, scope log, check-ins, premortem risks, history scrubber and exit route. |
| 6 | **Check-in** | A drawer with the structured update on one side and a live preview of the forecast impact on the other. It is designed so that a free-text AI box can replace the form later. |
| 7 | **Routines** | BAU rules in plain English, with effort, next occurrences and handover/automation status. Also shows the FI country rotation as a track. |
| 8 | **Transition** | The countdown, PC projects by exit route and readiness, PC routines by handover status, and FI onboarding readiness. |

## 7. Data model (first cut)

```ts
type DomainId = 'PC' | 'FI';

interface Routine {
  id: string; domain: DomainId; title: string;
  rule:
    | { kind: 'businessDay'; n: number; every: 'month' | 'quarter' }
    | { kind: 'weekly'; weekday: 1 | 2 | 3 | 4 | 5 };
  effortHours: number; checklist: string[];
  handover?: { status: 'keep' | 'automate' | 'handover' | 'done'; to?: string };
}

interface Rotation {
  id: string; domain: DomainId; title: string;
  items: string[];                       // e.g. countries, in order
  buildTemplateId: string; refreshTemplateId: string;
  pace: { kind: 'hoursPerWeek'; hours: number } | { kind: 'asCapacityAllows' };
}

interface Project {
  id: string; domain: DomainId; title: string;
  goal: string; whyNow?: string; successMeasures: string[];
  scopeIn: string[]; scopeOut: string[];
  targetDate: string; phase: 'define' | 'plan' | 'run' | 'close';
  exitRoute?: 'finish' | 'automate' | 'handover' | 'stop';   // PC only
  confidence?: 1 | 2 | 3 | 4 | 5;
}

interface Milestone { id: string; projectId: string; outcome: string; horizon: 'now' | 'next' | 'later'; targetDate?: string; done: boolean; }
interface Task { id: string; projectId: string; milestoneId: string; title: string; estimateHours: number; done: boolean; pinnedDate?: string; }
interface ScopeChange { id: string; projectId: string; at: string; description: string; addedHours: number; }
interface CheckIn { id: string; projectId: string; at: string; done: string[]; changed: string; blockers: string; confidence: 1 | 2 | 3 | 4 | 5; rawText?: string; }
interface Risk { id: string; projectId: string; description: string; mitigation: string; }
interface Settings { holidayCalendar: 'england-wales' | 'south-africa'; hoursPerDay: number; leave: string[]; fiStartDate: string; }

// Source of truth: an append-only event log. Everything else is derived.
interface RemiEvent { id: string; at: string; type: string; payload: unknown; }
```

## 8. Architecture (recommended)

- **Frontend:**
  - Vite, React and TypeScript.
  - Motion for animation.
  - Design tokens as CSS variables, taken from the Claude Design output.
- **Local API:** Node with Hono, bound to `localhost` only, storing data in SQLite through Drizzle.
- **Why a local server rather than browser storage:**
  - The data is a single file on disk, so it is easy to back up.
  - The server can later read Excel files and Outlook, and hold AI credentials. None of that belongs in a browser page.
- **Engine:** a pure TypeScript module shared by the UI and the API, tested with Vitest.
- **Running it:** one command, `npm run dev`.
- **Where data comes from:**
  - v1: you type projects, tasks and check-ins into Remi, and BAU generates itself from its rules.
  - Phase 4 adds integrations.
- **AI (planned for from day one):**
  - A check-in's free text is turned into *proposed* events.
  - Remi shows the diff, and you approve it before anything changes.
  - Which provider is allowed depends on the answer to open question 6.

## 9. Phases

| Phase | Scope |
|---|---|
| **0 · Design** (now) | Claude Design produces the design system, then Today, Timeline and the Project workspace, then the remaining screens. |
| **1 · Foundation** | Scaffold, tokens, the business-day calendar and routines engine, and Today and Timeline with data entry. |
| **2 · Living plans** | Projects, charters, the Now/Next/Later plan, check-ins, scope log, snapshots, forecasting and capacity warnings. |
| **3 · Transition + FI** | The Transition view, the Calendar view and the country rotation. |
| **4 · Connected** | Outlook calendar (meetings reduce capacity), Excel import, Teams/Jira/Notion as needed, and AI check-ins. |

## 10. Open questions

1. What is the exact FI move date? Does PC work stop that day or taper off?
2. Which holiday calendar applies (England & Wales, South Africa, other), and how many hours make a normal working day?
3. For each PC routine, what is the business-day rule and effort? For example, is the ManCo pack monthly or quarterly, and on which BD?
4. For the FI rotation:
   - What is the order of countries?
   - How much time does a first build take compared with a refresh?
   - Does it get fixed hours each week, or whatever time is free?
5. What are the Ninety One colours and typeface? The best source is a firm PowerPoint template, since its theme holds the exact values.
6. For AI check-ins, which route is permitted given the data has to stay local: a firm-approved Claude route, a local model, or none?
7. After the move, will PC BAU be handed over, automated or both? Are the automation projects what makes the handover possible?
