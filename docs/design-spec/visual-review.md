# Remi screenshots: visual spec for each screen

**Scope.** I looked at 71 PNGs in `/Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/screenshots/`. Every file is 924×540 and scaled down, so small text is hard to read and hex values are approximate. They were taken with ImageMagick and are blurred at the edges. Where they disagree with the CSS tokens, use the code.

**Filenames don't always match the screen.**
- `tr` is the **Tell Remi** drawer. The Transition screen is `04-pass1.png`.
- `sig` is the forecast change shown after a check-in, on Timeline and Today.
- `month.png` is a Today variant.
- `02-pass1` is Calendar, `03-pass1` and `01/02-pass2` are Routines, and `nophase`/`01-pass1` are the Projects list.
- `rlink` is Routines plus the Today log.
- `dp` is the date picker and `hv` is hovering the plan strip.

## Global shell (every screen except Home and Textbook)

**Colours sampled from the images:**

| Use | Approx. hex |
|---|---|
| Page background | `#FAF5F1` (warm off-white) |
| Browser chrome | `#EDE8E4` |
| Home cards | `#FFFDF8` |
| Ink / primary button | `#28231F` (near-black) |
| Private Credit (PC) green | `#536C33`–`#5A7437` |
| Fixed Income (FI) blue | `#4F5E89` |
| Late/overrun amber | `#D4923E` |
| Amber chip background | `#F0E1CA` |
| "Overload" chip background | `#FFE5C7` |
| Capacity cream | `#E8E5D4` |
| Over-8h peach | `#F0B19F`, `#F4D7AF` |
| Overload red | brick red, about `#A8463A` (the sample was blurred) |
| Forecast cell tint | `#FFF7F0` |
| Drawer scrim | page turns about `#D4CFCB`, i.e. roughly `rgba(40,35,31,.18)` |

**Left rail (about 42px):**
- "Remi" wordmark in serif at the top.
- Icon over a tiny label, in this order: Today, Timeline, Calendar, Projects, Routines, Transition.
- `notes.png` alone adds "Notes" between Today and Timeline.
- The active item gets a white rounded tile with a thin border.
- "⌘K" search icon at the bottom.

**Top bar (about 44px, hairline underneath):**
- `Mon 5 Oct` (bold sans), then `BD3` (mono, grey).
- A vertical divider, then **61** (bold) followed by "business days to Fixed Income".
- A status: `● Move on track, narrowly`. Other versions read "Move on track" or "Move at risk".
- Right side: search field "Jump to or add" with a `⌘K` key hint, and a black "≡ Check in" button. On Notes the button reads "Tell Remi".

**Type:**
- **Display serif**, a transitional serif, for page titles and project goals.
- **High-contrast serif italic** for goal quotes, the "Later" intent and example phrases.
- **Grotesque sans** for the interface.
- **Small mono** for BD numbers, dates, hours, ranges and chips (`0d target`, `+3 BD`, `8.5h`, `next 2 weeks · 5–16 Oct`).
- **Eyebrows** are about 9px uppercase sans, letter-spaced and grey.

**Rhythm.** Section headings are sans at about 15px with a 1px dark rule underneath. Rows are separated by hairlines. Density is high but calm. There are no shadows except on popovers and drawers.

## 1. Home (`01/02/03-home.png`)

**Layout:**
- Centred, full-bleed, no rail.
- Header: "Remi" on the left; `Mon 5 Oct · BD3 | 61 business days to Fixed Income` on the right, with a hairline below.
- Eyebrow: "GOOD EVENING · MONDAY 5 OCTOBER".
- Huge serif H1, about 52px: "Where to this morning?"
- Grey two-line intro: "Plan the move to Fixed Income in the Control Panel, or write things down properly in the Textbook."

**Two equal cards** (`#FFFDF8`, about 1px border, about 6px radius, gap about 24px):

- **Card 01, Control Panel**
  - Small "01" beside the serif title (about 26px).
  - Subtitle: "Today, the timeline, projects, routines and the move, recalculated as you go."
  - A mini timeline: a row of cream capacity blocks (one peach, which becomes three peach on hover), a "FI move" line in blue, 4 green bars and 1 blue bar with white diamonds, an orange overrun stub, and a hatched blue bar at the end.
  - Footer: "Returns pipeline Wed 2 Dec `+3 BD`" and "5 projects · 2 routines · 4 notes today".
- **Card 02, Textbook**
  - Small "02" beside the title, plus an outlined mono chip "IN THE WORKS".
  - Subtitle: "Notes you can build a career on…".
  - A document preview: breadcrumb "FIXED INCOME / Rates primer", then "1 Rates and duration", then "1.1 Price and yield", then an italic formula "ΔP / P ≈ −D × Δy".
  - `03-home` catches a typing demo mid-way: "1.2 Convexity|" with a slash-toolbar "/ Heading · Formula · Callout · Link to project". In `01-home` the "1.2" line is still faint.
  - Footer: "Numbered sections · formulas · linked to projects".

**Card hover:** the border darkens to about `#8a8580` and the circular → button fills black with a white arrow (Control Panel in `02-home`, Textbook in `03-home`). In `02-home` the mini-chart plays a scenario: forecast rolls to "Fri 4 Dec `+5 BD`", the orange stub gets longer and more peach blocks appear.

**Footer:** "Press `1` for the Control Panel" on the left (key cap) and "A personal instrument. Nothing here is shared." on the right.

## 2. Today (`01-week`, `01-sig`, `01-vt-debug` are final; `month.png` is a variant; `02-week` previews another day)

The page has two columns, about 58% and 42%.

**Left column:**
- Eyebrow "TODAY", serif H1 about 34px: "Monday 5 October".
- Meta line: "BD3 of 22 · 8h working day · Move on track, narrowly". The first two parts are mono.
- **Today's capacity**:
  - Label "TODAY'S CAPACITY" on the left, "8h of 8h planned · 0h free" on the right.
  - A full-width bar of hour blocks with 2px gaps: 6 solid olive BAU blocks (`#536C33`), then one long cream Project segment (`#E8E5D4`) with a thin outline.
  - Legend: "▮▮▮ BAU 6h / ▭ Project 2h / ⋯ Free 0h". `01-sig` shows 4h BAU.
- **Today's plan** (right caption "BAU first, then focus blocks"). Each block has a big sans hour figure (about 18px) in a left gutter, "6h" and "2h":
  - **BAU block:**
    - Eyebrow "BAU · PRIVATE CREDIT  BD3, monthly", in olive.
    - Title "Fund & security-level returns", with "Routine ↗" on the right.
    - A thick 2px progress rule showing "5 of 12 funds"; the 5 rolls.
    - A 3-column checklist of 12 funds. Checked items are struck through and greyed, with dark filled checkboxes, e.g. "Unitranche Partners" in `roll-zoom`.
  - **Project block:**
    - Eyebrow "PROJECT · PRIVATE CREDIT  Focus block".
    - Title "ManCo pack automation", with "Workspace ↗" on the right.
    - The goal in serif italic.
    - Task checkboxes with mono hours on the right (0.75h, 0.75h, 0.5h).
    - "◆ Next milestone: Performance section builds itself · Fri 16 Oct".

**Right column:**
- **This week** (mono caption "5–9 Oct · BD1 · pick a day to preview it"). Five mini day columns. Each shows `Mon 5 today` plus a mono BD number, a thin capacity bar, "8h of 8h", a BAU chip "▮ Returns 6h", project lines with small bars and hours, and "+2 more". The selected day has a white card with a dark top border.
- **What changed** (caption "since yesterday"). Rows with a coloured marker:
  - Amber dot: "Returns pipeline Sat 3 Oct / Scope added (security-level attribution, +10h). Forecast moved 27 Nov → 2 Dec.", right chip `+3 BD`.
  - Hollow circle: "ManCo pack automation today / No check-in for 9 days", chip `9 days`.
  - Red square: "Wed 4 Nov (BD3) Plan / BAU plus planned project work comes to 9.5h on an 8h day", peach chip `Overload`.
  - In `01-rlink` the log also has "Routine · Just now / Handover status Manual → Automating" rows with a `BAU` chip.
- **Needs attention** (count on the right). A red "AT RISK" or "OVERLOAD" label column, a title and subtitle, and a small outlined button ("Open plan", "See day").
- **Check-in card:** white, bordered. "CHECK-IN DUE · 9 DAYS AGO / ManCo pack automation / Its forecast of Fri 11 Dec hasn't been tested since Sat 26 Sep. Two minutes now keeps the plan honest." with a black "Check in" button.

**`month.png` variant:** "What changed" is replaced by **"October so far"** (caption "2 of 17 done · 1 overdue"). It shows a micro bar chart of the month (dark bars on done days, faint placeholders ahead, legend "■ Done ■ Overdue ▯ Due by then"), then BAU and PROJECTS checklists with right-hand dates. Overdue items show "overdue 1 BD" in bold, and there is a "Show 8 more and 2 done" link.

**Previewing another day (`02-week`):**
- Eyebrow "FRIDAY · 4 BUSINESS DAYS AHEAD" plus a pill "‹ Back to today".
- Headings change to "Friday's capacity" and "Friday's plan", with the caption "As planned today, it moves if the plan does".
- Empty BAU reads "0h  No BAU on this day. The next run is Mon 12 Oct."
- Where tasks run out: "The tasks in Now are used up before this day. Plan the next ones in the workspace."

## 3. Timeline (`tl.png` final; `03/04/05-sig` are post-check-in states)

**Header:**
- Eyebrow "TIMELINE", then "Three months", then mono "28 Sep 2026 – 15 Jan 2027 · 77 business days".
- Centred legend: "▮ BAU", green "Project", orange "Past target", faint "Previous plan", "◇ Milestone", "⊤ Target", red "Overload".
- Segmented toggle on the right: "2 weeks | **3 months**". The active half is filled black.

**Grid:**
- Four header rows: months (October / November / December / January 2027), week numbers `Wk1…` in mono, "Day" dates, and "Business day" numbers in tiny mono.
- Weekends and UK holidays collapse to thin slivers, with tick lines between.
- Month boundaries use darker vertical rules.
- **Today** is a black filled date badge "5" with a full-height grey line.
- **Move date** is a blue vertical line with a boxed label "FI move · Mon 4 Jan". The area after it is shaded slightly differently.

**Capacity row** (caption "Hours per day against 8h. Notched = BAU, solid = project."):
- One small stacked cream bar per business day, with olive BAU notches.
- Days over 8h are peach and taller. The overload day (Wed 4 Nov) is red.
- After the move, the stacks turn blue.

**Swimlanes** (section eyebrows are coloured by workstream: PC olive, FI blue):
- **PRIVATE CREDIT · BAU:** "Fund & security returns `BD3 · 6h`" and "ManCo pack `BD8 · 4h`" show as short vertical olive ticks on their run days.
- **PRIVATE CREDIT · PROJECTS:**
  - Each row has the name, the forecast date and a chip below: "Wed 2 Dec `+3 BD`", "Fri 11 Dec `0d target`", "Fri 18 Dec `0d target`".
  - Bars are olive, about 4px, with white diamond milestones.
  - When a project is late, a ⊤ bracket marks the target and an **orange overrun segment** runs from it to the forecast, ending in an orange diamond.
  - On-target projects end in a dark diamond with the ⊤ on it.
- **FIXED INCOME · BAU:** "Eurozone sovereign rotation 4h/day". Right-aligned grey text "Starts Mon 4 Jan with Germany, first Build pass →", then beige boxed cells "DE", "FR" after the move line.
- **FIXED INCOME · PROJECTS:**
  - "FI onboarding & data access / Mon 4 Jan `0d target`" is a blue bar.
  - "Alpha engine v0 / In Define `Target late Mar 2027`" is a **hatched diagonal pale-blue bar** running off the right edge, with "Target late Mar 2027 →".
- Footnote: "Weekends and UK bank holidays are collapsed to slivers. Hover a row to trace it through the capacity strip; click for details."

**`sig` sequence (after saving a check-in):**
- The status changes to "Move at risk".
- The Returns row label rolls to "Mon 7 Dec". `03-sig` catches the digits mid-roll.
- A faint dashed **previous-plan ghost line** appears under the bar.
- An amber `+3 BD` chip pops up at the bar end (`03/04-sig`) and then disappears (`05-sig`).
- More peach days appear in early December.

## 4. Calendar (`02-pass1` without drawer; `02-cal`, `01-cal` with drawer; `02-cal2`, `01-cal2` are debug)

**Header:** eyebrow "CALENDAR", serif "October 2026", mono "22 business days". The legend reads "`BAU` chip · — project hours · ◇ milestone", followed by "This month" and ‹ › buttons.

**Grid:**
- Columns: MON–FRI are wide; SAT and SUN are narrow grey shaded strips.
- Days from other months have greyed numbers.

**Each day cell (about 80px tall):**
- Date at top-left, mono "BD3" at top-right.
- An optional beige BAU chip, e.g. "▮ Returns · 6h" or "▮ ManCo pack · 4h".
- Milestones as "◇ Security-level data feed connected" in small text.
- Project lines at the bottom: a coloured bar (length ∝ hours) plus a tiny label, e.g. "Returns pipeline 3.5h". Green for PC, blue for FI.
- A day capacity bar along the bottom with the total ("7h") on the right.
- Today shows a black square badge "5". The selected day has a dark 1px outline (14 Oct).

**Right drawer** (about 215px, overlapping the grid, with a soft left shadow):
- Header: eyebrow "7 BUSINESS DAYS AHEAD", ‹ › and × buttons.
- Serif "Wednesday 14 October", then mono "BD10 of October".
- A CAPACITY bar with "7h of 8h · 1h free".
- Block list: big hour figure plus eyebrow "PROJECT · PRIVATE CREDIT" and the title.
- Weekend version: "WEEKEND / Sunday 11 October / Not a business day / Weekend. Nothing is planned."
- `01-cal` shows the drawer mid-slide.

## 5. Projects list (`01-pass1` with the phase column; `01-nophase` without)

**Header:** eyebrow "PROJECTS", "Every project leads with what it is for", and on the right "Private Credit first, then Fixed Income · click a project to open its workspace".

**Columns:** GOAL · PHASE · FORECAST · TARGET · SCOPE GROWTH · CONFIDENCE · LAST CHECK-IN · →

**Group header:** "● Private Credit  Wind down by 4 Jan: automate or hand over · 1 past target" with an outlined "+ New project" button. The Fixed Income header has a blue dot and reads "Ready for day one, then build".

**Rows:**
- The project name is small and bold. Below it, the **goal is large serif** (about 17px, two lines).
- **Phase** is a 4-segment bar. Past segments are dark and the current one is coloured (green or blue). Labels: "Run", "Define · charter half-written".
- **Forecast:** "Wed 2 Dec `+3 BD`" (amber) with "target Fri 27 Nov" below.
- **Scope growth:** "+17% · 70h" over a thin bar with an orange tail.
- **Confidence:** 5-square meter "■■■□□ 3/5".
- **Last check-in:** "2 days ago". Stale projects read "9 days ago / **Check in now**", the goal is greyed, and a chip "● Stale · 9 days" sits by the name.
- **Alpha:** "Not yet `no plan`", empty dotted meter, "Not yet".

`01-nophase` shows ManCo as "Not yet `no plan`", which looks like a data glitch.

## 6. Project workspace (two layouts; `cp.png`/`dp*`/`hv*` look like the latest)

**Layout A (`cp.png`, `01/02-dp2`, `dp4`, `hv*`):**
- Breadcrumb "‹ Projects", then a beige chip "● Private Credit", then "Returns pipeline automation".
- Full-width serif goal as H1, about 30px, two lines.
- **Stat strip** of 6 cells separated by vertical hairlines:

  | Cell | Content |
  |---|---|
  | START | "Mon 14 Sep 📅" / "15 BD in of 58" |
  | TARGET | "Fri 27 Nov 📅" / "40 BD from today" |
  | FORECAST | tinted `#FFF7F0`; "Wed 2 Dec `+3 BD vs target`" / "43 BD of work left" |
  | HOURS A DAY | "3.5 h a day" / "planned focus time" |
  | WORK LEFT | "144 h to go" / "of 70h estimated" (in later shots "planned between now and the forecast") |
  | TO LAND ON TARGET | "3.6 h a day" / "0.1h a day more than planned" |

  Large numbers are sans at about 16px. Units are small grey.
- A **2px olive elapsed-progress line** under Start and Target, with a grey remainder (`01-cp-zoom`).
- **Banner:**
  - Text: "● Lands 3 BD after target. To make Fri 27 Nov, plan 3.6h a day instead of 3.5h, or cut about 10.5h of work. It sits on 1 overloaded day, first Wed 4 Nov."
  - Right side: "Confidence ■■■□□ 3/5 · Checked in 2 days ago" and an outlined "Check in" button.
  - Ahead-of-target version (`02-dp3`): the chip reads `-2 BD vs target` and is neutral, the banner has a black dot and says "2 BD of buffer: roughly 3.5h of new scope before the target moves.", and the top bar says "Move on track".
- **PLAN AS OF strip:**
  - Label "Sat 3 Oct", caption "Drag back through 3 check-ins", hollow circles for earlier check-ins on the scrub track, and a black tick for today.
  - An olive bar with white diamonds, the ⊤ target, and an orange overrun with a diamond.
  - Axis: Oct / Nov / Dec.
- **Hover (`hv`, `hv2`, `hv3`):**
  - Milestone labels appear above the strip on staggered rows (2–3 rows so they don't collide), each with a thin leader line: "Start Mon 14 Sep", "Fund-level engine reconciles Fri 16 Oct", "Security-level data feed connected Thu 15 Oct", "Parallel run on November BD3 Wed 4 Nov", "Runbook drafted", "Target Mon 30 Nov", "Handover-ready · forecast Wed 2 Dec", etc.
  - A dark tooltip chip in mono: "Thu 5 Nov · BD4 · 3.5h planned".
  - Plan dates get small calendar icons.
- **Charter** (left, about 38% width): sections "WHY NOW", "SUCCESS MEASURES" (numbered 01–03 in mono), "IN SCOPE", "OUT OF SCOPE", "CONSTRAINTS", each with "+ Add" on the right.
- **Plan** (caption "14.5h estimated in Now"). Three columns:
  - "**Now** next 2 weeks · 5–16 Oct": ◇ milestone rows in bold with mono dates, indented task checkboxes with mono hours, "+ Add task", "+ Add milestone".
  - "**Next** 2–4 weeks · milestones only".
  - "**Later** one line of intent": large serif italic "Hand the automated run to a successor after the December cycle, then retire the manual spreadsheets."
- **Date picker popover (`01-dp3`):** "November 2026 ‹ ›", M–S header, mono BD numbers under each date, weekends greyed, a black selected cell "27 BD20", a "Today" button, and the note "Weekends and holidays move to the next business day". `dp.png` shows it mid-fade.

**Layout B (`ws-trim`, `01/02/03-edit`, `02-nophase`, `vt-debug2`):**
- The goal takes the left part of the header. A right-hand rail card shows "FORECAST Wed 2 Dec `+3 BD vs target`", key–value rows (Target, Planned "3.5 h a day", Confidence meter, Last check-in) and a full-width outlined "Check in on this project" button.
- A phase stepper "● Define — ● Plan — ○ **Run** — ○ Close" and the hint "✎ Click any text to edit · clear a line to remove it".
- Edit mode (`edit`): native date inputs showing "2026/11/27 📅", "Exit route: Automate, then hand over", and an inline new-task row "Task … 1h".
- Lower panels: "Scope log `+17% since charter`" (a cream bar chart with the last bar amber, axis "Charter · 8 Aug … 70h"), "Check-ins" (dated entries "Sat 3 Oct · 2 Dec · 3/5 …"), and "Risks `premortem`" with the italic prompt "It's January and this failed. Why?"

## 7. Routines (`rt.png`, `02-rlink`, `01-pass2`)

**Header:** eyebrow "ROUTINES", then "What repeats, and where each routine goes next".

**Private Credit section:** "● Private Credit  3 routines on your plan until the move · each one leaves by automation or handover", with a "+ Add BAU routine" button.

**Table:** ROUTINE · RULE | EFFORT | NEXT THREE | HANDOVER.
- **Routine and rule:** title about 15px, a segmented "Monthly | Weekly | Daily" (active black), a stepper "− BD3 +" (weekly routines get a weekday picker "Mon **Tue** Wed Thu Fri"), and the caption "3rd business day, monthly · 12 funds".
- **Effort:** large "6 h", then "per run", then "6h a month".
- **Next three:** three mini columns, each with a 2px left bar (olive when it is today): "Mon 5 Oct / today", "Wed 4 Nov / 22 BD away".
- **Handover:** stepper "● Manual —○ **Automating** · ○ Shadowed · ○ Handed over", a description, a bold link "Via Returns pipeline automation · 2 Dec ↗", and a faint "Remove".
- A manual-only routine reads "Where does this routine go after the move?"
- Row hover gives a beige highlight (`02-rlink`).

**Fixed Income rotation loop** (`rt`, `02-rlink`):
- A **racetrack**: two rows of 5 cards joined by short lines, with semicircular arcs at each end carrying small chevrons.
- Top row, left to right: 01·DE, 02·FR, 03·IT, 04·ES, 05·NL. Bottom row, right to left: 06·BE, 07·AT, 08·PT, 09·IE, 10·FI.
- Each card: mono code, an outlined "Build" chip, the country name, mono "4 Jan – 11 Jan · 6 BD".
- The first card (Germany) has a darker border, a black tab "First up · Mon 4 Jan" above it, and "Refresh 9 Mar – 11 Mar".
- To the left: "NOW / Waiting to start, 61 BD to go."
- Inside the loop: "LOOP 1 · 10 countries · 46 business days | ESTIMATED COMPLETION Mon 8 Mar 2027 | THEN Back to Germany to refresh, Tue 9 Mar – 11 Mar".
- Legend: "`Build` First pass: models and views built from scratch · `Refresh` Return visit: update what was built".

## 8. Transition (`04-pass1`)

**Hero:**
- Eyebrow "TRANSITION".
- A huge light sans numeral "61" (about 64px), with "business days to Fixed Income / Monday 4 January 2027" beside it.
- On the right: "AM I ON TRACK TO MOVE CLEANLY?", then "● Yes, narrowly" (sans about 20px), then the explanation paragraph.

**Business-day strip:**
- One beige outlined block per remaining business day, with month labels below.
- Flags above with leader ticks: "Dec run", "Returns pipeline · 2 Dec", "ManCo automation · 11 Dec", "Handover playbook · 18 Dec", and a blue "Move".
- Blocks after the last exit are hollow ("Buffer").
- Legend: "Private Credit exits still running / Buffer after the last exit / One block per remaining business day, bank holidays left out."

**Private Credit (wind down):**
- Groups "AUTOMATE → HAND OVER · 2 projects" and "HAND OVER · 1 project". Rows have an olive progress bar and a percentage (65%, 25%, 20%), a date, and a chip (`+3 BD` or `On target`).
- "FINISH — Nothing is being finished as it stands…"
- "STOP — Nothing stopped. If the returns pipeline slips past the December run, this is the honest alternative."
- "ROUTINES BY HANDOVER STATUS", with "● Automating" pills.

**Fixed Income (ramp up):**
- "ONBOARDING READINESS 2 of 5 ready": a checklist with "done" or mono dates.
- Caption: "Forecast ready Mon 4 Jan, the day of the move. The dry run on Thu 17 Dec is the real test."
- "FIRST ROTATION starts on day one": 3 country cards.
- "Whole rotation, loop 1 ends Mon 8 Mar ↗".
- "AFTER DAY ONE: Alpha engine v0 / In Define… Target Late Mar 2027".

## 9. Check-in drawer (`02-sig`, `03/04-pass2`, `02-roll*`)

**Frame:** slides in from the right and covers about 60% of the width. The page behind is dimmed by the warm scrim.

**Header:** "Check in", a pill select "● Returns pipeline automation ⌃", grey "Last check-in 2 days ago", a segmented "**Structured** | Tell Remi", and ×.

**Left form:**
- **Done** ("Tick what has finished since last time"): a checklist with mono hours.
- **What changed:** textarea, placeholder "One or two sentences. What moved, what you learned."
- **New scope** ("Anything added since the last check-in"): input "What was added", a stepper "− 0h +", and chips "+2h +4h +8h +16h".
- **Blockers:** placeholder "Waiting on anyone or anything?"
- **Confidence** ("3 of 5 · Even"): 5 equal buttons, "1 Unlikely / 2 Doubtful / 3 Even / 4 Likely / 5 Certain". The selected one is filled black.

**Right "LIVE PREVIEW":**
- "Forecast", then a large "2 Dec → **7 Dec** `+3 BD`" (old date grey, new black), then "6 BD past the target of Fri 27 Nov".
- A mini bar with the target bracket and the orange overrun, red overload ticks, and an Oct/Nov/Dec axis.
- A list of consequences with coloured markers:
  - Amber: "Forecast moves +3 BD".
  - Red square: "2 new overload days / Fri 4 Dec (9h), Mon 7 Dec (9h)."
  - Amber: "Misses the December run".
- Footer line: "Logs to Returns pipeline: +10h scope, confidence 3."
- No-change state: "2 Dec → 2 Dec `±0 BD`", with black dots and "Forecast holds / No new overload days / Still ready for the December run".

**Footer bar:** "Saving updates every forecast that depends on this plan." with Cancel and a black "Save check-in ⌘↵".

## 10. Tell Remi drawer (`02-tr` input → `03-tr` reading → `04-tr` result; `tr2` empty; `01-tr` mid-slide)

- **Header:** "Tell Remi / Say what happened in your own words. Remi works out what to change and shows you before anything moves." with ×.
- **Left:** hint "About anything: mention projects or routines by name". A large **serif textarea** (about 15px, lighter background, 1px border), with a grey serif placeholder in the empty state. Below it, "Write it the way you would tell a colleague." or a word count "42 words", and a black "Send to Remi ⌘↵".
- **Right, before sending ("REMI CAN"):** a two-column table. Bold sans verbs (Tick things off, Log new scope, Note blockers, Move dates, Change your time, Close BAU runs) each paired with a serif italic example quote. Note below: "You review every change before it's applied. Nothing is lost if Remi gets it wrong."
- **Reading state:** the textarea shrinks to a short scroll box. The right side shows "Reading your update" with a progress underline and "a few seconds", then the quoted sentences appear one at a time in italic.
- **Result state:**
  - Header "REMI WILL CHANGE · 5 of 5 selected".
  - A serif summary paragraph, about 14px.
  - Changes grouped by project, e.g. "● Returns pipeline automation `2 Dec → 4 Dec · +2 BD`".
  - Checkbox rows with a mono type label (TICK OFF / NEW SCOPE / BLOCKER / CONFIDENCE) and the detail.
  - Footer "Untick anything Remi got wrong. Applying updates forecasts, the timeline and Today." with an outlined "Edit update" and a black "Apply 5 changes ⌘↵".
  - Under the textarea on the left: "Change the text and send again if Remi missed something."

## 11. Notes (`notes.png`)

The layout has three panes.

**Left, notebook list (about 135px):**
- "NOTEBOOK / 6 notes across 3 days".
- Week groups: "This week", "Week of 28 Sep", and so on.
- Day rows show a count and a truncated serif italic preview. Empty days read "No notes" in italic. The selected row is a white card.

**Centre:**
- Eyebrow "TODAY", serif H1 "Monday 5 October", meta "BD3 · 3 notes · Returns · BAU, Returns pipeline, ManCo automation", then a rule.
- A new-note row: mono time "15:42" and a serif placeholder "Jot something down…".
- Entries: mono time in the left gutter, about 14px serif body, and beige tag chips with a coloured dot.

**Right rail:**
- "REMI READS THESE" with its explanation.
- A black "Turn this day into an update" button and helper text.
- "MENTIONED ON THIS DAY": dot, name and "2 notes".
- "THIS WEEK": a micro bar chart (a black bar for M5) with mono day labels.

## 12. Textbook (`03-tbhome`, `02-tbhome` collapsed, `01/02-tb2`, `tb`, `01/02-nest`)

**Frame:** three panes.
- **Left sidebar (about 138px):** "Remi · Home" and a "TEXTBOOK" label, a collapse icon, and a "Find a page" search.
- Section headings: "● FIXED INCOME" with a count and "+", then page rows with a document icon. Nesting uses indented chevrons. The active page has a beige background and shows a "● 1" live-chart marker.
- "+ New section".
- A box at the bottom: "LIVE CHARTS 1 / Drop an HTML file from Claude onto any page and it becomes a live chart, saved with the page."
- **Right rail (about 125px):** "ON THIS PAGE", a numbered outline (the active entry is bold), and "SHORTCUTS": `/` block menu, `# ## ###` numbered headings, `-` bullet, `>` callout, `$$` formula (LaTeX), `---` divider.

**Home:**
- Eyebrow "TEXTBOOK", serif H1 "Everything you have written down", "8 pages · 3 sections · 1 live chart · 258 words".
- **Sections:** 3 cards with a coloured top border (FI blue-violet, others grey), a title, a mono page count, page rows with mono right-hand badges ("1 chart", "1 inside"), and "+ New page".
- **Recently edited:** bullet list with bold title, grey path and "today", and some with a serif excerpt.
- **Live charts:** a preview tile and "price-yield.html · Rates primer".
- The collapsed sidebar becomes an icon strip (`02-tbhome`).

**Page (Rates primer):**
- The top bar shows the breadcrumb, "Saved" / "Saved in this browser", "📄 Add live chart" and "Delete".
- The reading column is about 330px wide. Serif H1, meta, rule.
- "1  Rates and duration": serif about 20px, with the number hanging in the margin.
- "1.1  Price and yield": bold sans about 13px.
- Body sans about 12px. The formula is centred, KaTeX-style.
- **Live chart block:** a frame with "● LIVE price-yield.html" and size toggles "S **M** L", "Replace", expand and delete, plus a drag handle. The iframe is blank in the captures. The caption is serif italic.
- **Slash menu (`03-tb2`):** "BLOCKS" with "1 Heading 1 / Numbered section, 1", "1.1 Heading 2", "1.1.1 Heading 3 / Concept", "Aa Text", "Bullet…". Hover has a beige background.
- **Nested pages (`nest`):** child-page rows as "📄 Germany ›", a "Type / for blocks" placeholder, and the empty hint "Click to write, type / for blocks, or drop an HTML chart".

## Motion evidence in the screenshots

**Rolling digits (`roll-debug`, `02-roll-timing`, `02-roll10`, `cp-zoom`):**
- DOM structure:
  - Outer span: `position:relative; display:inline-block; line-height:1.25; white-space:pre; vertical-align:baseline`.
  - A `visibility:hidden` sizer holding the final text.
  - An `aria-hidden` absolute flex overlay.
  - Each character: `inline-block; height:1.25em; overflow:hidden`.
  - Inside that, a column: `position:absolute; flex-direction:column; transform:translateY(Nem); transition: transform var(--dur-slow) var(--spring-soft)`.
  - Cells: `display:block; height:1.25em`.
- Measured timing: `tr=0.44s linear(0 0%, 0.049 5%, 0.156 …)`, which is a spring-style `linear()` easing. Sampled positions: 0 at 16/100ms, −25.96 at 250ms, −36.59 at 450ms, −37.5 settled at 700ms.
- Non-digit tokens also roll, including empty "ø" slots, "Dec", "BD" and "+".
- Mid-roll clipping is visible as "Mon ˈ4 Sep" and "Fı 27 Nov".

**Screen changes:** View Transitions API. The `vt-debug2` log shows `vt-start / cb-run / cb-done / finished`, with one screen visible and the rest hidden. Mid-crossfades appear in `02-pass2` and `03-pass1`.

**Drawers and popovers:** drawers slide in from the right with the scrim fading in (`01-tr`, `01-cal`). The date popover fades in (`dp.png`).

## Debug and mid-state captures (not reference quality)

**Debug overlays:**
- `tb3` (srcdoc length / sandbox / height overlay).
- `03-tb2` (the logo rendered as a monospace "Remi · Textbook" glitch).
- `01-cal2`, `02-cal2`, `cal-dbg` (scroll-height overlay "sec 1817/1817 root 1817 DIV…").
- `roll-debug`, `02-roll10`, `02-roll-timing`.
- `02-vt-debug`, `vt-debug2`.

**Mid-animation or glitched:**
- `01-tr`, `dp`, `02-pass2`, `03-pass1`, `03-sig`, `01/02-cp-zoom`.
- `01-nophase` (the ManCo "Not yet" row).

**Clean duplicates:** `01-roll10`, `01-roll-timing`, `01-vt-debug` and `01-sig` show the same final Today screen, apart from slight vertical offsets.

**Two open choices for you** (the code may settle them):
- **Workspace:** layout A with the stat strip (`cp`, `dp`, `hv`) versus layout B with the right rail and phase stepper (`ws-trim`, `edit`). The `dp`/`hv` series and `02-nophase` suggest A is later.
- **Today's right column:** "What changed" versus "October so far" (`month.png`).