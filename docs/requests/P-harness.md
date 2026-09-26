# Requests from P-harness (parity, behaviour and egress harness)

P-harness owns `parity/**` and the `parity`, `behaviour` and `egress` Make targets. The harness
is documented in `parity/README.md` ("The production app"). These are the things it needs from
other owners, and the differences it has found that belong to them.

## 1. Screen agents: the Remi driver contract

`parity/drivers/remi.ts` reaches most states through deep links. The rest need these hooks.
Without them the state still gets captured, but it fails with a driver error in
`docs/parity-report.md`.

| Owner | Hook |
| --- | --- |
| Timeline | `data-parity="timeline-bar:<projectId>"` on each project's forecast bar (hovered for `timeline-tip-ret`) |
| Timeline | `data-parity="timeline-row:<projectId>"` on each project row. A click on it opens the side panel (`timeline-panel-ret`) |
| Timeline | `data-parity="timeline-rotation"` on the rotation lane and `data-parity="timeline-rotation-segment"` on each segment (`timeline-tip-rotation`) |
| Home | `data-parity="home-card:plan"` and `data-parity="home-card:textbook"` on the two launcher cards (`home-hover-*`) |
| Check-in drawer | `data-phase="compose\|thinking\|review\|error"` on the content root, inside `[data-screen-label="Check-in drawer"]`. Keep the textarea focus after open, ⌘↵ in the textarea, and the "Use a simple reading" button |
| Workspace | Keep the prototype titles `button[title="Change the start date"]` and `button[title="Change the target date"]` |
| Textbook | Keep `button[title="Full screen"]` on chart blocks. Put `data-block-type="formula"` on formula blocks, so the driver can wait for KaTeX |
| Notes, anything time-dependent | `data-parity-mask` on the Notes clock and on "Just now" stamps. The harness already masks clock-like times in the Notes region and "Just now" leaves, but the attribute is the stable way |
| Routines | Keep `/app/routines?focus=<id>`, the highlight that the driver captures inside the 1.6s window |

The `data-parity` anchors are now **scored**, not only used to drive: the prototype baseline
spec tags the same elements in the prototype, and Tier A holds every anchor to ±2px (a missing
one fails). All of them pass today (22 on each Timeline state, 2 on each Home state).

How Tier A reads a region (so screens know what counts):
- its own visible text, with icons, nested labelled regions and opacity-0 content left out;
- screen-reader-only text (absolute plus clipped or 1px, such as `.srOnly`) left out, so an
  accessible duplicate never counts as extra copy;
- each `Roll` read as its value (its full-text sizer), not its reels. A plain-text date where
  the prototype uses a Roll still reads the same; only pixels differ;
- then the region's own form fields as `[field] <value>` lines (or the placeholder while
  empty), so input values such as hours a day, work left and routine names are compared.

Earlier versions of this file said the Timeline's forecast labels "must use Roll". That was
wrong: the Timeline already uses `Roll`, and the extra words came from Roll's sr-only copy,
which the harness now leaves out. The Timeline states pass Tier A with 0 differing pixels.

## 2. Backend: fixed clock and timezone in test runs

**Status: resolved.** The backend takes `REMI_NOW` and `REMI_DEFAULT_TIMEZONE` (dev and test
only; the proposed `REMI_TIMEZONE` became `REMI_DEFAULT_TIMEZONE`), and the harness sets both
(`H4-harness.md` item 4).

The browser is pinned to Mon 5 Oct 2026 09:30 Europe/London. `REMI_TODAY` moves only the
server's date.

a. **Time of day (clock owner).** Notes are stamped by the server, so a note jotted in a test
   run gets the real time (a run just now stamped 19:24). The behaviour flow "Notes: … stamped
   09:30" checks the entry's own stamp (`aria-label="Note at 09:30"`) and fails until this
   exists.
   - Request: `REMI_NOW=2026-10-05T09:30:00+01:00` for `REMI_ENV=test`, as a `FixedClock`, or a
     clock that starts at that instant and then runs.
   - The harness will pass it in `parity/remi/servers.ts` `startBackend` (one line).

b. **Timezone (setup owner, `services/setup.py`).** `machine_timezone()` reads
   `/etc/localtime`, so the first-run wizard pre-fills the host's zone (on this Mac
   "South Africa · Africa/Johannesburg"), and an approved `setup-wizard` baseline will not
   reproduce on another machine.
   - Request: under `REMI_ENV=test`, take the zone from `TZ` (an IANA name) or a
     `REMI_TIMEZONE` before `/etc/localtime`.
   - The harness already starts the backend with `TZ=Europe/London`, and the report notes the
     host zone on `setup-wizard` whenever it is not Europe/London.

## 3. Backend fake AI provider (no action)

The backend now has a test-only fake (`REMI_AI_FAKE`, a reply file). The harness keeps its
own loopback fake Ollama server (`parity/remi/fake-ai.ts`), because the drawer's provider dot
and the Notes copy follow Settings (`GET /ai/status`), so Settings must name a provider anyway.
Only the states that name an AI stub touch Settings, and they run one after another; see
`parity/README.md` "The check-in AI states".

## 4. Differences the harness found (other owners)

| Owner | State(s) | Difference |
| --- | --- | --- |
| Workspace (UI-projects-workspace) | `workspace-*` | The "PLAN AS OF" Roll reads `Mon 5 Oct` (today) for every project. The prototype shows each project's last snapshot: ret `Sat 3 Oct`, manco `Sat 26 Sep`, play `Fri 2 Oct`, fion `Wed 30 Sep` (it matches the "Checked in N days ago" line). This became visible once Tier A read Roll values. It is the only Tier A difference left on `workspace-ret`, `-manco`, `-play`, `-fion` and `-ret-datepicker` (`workspace-alpha` passes) |
| Engine (ADR-0007 owner) | `drawer-review-offline` | The simple reading adds no NOTE beside a `task_done` ("Finished parsing the security-level extract." is missing; "Apply 6 changes" instead of 7). This is a deliberate quirk fix in `services/engine/simple_reading.py`, but ADR-0007's table has no row for it yet. The harness adds the matching `divergences.ts` rows once the ADR row exists |
| Foundations owner | `foundations` | 1920×7009 against the prototype's 1920×4944: Remi's page adds a component library section and hex colours where the prototype shows `oklch(…)`, and its intro links the app instead of `Remi.dc.html`. Tier B 29% |

Rows added to `parity/divergences.ts` in this round, with their sources:
- `ret-need-3.8-roll` and `ret-need-3.8-more` (ADR-0007, ret need rate): the Roll reads 3.8 and
  the line under it reads "0.3h a day more than planned";
- `play-fion-need-1.0` is now a text row: the Roll reads `1`, which is how the prototype's
  `hr()` writes 1.0;
- `home-demo-ret-6h` and `home-demo-ret-6h-delta` (ADR-0007, ret +6h scope): hovering the
  Control Panel card shows `Mon 7 Dec` and `+6 BD`;
- `checkin-error-message` (critique, CheckIn :246 and :250): the error panel's message.

## 5. Makefile owner (`check`)

`check` runs `parity`, `behaviour` and `egress`.
- `egress` passes (46 of 46).
- `behaviour` passes 13 of 14 flows. The Notes stamp flow waits on §2a.
- `parity` still fails on the differences in §4.

If `check` must stay green before P4, run `egress` in `check` and run `parity` and `behaviour`
separately until then.

## 6. Ports and parallel runs

- A Remi run uses 127.0.0.1:8804 (API) and 5304 (web), plus an OS-assigned loopback port for
  the fake AI server. `REMI_PARITY_API_PORT` and `REMI_PARITY_WEB_PORT` override them.
- Scratch and Playwright output are kept per port pair: `parity/.remi-run/<api>-<web>/` and
  `test-results/remi-<api>-<web>/`. A run on other ports never stops or deletes another run's
  servers, data dir or traces.
- A run refuses to start while another run on the same ports is alive.
- Parity outputs (`parity/baselines/remi/`, `parity/report/`, `docs/parity-report.md`) are
  shared, so a parity run takes `parity/report/.parity.lock`, and a second parity run refuses to
  start until the first finishes. Behaviour and egress runs on other ports can run beside it.
- Prototype re-captures (`make parity-baseline`) use 4800; `PARITY_PROTOTYPE_PORT` overrides it.
