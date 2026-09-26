# Remi: Design Brief

> Paste this whole file into Claude Design. The sample data is illustrative. Use it exactly as given so the designs and the build line up.

## 1. The product

**Remi** is a personal workflow dashboard for one investment analyst. It plans two domains, **Private Credit** and **Fixed Income**, and splits each into **BAU** (recurring work) and **Projects**. It plans **three months ahead at daily resolution**. When anything changes (new scope, a slipped task, a check-in), Remi recalculates every forecast and the interface visibly moves to match.

Remi is built as an answer to project documents that go stale within a week. Here, the plan *is* the live state.

## 2. Who it's for and what they need to feel

- **The user:** an investment analyst moving from Private Credit to Fixed Income (sovereign rates) over the next ~3 months. They must wind down PC projects (finish, automate or hand over) while starting FI work. The only screen is a 24″ Lenovo ThinkVision monitor.
- **In 3 seconds, the screen should answer:** *What's on today? Am I on track for the move? What changed?*
- **The feeling to aim for:** calm control. Picture a beautifully kept notebook that happens to recalculate itself, rather than a control panel.

## 3. Visual direction

- **Calm, minimal and editorial**, in the spirit of Linear or Notion, but **chic and alive**. It should feel considered and hand-made.
- **Light mode only.** Use a warm off-white "paper" background rather than pure `#fff`, and near-black "ink" text.
- **Brand: Ninety One (asset manager).** Follow Ninety One's colours and typeface. The exact values will be supplied later, so:
  - Build every colour and font as a **semantic token** (names below).
  - We will swap values without touching components.
  - If you have reliable access to Ninety One's brand, use it. Otherwise pick restrained stand-ins.
- **Typography.**
  - Stand-in fonts until the brand typeface arrives: a refined grotesk for the UI, and optionally an elegant serif used *only* for project goal statements and day headings.
  - Use tabular numerals everywhere numbers or dates line up.
  - Build a clear type scale with few sizes.
- **Colour carries meaning, and only meaning.**
  - Each domain has one accent: **Private Credit** and **Fixed Income**.
  - **BAU vs Project** is shown by *form*, not by a third colour. BAU appears as compact ticks or chips on its days. Projects appear as bars that span dates.
  - Status colours are used sparingly:
    - *at risk* (amber)
    - *overload* (red)
    - *done* (quiet, desaturated)
  - "On track" is the neutral default and should **not** be green everywhere.
- **Structure.**
  - Use whitespace and hairline rules rather than boxes inside boxes.
  - Align precisely to a strict grid, with a small, consistent radius and almost no shadows.
- **Viewport.** Design at **1920 × 1080**, and make sure it still looks right at 2560 × 1440.

### Token names (values TBC)

```
--paper  --paper-raised  --ink  --ink-muted  --ink-faint  --hairline
--pc-accent  --pc-accent-soft  --fi-accent  --fi-accent-soft
--risk  --overload  --done  --focus
--font-ui  --font-display  --font-numeric
--radius-s  --radius-m  --space-1…8
--dur-fast  --dur-base  --dur-slow  --ease-out  --spring-soft
```

## 4. Motion: "alive, never busy"

Motion should explain change. It should never decorate. The implementation will use React and Motion, so please annotate durations, easings and springs.

- **Signature moment: the plan moves.** When scope is added in a check-in:
  1. Affected timeline bars **glide** to their new end dates on a soft spring with no bounce.
  2. A **ghost of the old position** lingers for about a second, then fades.
  3. Dates and counts **roll** to their new values, like an odometer.
  4. A small delta chip (e.g. `+3 BD`) appears.
- **Linked highlighting.** Hovering a project anywhere lights up its bar, its occurrences and its items in the other views.
- **Card to workspace.** A project card expands into the workspace header as a shared-element transition.
- **Timeline zoom.** Moving between 2 weeks and 3 months morphs smoothly and never jump-cuts.
- **Capacity bars** fill with a spring. An overload state *pulses once*, then stays still. Animations never loop.
- **Arrival.** On first load of the day, content settles in with a short stagger: under 350 ms in total, and not repeated on every page change.
- **Completing a BAU checklist item** is tactile and satisfying without being cute.
- **Reduced motion.** Provide a `prefers-reduced-motion` fallback that uses cross-fades only.
- **Timing guide.**
  - Feedback: 120–180 ms.
  - Layout changes: 250–450 ms.
  - Nothing slower than 600 ms.

## 5. Avoid: the "AI template" look

The user explicitly does **not** want the design to look like a quick AI-generated dashboard. Avoid all of the following:

- Purple or blue gradients, gradient text, glassmorphism, frosted cards, glowing borders.
- ✨ sparkle icons, emoji, robot or brain imagery.
- A row of hero "stat cards" (`12 Tasks ↑ 8%`) across the top.
- A generic grid of rounded cards with drop shadows, or pill-shaped everything.
- The default grey-on-white Tailwind admin look, or everything centred.
- Lorem ipsum. Use the sample data.

## 6. Navigation

- **Left rail** (narrow, with icons and labels): Today, Timeline, Calendar, Projects, Routines, Transition.
- **Persistent header:**
  - The date and business-day number, e.g. **Mon 5 Oct · BD3**.
  - The countdown, **61 business days to Fixed Income**.
  - A **Check in** button.
- **⌘K command palette** for quick-add and jump-to.
- **Ordering rule:** Private Credit always comes before Fixed Income.

## 7. Screens, in priority order

### 7.1 Today (home)
"A snapshot of what's on today."

- **Today's plan.**
  - BAU first: *Fund & security returns*, 6h, with a 12-fund checklist showing progress.
  - Then project focus blocks: *ManCo pack automation*, 2h, with the named tasks.
- **Today's capacity** as a single bar: BAU, then project, then free. It turns red if over.
- **This week:** five mini days, each with a load meter and its key items.
- **What changed** since yesterday: a quiet feed of plan changes, each with its delta.
- **Needs attention:** stale plans, at-risk forecasts and overload days coming up.
- **Check-in prompt** for the project that most needs one.

### 7.2 Timeline
- A Gantt chart with **one column per business day across ~3 months**. Weekends are collapsed to thin slivers.
- **Header:** months, weeks, day numbers, and business-day numbers in small type.
- **Lanes, in order.** Each group has a quiet section label.
  1. **Private Credit · BAU**: one row per routine, with a tick on each business day it occurs.
  2. **Private Credit · Projects**: one row per project.
  3. **Fixed Income · BAU**: the country rotation, as a sequence of segments.
  4. **Fixed Income · Projects**: one row per project.
- **Project rows contain:**
  - A forecast bar.
  - Milestone diamonds.
  - A target-date marker.
  - When a forecast has moved, a faint ghost of the previous plan.
- **Capacity strip** across the top: a stacked bar per day (BAU / project / free). Overloaded days turn red.
- **Vertical lines** for today and for the FI move (4 Jan 2027).
- **Interactions:**
  - Hover shows a tooltip.
  - Clicking opens a side panel.
  - There is a zoom control (2 weeks / 3 months).

### 7.3 Project workspace
- **Header:**
  - The **goal sentence** as the largest text on the page.
  - A domain tag and a phase stepper: **Define · Plan · Run · Close**.
  - Forecast vs target, with a delta.
  - Confidence (1–5) and time since the last check-in.
- **Charter:** why now, success measures, in scope and out of scope, constraints, and the exit route (PC projects only: *Finish / Automate / Hand over / Stop*).
- **Plan: three columns, Now / Next / Later.**
  - *Now* (next 2 weeks) holds milestones broken into estimated tasks.
  - *Next* (2–6 weeks) holds milestones only.
  - *Later* is a single line of intent.
- **Scope log:** each addition, dated, with its hours and effect on the forecast, plus a small cumulative scope-growth chart.
- **Check-ins:** a timeline of past updates.
- **Risks:** from a premortem ("It's January and this failed — why?"), each with a mitigation.
- **History scrubber:** drag back to see the plan as of any past check-in. The plan morphs as you drag.

### 7.4 Check-in drawer
Opens over any screen.

- **Left side, the structured form:**
  - Done (tick off tasks).
  - What changed.
  - New scope (+hours).
  - Blockers.
  - Confidence 1–5.
- **Right side, a live preview** that updates as you type, e.g. *Forecast 27 Nov → 2 Dec (+3 BD)*, with a mini timeline showing the shift.
- **Please also show a future state:** one free-text box ("Tell Remi what happened") feeding the same preview. AI will parse it later, and the layout must already accommodate it.

### 7.5 Projects index
- Projects grouped as PC, then FI.
- Each item leads with the **goal sentence**, then shows phase, forecast vs target, scope growth %, confidence and last check-in.
- A project with no check-in for 7+ days shows a gentle "stale" state.

### 7.6 Calendar
- A month grid with weekends de-emphasised.
- **Each day shows:** its business-day number, BAU chips, thin project-allocation bars proportional to hours, and a load meter.

### 7.7 Routines
- **Grouped by domain.** Each routine shows:
  - Its rule in plain English ("3rd business day, monthly").
  - Effort.
  - The next three dates.
  - Handover or automation status.
- **FI country rotation:** a track of country tiles in order. Show which pass each country is on (*Build* for the first time, *Refresh* on the return), where the rotation is now, and an estimated completion date. Make it clear the track loops.

### 7.8 Transition
- A countdown to the move.
- **Private Credit column:** projects by exit route with readiness, and routines by handover status.
- **Fixed Income column:** onboarding readiness and the start of the first rotation.
- A single, honest answer to *"Am I on track to move cleanly?"*

## 8. Components for the design system

Nav rail · page header with business-day label and countdown · capacity bar (day and mini variants) · timeline bar (on track / at risk / done / ghost) · milestone diamond · BAU tick and chip · rotation segment and tile · project card · goal statement · phase stepper · delta chip (`+3 BD`, `−1 BD`) · confidence control · check-in form · feed item · side panel and drawer · tooltip · command palette · domain tag · empty states (written with care, not "No data").

## 9. Sample data (illustrative)

**Today:** Monday 5 October 2026 · BD3 · 8h working day · FI move on Mon 4 Jan 2027 (61 business days away).

**Private Credit · BAU**

| Routine | Rule | Effort |
|---|---|---|
| Fund & security-level returns (12 funds) | BD3, monthly | 6h |
| Managing Committee pack | BD8, monthly | 4h |

**Private Credit · Projects**

| Project | Goal | Target | Forecast | Exit route | Confidence | Last check-in |
|---|---|---|---|---|---|---|
| Returns pipeline automation | Returns for all 12 funds produced in under 30 minutes with no manual steps, ready to hand over. | Fri 27 Nov | Wed 2 Dec (+3 BD; scope added: security-level attribution, +10h) | Automate → Hand over | 3 | 2 days ago |
| ManCo pack automation | The ManCo pack builds itself from source data; the analyst only writes commentary. | Fri 11 Dec | Fri 11 Dec (on track) | Automate → Hand over | 4 | 9 days ago (stale) |
| PC handover playbook | A successor can run every PC process alone from written runbooks. | Fri 18 Dec | Fri 18 Dec | Hand over | 4 | 3 days ago |

**Fixed Income · BAU**
- Eurozone sovereign rotation: Germany → France → Italy → Spain → Netherlands → Belgium → Austria → Portugal → Ireland → Finland → back to Germany (refresh).
- Starts after the move. Germany is on its first *Build* pass.

**Fixed Income · Projects**

| Project | Goal | Target | Status |
|---|---|---|---|
| FI onboarding & data access | Ready to run sovereign analysis on day one in FI: data, models and access in place. | Mon 4 Jan | On track |
| Alpha engine v0 | A tested signal pipeline that ranks eurozone sovereign curve trades daily. | Late Mar 2027 | In Define (charter half-written) |

**What changed (feed)**
- Returns pipeline: scope added (security-level attribution, +10h). Forecast moved 27 Nov → 2 Dec.
- ManCo pack automation: no check-in for 9 days.
- Wed 4 Nov (BD3): BAU plus planned project work comes to 9.5h of an 8h day. *Overload.*

## 10. Deliverables, in order

1. **Foundations:** colour tokens, type scale, spacing and grid, a motion spec, and the core components (§8).
2. **Key screens at 1920 × 1080:** Today, Timeline, and the Project workspace with the Check-in drawer open.
3. **Remaining screens:** Projects index, Calendar, Routines (including the rotation track) and Transition.
4. **Motion prototypes:**
   - Scope added → forecast shifts, the signature moment.
   - Project card → workspace.
   - Timeline zoom.

## 11. Handoff notes

- The build uses React, TypeScript and Motion. Please express tokens as CSS variables with the names in §3.
- Name components consistently, and annotate states and motion values.
- Remi is a personal, local tool. Treat it as one person's instrument, and leave out team, sharing and account features.
