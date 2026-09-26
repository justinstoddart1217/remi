# Completeness review: omissions and corrections to the unified build spec

Paths are relative to `/Users/justinstoddart/Desktop/Ninety One/remi/Remi Dashboard Design Review/`. Line numbers refer to the `.dc.html` files. I read every file in full, including `support.js` (only the pseudo-class handling is relevant). Most of what follows is missing copy and small behaviours. A few items are outright errors in the spec, and they are marked **CORRECTION**.

## Keyboard (consolidated; the spec misses several)
- Calendar.dc.html:131: Escape closes the day panel, but only when `screen === 'calendar'`. It is a window listener, so it also fires alongside the shell's Escape.
- Workspace.dc.html:297: Escape closes the date picker. It listens in the capture phase and calls `stopPropagation`, so it does not also close the drawer or palette.
- Inline fields call `e.stopPropagation()` on Escape (Workspace:324, Routines:187, Notes:185, Textbook:630). The result is that Escape reverts the field and does not close an overlay. Keep this.
- CheckIn.dc.html:10 and :323: the ⌘/Ctrl+Enter handler is attached to the drawer root, so it only works when focus is inside the drawer. In the **error** phase, ⌘↵ retries (it calls `send`).
- Textbook:
  - :392: Escape closes fullscreen first, then the slash menu.
  - :664: Enter or ArrowDown in the title moves focus to the first text block, or inserts a `p` if there is none.
  - :513: Enter in formula edit exits edit mode, then focuses the next text block or inserts a `p`.
  - :516: Enter on an empty bullet or callout converts it to `p`.
  - :519: Enter on a heading splits into a `p`; Enter on a bullet splits into a bullet.
  - :622–630: section rename commits on Enter and reverts on Escape.
- Remi Home.dc.html:154: the `1`/`2` keys have no modifier guard.

## App shell (Remi.dc.html)
- :171 and :617–618: the frame tweak has a third option, **'Fit window'**: W×H equals the viewport and the scale is 1. This is effectively the responsive mode the spec is aiming for.
- :404: applyTweaks injects a global rule, `input[type=date]::-webkit-calendar-picker-indicator{opacity:.45}`. It serves dead native-date code in Workspace:587–588 (`openPicker`/`setTarget`); drop both.
- :362: the drawer's initial `pid` is `'manco'`.
- :599: opening a project from the palette calls `openProject(id)` without `viaCard`, so there is no view transition.
- :581: `openRoutine('rot')` is called from Today's rotation row (Today:371). It sets `routineReq` to `'rot'`, but no row carries that id, so there is no scroll or flash. Production should deep-link to the FI rotation block instead.
- Seed routines (:211–212) carry fields the spec omits:
  - `statusNote`, which appears in the Routines handover note and the Timeline tooltip:
    - r-ret: "Returns pipeline automation replaces the manual run; successor takes over from the December cycle."
    - r-man: "ManCo pack automation builds the pack; commentary stays manual and moves to the successor."
  - Also `status`, `rule` and `readiness` (0.55 / 0.35). `status` and `rule` are overwritten when derived (:559).

## Today (Today.dc.html)
- :44–46: legend entries carry hour values: "BAU {bauH}", "Project {projH}", "Free {freeH}". The swatches are:
  - BAU: 3 cells, 5×10, 2px gap, accent.
  - Project: 19×10, soft fill, accent inset.
  - Free: 19×10, hairline inset.
- **CORRECTION** :334: the week strip filters to business days, so holiday weeks show fewer than 5 cards in a 5-column grid.
- :147: each card label is `'Mon 5'`, followed by an 11px muted "today" suffix on today's card. Selected card weight is 700, otherwise 500.
- :145: cards use margin 0 -8px and padding 10 8. Hover background is ink 3.5%.
- :347: project item bar width is h/4×100%, uncapped. :165: bars are 3px tall.
- :183: the month-bar outline colour is ink-faint for past days and ink-faint 55% into paper for future days.
- :186: a 1×5 ink tick sits under today's bar (bottom -7px).
- :200: group mini-bar is 56×2 with an ink fill. :204: rows use grid 26px | 1fr | auto, min-height 34. Late and today due labels are weight 600.
- :301: selecting a non-business day falls back to today.
- :116: the focus-block goal is capped at `max-width: 62ch`.
- The computed-but-unrendered copy (:351–363) also includes:
  - attention action labels "See day" / "Check in" / "Open plan", which route to timeline / openCheckIn / openProject;
  - prompt text: "Its forecast of {forecastS} hasn’t been tested since {F.s(checkin)}. Two minutes now keeps the plan honest.";
  - no-prompt text: "Every plan has had a check-in this week. Next due: {short}, last checked {since lower}.";
  - the attention list excludes the Stale item of the prompt project;
  - `attnCount` = attention + prompt;
  - feed tone recipes: risk chip 20% / 45%, overload chip 14% / 75%, and mark shapes (risk and quiet are round; overload has radius 1px).

## Notes (Notes.dc.html)
- :47: the "Enter to jot…" hint only shows (opacity 1) when the draft is non-empty.
- :114: the clock refreshes every 20s.
- :173: the sub-line reads "no notes yet" when the day is empty.
- :76: rail copy: "Notes from your last five business days go along with every Tell Remi update, so it knows what you have been doing. Notes never change the plan by themselves."
- :215: note under the CTA: "Opens Tell Remi with these notes filled in, so you can review the changes before anything moves. Remi currently has N recent note(s) as background."
- :89: no mentions: "No projects or routines named yet. Mention one and it is linked here."
- :207: empty states:
  - today: "A blank page. Jot anything: a number that looked off, who you are waiting on, what you finished."
  - other days: "Nothing was jotted on this day."
- :213: the disabled CTA is styled with an ink-faint background and cursor: default. It has no `disabled` attribute.
- :199: week spark:
  - label `'M 5'` (weekday initial plus date);
  - bar colour: ink when selected, ink-faint when the day has notes, hairline when empty;
  - title "Mon 5 Oct · N notes";
  - spark area is 56px tall.
- :182: hovering an entry sets the global hover to the entry's first tag.

## Check-in drawer (CheckIn.dc.html)
- :28: full placeholder: "e.g. Finished mapping the last four funds and the FX share classes. The administrator now wants FX attribution too, probably 6h. Still waiting on the security-level extract, so confidence is a 3. ManCo: sent the NAV bridge spec to Finance. Returns BAU is done for today."
- :147–154: capabilities list:
  - Tick things off: “Finished the FX share classes.”
  - Log new scope: “They want FX attribution too, about 6h.”
  - Note blockers: “Still waiting on the admin extract.”
  - Move dates: “Push the playbook target to 8 Jan.”
  - Change your time: “I can give ManCo 2h a day now.”
  - Close BAU runs: “Returns are done for today.”
- :49: footnote under the list: "You review every change before it's applied. Nothing is lost if Remi gets it wrong."
- :167: on open, the caret is placed at the end of the prefilled text (`setSelectionRange`) at 380ms.
- :309: typing in the textarea during review or error drops the phase back to compose, which discards the review.
- :321: "Edit update" refocuses the textarea after 30ms.
- :312: hint line:
  - review: "Change the text and send again if Remi missed something."
  - otherwise "N words", or "Write it the way you would tell a colleague." when empty.
- :267: KIND labels: Tick off / New task / New scope / Blocker / Confidence / Target / Hours a day / Note / BAU done.
- :299: the kind label is tinted risk 45% into ink for blocker and scope_add.
- :268–277: row text formats:
  - task_done: the task text;
  - task_add: "{text} · {h}h, added to Now";
  - scope_add: "{text} · +{h}h";
  - confidence: "{old|—} → {v} of 5";
  - target_move: "{targetS} → {F.s}";
  - hours_per_day: "{rate}h → {v}h a day";
  - bau_done: "{name}, today’s run" plus " (ticks all 12 funds)" for r-ret.
- :84–86: review checkboxes have no scale animation. Their strike-through colour is ink-faint, not `--done`.
- :317: summary fallback "Here is what Remi picked out."
- :97: unplaced hint: "Name the project in your update and send it again to place these." Each quote is wrapped in “ ”.
- :100: nothing found: "Remi didn’t find anything to change. Try naming a project, a task, hours or a date."
- :246 and :250: errors:
  - "Remi replied without a plan." when the reply has no JSON;
  - panel text: "The assistant didn’t answer cleanly ({msg}). Try again, or use a simple reading that picks out hours, blockers and names."
- :319: footer notes:
  - review: "Untick anything Remi got wrong. Applying updates forecasts, the timeline and Today."
  - thinking: "Nothing changes until you apply."
  - otherwise: "Nothing changes until you review and apply."
- :17 and :24: button titles "Close (esc)" and "Not just this project".

## Timeline (Timeline.dc.html)
- :50–52: the label column of the date header shows "Day" / "Business day".
- :277: month labels get a hairline left border when not clipped.
- :22–28: legend swatch geometry:
  - BAU 4×14;
  - Project 22×8 accent;
  - Past target 22×8 risk;
  - Previous plan 22×6 dashed ink-faint;
  - Milestone 8×8 with a 1.5px ink-muted border;
  - Target Γ 7×14;
  - Overload 8×14.
- **CORRECTION** :314: in 2w, ticks after the move or for handed-over routines read "Handed over", not "Returns · 6h".
- :353: the PC·BAU group lists every routine regardless of domain, always in the PC accent.
- :309: routine row label is "Fund & security returns" for r-ret; sub-line "BD3 · 6h".
- **CORRECTION** :327–328: Define projects show Roll "Not yet" and the chip "Target {targetS}". The chip is not "no plan"; "no plan" appears only in the tooltip.
- Tooltip content (spec gives none):
  - day (:304): title "Mon 5 Oct · BD3"; chip "Overload" or "{t}h of 8h"; lines "{name}( (BAU)) · {h}h", or "Nothing planned."
  - routine (:310): title {name}, chip "BAU"; lines "{rule}, {h}h · {stage}" and statusNote.
  - rotation (:357): "Germany → France → Italy → Spain → Netherlands → Belgium → Austria → Portugal → Ireland → Finland, then back to Germany to refresh." and "First loop complete {ROT[9].eS}."
  - project (:342–344):
    - "Forecast X · target Y", or "No forecast until the plan exists · target Y";
    - "Previous plan ended {prevS}";
    - "Confidence N/5 · checked in {since}", or "No plan yet";
    - "◆ {ms} · {date}" for each milestone;
    - "◆ {endName} · {forecastS}".
  - milestone (:336): title {name}, chip "Milestone"; lines "{F.l} · BD{n}", {project name}, "Passed" or "N business days away". On mouse leave it reverts to a shortened project tooltip (:337).
- :356 and :119: the rotation note is right-anchored at `right: max(-400, W − moveX + 14)`, so it ends just before the move line.
- :359: segment text shows only when wider than 26px. Segments use x0+1 and width −2, with title "Germany · Build · Mon 4 Jan – Mon 11 Jan".
- :330: hovered project row gets an ink 3% background.
- :138–152: vertical geometry:
  - ghost: top 41, height 7;
  - bar and overrun: top 26, height 10;
  - milestones: 10px at top 26;
  - end diamond: 14px at top 24 with a 2px paper border;
  - target: top 14, height 32;
  - ghost end diamond: 18px at top 22, paper 60%;
  - "was" label: top 48;
  - moved chip: top 6, height 18;
  - off-range label: top 24, right 10, paper background.
- :163–164: overlay lines: today line top 62, move line top 80, both bottom 28.
- Side panel:
  - :202: no milestones: "No milestones yet. They arrive once the charter is finished and the plan is drafted."
  - :377: the milestone list appends an {endName} forecast row. Confidence shows "Not set" when null.
  - :205: "Open workspace" closes the panel.
  - The panel has no Escape handling. Content unmounts immediately on close (:179).

## Calendar (Calendar.dc.html)
- :209: panel empty states:
  - holiday: "{hol}. Nothing is planned, and business-day numbers skip it."
  - weekend: "Weekend. Nothing is planned."
  - free business day: "Nothing planned. A free day."
- :167: cell bar label is "{short} {h}h"; title "{name} · {h}h".
- :169: when a day is over, every meter segment is solid overload.
- :171: the cell pulse is not gated on arrival.
- :185–186: due list fills: target has an ink ring on paper; Move is fi-accent filled.
- :203: BAU rows in the panel are not clickable.
- :161: weekend numbers are ink-muted. :160: Sunday cells have no right border. :215: Sat/Sun heads are ink-faint.
- :21–23: legend labels "BAU chip", "project hours", "milestone".

## Projects (Projects.dc.html)
- :75: empty goal copy: "No goal yet. Open the workspace to write what will be true when it is done."
- :82: growth reads "—" when there is no baseline, and "0% · {h}h" when there is no growth. :85: confidence label "—".
- :32: on arrival, rows animate transform only; there is no opacity fade on rows.

## Workspace (Workspace.dc.html)
- :407–413: stat sub-line and unit copy the spec omits:
  - Target: "{n} BD from today|start", or "passed", or "—".
  - Forecast: "set work left to get one".
  - Work left: unit "to go"; subs "planned between now and the forecast" / "your estimate of what remains".
  - To land: when unknown, "—" with sub "needs a work estimate" / "target has passed"; otherwise unit "h a day" with sub "{x}h a day more than planned" (risk 45%) or "within your {rate}h a day".
- :580: when there has been no check-in, the row reads "Checked in never".
- :589: history hints: "Viewing a past check-in" / "Drag back through N check-ins" / "One check-in so far".
- :590 and :353: drag is disabled with fewer than 2 snapshots. Cursor is grab or grabbing, otherwise default.
- :491: the nearest stop is filled ink.
- :472: hover-label markers:
  - Start: circle.
  - Milestones and end: 45° diamond. The end is risk-coloured or accent; past milestones are accent.
  - Target: an unrotated square with an ink border.
- :110: label stems run to -17px in ink 18%.
- :479: the crosshair chip flips at hx < 0.12 and hx > 0.88.
- **CORRECTION** :505–509: not every field commits on Enter. The goal, name, later and list items do; **Why now is `multi:true`, so Enter inserts a newline**.
- :332: blurring an untouched blank item (a new charter line, task or milestone) removes it even with no edit.
- :334: numbers accept a comma as the decimal point; NaN becomes 0.
- :525: charter lists:

  | List | Placeholder | Empty-state copy |
  |---|---|---|
  | Success measures (28px index column, 15px) | "A measurable outcome" | "How will you know it worked?" |
  | In scope | "Something this includes" | "Not written yet. What must it do?" |
  | Out of scope (ink-muted) | "Something you will refuse" | "Not written yet. What will you refuse to build?" |
  | Constraints | "A limit to respect" | "None noted yet." |

- Other copy:
  - :145 Why now placeholder: "Why does this matter now, rather than later?"
  - :17 name placeholder: "Project name"
  - :197 empty Now: "Nothing scheduled for the next two weeks yet."
  - :214–215 Later: subtitle "one line of intent", placeholder "Where does this end up?"
  - :182 milestone with no date: "Set date"
- :602: the armed Remove label reads "Click again to remove {name} and its history".
- Date picker:
  - :254: clicking the same trigger toggles it closed.
  - :223: a fixed backdrop closes it.
  - :257: position is clamped to root width − 300.
  - :286: month navigation is limited to the calendar range; the arrows dim to 0.3.
  - :281: today has a 1px ring; the selected day is ink; non-business days are ink-faint; days outside the range are disabled.
  - :407 and :291: note text is "Moving the start keeps the work left the same" for Start, otherwise "Weekends and holidays move to the next business day".
- :302: switching project resets the scrubber, drafts and the remove confirmation. :423: falls back to the first project if the id is missing.
- Copy for the computed-but-unrendered sections (:431–433, :533–582):
  - scope growth "+N% since charter" / "No growth"; effect "+3 BD · 27 Nov → 2 Dec" or "absorbed, no change to forecast";
  - scope empties "Scope is measured against a baseline, which the first check-in sets." and "No scope added since the charter. The plan is still the one you wrote.";
  - exit line format "Exit route: automate, then hand over";
  - exit picker step numbers "1"/"2";
  - check-in meta "D Mon · N/5";
  - scope chart: 54px tall, max = 1.08 × total.

## Routines (Routines.dc.html)
- **CORRECTION** :195: only PC routines are listed. Add always creates a PC routine, so FI routines have no UI.
- :213: stage 3 shows "Handed over. It no longer takes your time." The three dates still render (:63); otherwise "No upcoming runs."
- :90: "No Private Credit routines. Everything recurring has been handed over or stopped."
- :223: tile dates read "4 Jan – 11 Jan · 6 BD".
- :148–149: legend:
  - "Build: First pass: models and views built from scratch"
  - "Refresh: Return visit: update what was built"
- :160: a new routine flashes accent 8% for 1200ms and focuses its name.
- :216: the link text is sentence-cased: "Via Returns pipeline automation · 2 Dec".
- :218: armed Remove label "Click again to remove"; idle colour ink-faint.
- :183–185: a blank routine name is allowed and saved.
- Track geometry:
  - :101: stadium inset left/right 40, top/bottom 62;
  - :102–103: chevrons at 31px, rotated ±90°;
  - :104–106: "Now" label at left 18, top 14, max-width 90px;
  - :124: centre band 104px;
  - :119: flag at left 14, top -11.

## Transition (Transition.dc.html)
- :52–54: legend: "Private Credit exits still running" · "Buffer after the last exit" · "One block per remaining business day; bank holidays left out."
- :164: the group label is pc-accent. Empty group: "No Private Credit projects left to wind down."
- :166: the routine list includes every routine, including handed-over ones. The pill always has a pc-accent dot. Notes fall back to statusNote, then rule.
- :103–108 and :169: onboarding rows are read-only (no toggle). Done items show "done".
- :177: Alpha note: "In Define, charter half-written. Planning starts once the rotation is under way."
- :176: the link reads "…ends Mon 8 Mar", with no year.
- :171: first-rotation tiles show the code only (no index) and dates as "D Mon – D Mon".

## Home (Remi Home.dc.html)
- :101–122: Textbook card preview copy:
  - "FIXED INCOME / Rates primer";
  - "1 Rates and duration" (26px serif);
  - "1.1 Price and yield";
  - "When yields rise, bond prices fall. For small moves:";
  - "where D is modified duration and Δy the change in yield.";
  - "1.2" at opacity 0.35, rising to 1 on hover;
  - caret 1.5×18 (opacity 120ms, no blink);
  - slash menu at left 150, top -6: "/" plus Heading (ink 6%), Formula, Callout, Link to project.
- :126: left footer meta "Numbered sections · formulas · live charts".
- :188–204: preview geometry and colours:
  - Gantt `rowsDef` (x, end, tgt, ms, ghost) with row y = 86 + i×34;
  - ghost opacity 0.4, rising to 0.9 on hover;
  - capacity bars: overload colour above 8h, FI colour for index ≥ 25;
  - dashed 8h line at top 66;
  - today and move lines from top 6 to bottom 44.
- :183 and :212: arrival offsets are 10px for text and 14px for cards.
- :167: under reduced motion, clicking navigates immediately with no expand.

## Textbook (Remi Textbook.dc.html)
- :45–48: the collapsed rail has three buttons: show sidebar, Textbook home, and search (which opens the sidebar).
- :96: sidebar footer: "Drop an HTML file from Claude onto any page and it becomes a live chart, saved with the page."
- :657: save status "Saved in this browser", or "Saved" for less than 5s after a save.
- Toasts:
  - :411: "This page is too large to save in the browser. It stays until you reload."
  - :455: "Only HTML files become live charts." / "Nothing to add."
  - :457: "{name} is over 4 MB; charts that large will not save in the browser."
  - :461: "Replaced with {name}."
  - :463: "{name} is live on this page."
  - :598: "Chart removed." (removal has no confirmation)
- :475–477: slash items, with label, hint, glyph and font:
  - Heading 1 "Numbered section, 1" (1)
  - Heading 2 "Subsection, 1.1" (1.1)
  - Heading 3 "Concept, 1.1.1" (1.1.1)
  - Text "Plain paragraph" (Aa)
  - Bullet "A simple list item" (•)
  - Callout "A note to remember" (◆)
  - Formula "LaTeX, rendered" (Σ, display font)
  - Page inside "A sub-page nested under this one" (▤)
  - Live chart "Drop or browse an HTML file" (▦)
  - Divider "A quiet rule" (—)
- :479: the slash filter matches label or type id. :285 and :292: menu header "Blocks"; no match: "No block called that."
- :287: slash items are picked on mousedown, which keeps focus.
- :498–499: the menu opens only while the text starts with "/" and contains no space. It is positioned at x − 288, below the textarea.
- **CORRECTION** :494–496: markdown shortcuts and "---" convert only `p` blocks, not bullets.
- Placeholders:
  - :581: "Heading", "List item", "Type / for blocks" (last or empty block)
  - :208: "A note worth remembering"
  - :216: "LaTeX, e.g. \frac{\Delta P}{P} \approx -D \times \Delta y"
  - :251: "Add a caption: what should the reader notice?"
  - :63: "Find a page"
  - :73: "Section name"
- :254–258: empty chart block is 180px tall with a 135° hatch: "Drop an HTML chart here" / "or click to browse · made in Claude Design or Claude Code".
- :683: drop overlay text "Drop to add a live chart here". :677: dropping onto an empty chart block fills it. :669: iframes disable pointer events during drag and resize.
- :594: size presets S 280 / M 380 / L 560. :595: Replay remounts the iframe by changing its key. :461: Replace keeps the caption.
- :297–305: fullscreen view: 56px header with a "Close" button; caption footer in serif italic 16.
- :564 and :38: KaTeX runs with `displayMode: true, throwOnError: false`, falling back to escaped monospace TeX until KaTeX loads. `.katex { font-size: 1.3em }`.
- :573: heading metrics (size / number size / number column / padding):
  - h1: 32 / 14 / 44 / 26 0 6
  - h2: 22 / 13 / 52 / 20 0 4
  - h3: 18 / 12 / 60 / 14 0 2
- :572: outline columns are 22 / 30 / 40px. Clicking scrolls smoothly to 40px above the heading and focuses it. :668: empties "Open a page to see its numbered outline." / "Headings appear here, numbered."
- Page tree:
  - :611: a leaf shows a "description" icon at 0.55 opacity; clicking it opens the page. Caret titles: "Show/Hide pages inside".
  - :609: ancestors of the current page are drawn in ink.
- :618 and :623–624: search forces every section open and shows a flat list, with "No matches" per section.
- :441: `createSub` inserts the link before a trailing empty `p`.
- :584: a broken page link shows the meta "missing".
- :421: `addSection` opens the sidebar, focuses the name input and selects it. The accent index is `(len − 3) mod 5`.
- :660: delete labels "Click again to delete" / "…with N inside", disarming after 3.5s.
- :533–551 home copy:
  - "Everything you have written down";
  - sub-line "N pages · N sections · N live charts · N words" (en-GB numbers);
  - page meta "N inside · N chart(s)";
  - "+ N more";
  - "No pages yet.";
  - "No live charts yet. Drop an HTML chart from Claude onto any page."
- :344–374: seed page content (use as dev fixtures).

## Foundations (Remi Foundations.dc.html)
- :418–423: empty-state specimens not found elsewhere:
  - risk: "No premortem yet. Picture January with this project abandoned, and write down the first reason that comes to mind."
  - in scope: "Not written yet. What must v0 do on its first day?", which differs from Workspace:525.
- :382 says the goal grows to 48px; the code uses 44.
- :189: the mini capacity bar is drawn with a repeating gradient, not cells.