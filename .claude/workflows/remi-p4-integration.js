export const meta = {
  name: 'remi-p4-integration',
  description: 'Phase 4: backend clean-up, frontend platform/components, screen fixes, harness hardening — each verified and fixed — then make check green with parity report',
  phases: [
    { title: 'Backend + Platform', detail: 'B4 backend and F4 platform/components in parallel' },
    { title: 'Screens', detail: 'F4 screens fixes after platform changes' },
    { title: 'Harness', detail: 'H4 parity/egress/behaviour hardening and full make check' },
    { title: 'Final', detail: 'independent end-to-end gate' },
  ],
}

const ROOT = '/Users/justinstoddart/Desktop/Ninety One/remi'
const RULES = `
WORKING RULES (all agents):
- Repo root: "${ROOT}". Git repo; do NOT commit.
- "${ROOT}/Remi Dashboard Design Review/" is READ-ONLY.
- Read "${ROOT}/docs/PLAN.md" (binding decisions) and "${ROOT}/docs/requests/phase3-verifier-notes.md". The notes file holds every open item from the last phase and the integration report. Also read the other docs/requests/*.md files that relevant to you, and ADR-0007.
- The design spec is in docs/design-spec/ (synthesis.json, critique.md, files/<key>.json, arch-*.md).
- State: the whole app is built; all API routes are implemented; the screens match the prototype closely. Current parity: Tier A 31/38, Tier B 37/38. Egress: 46/46. Behaviour: 14/15. make test has 3 stale frontend tests.
- Toolchain: uv (Python 3.12) from backend/ (run as \`uv run python -m ...\`; the repo is on iCloud Desktop). Node 25 and npm. Playwright and Chromium are in parity/node_modules.
- To run the app with the design data on YOUR ports:
  \`cd backend && REMI_ENV=test REMI_TODAY=2026-10-05 REMI_DATA_DIR=<fresh tmp> REMI_WEB_PORT=<web> uv run python -m app.main --no-browser --port <api>\`
  then POST /api/dev/fixtures {"fixture":"design"} (headers X-Remi-Client: 1 and Origin http://127.0.0.1:<api>), then \`cd frontend && REMI_API_PORT=<api> REMI_WEB_PORT=<web> npx vite\`.
  Use ONLY your ports, and stop your servers when done.
- FILE OWNERSHIP IS STRICT: only edit your owned paths. Other agents may be working in parallel. Record needs in docs/requests/<your-key>.md.
- Keep fidelity to the prototype exact. No runtime network access.
- RESUMED RUN: a previous attempt at this phase was interrupted mid-way (the network dropped). Some of your items may already be partly or fully done in the working tree (uncommitted). Inspect the current state of your owned files before changing anything, keep what is correct, and finish the rest. Current known state: backend lint, typecheck and tests are green; the frontend has 1 eslint error and 3 stale ScreenStack tests.
- Your FINAL message must be under 350 words: what changed, which checks pass, and any open issues.`

async function robust(prompt, opts) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await agent(prompt, opts)
    if (r !== null && r !== undefined) return r
    log(`${opts && opts.label}: attempt ${attempt} failed (likely network); retrying`)
  }
  return null
}

const VERDICT = { type: 'object', properties: { pass: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } }, required: ['pass', 'issues'] }

async function buildVerifyFix(b, phaseName) {
  const head = `${RULES}\n\nYOUR KEY: ${b.key}\nYOUR PRIVATE PORTS: api ${b.api}, web ${b.web}\nYOU OWN: ${b.owns}\n\n`
  const summary = await robust(`${head}${b.task}`, { label: `build:${b.key}`, phase: phaseName })
  const vp = (extra) => `${RULES}\n\nIndependent, skeptical VERIFIER for ${b.key} (your ports: api ${b.api + 30}, web ${b.web + 30}). Do NOT edit repo files.\nOwned paths: ${b.owns}\nTask:\n${b.task}\n${extra}\nVerify every task item is done correctly, with nothing regressed. Run the relevant checks and tests yourself. For UI, screenshot it and compare with the prototype baselines in parity/baselines/prototype/. Return pass=false with precise, actionable issues.`
  let v = await robust(vp(`Builder summary: ${summary}`), { label: `verify:${b.key}`, phase: phaseName, schema: VERDICT })
  for (let round = 1; round <= 2 && v && !v.pass; round++) {
    const fix = await robust(`${head}Task you worked on:\n${b.task}\n\nVerifier issues (round ${round}). Fix ALL of them within your owned paths and re-run the checks:\n- ${v.issues.join('\n- ')}`, { label: `fix${round}:${b.key}`, phase: phaseName })
    v = await robust(vp(`(Re-check round ${round}) Previously reported:\n- ${v.issues.join('\n- ')}\nFixer summary: ${fix}`), { label: `reverify${round}:${b.key}`, phase: phaseName, schema: VERDICT })
  }
  return { key: b.key, summary, pass: v && v.pass, issues: v && v.issues }
}

const B4 = { key: 'B4-backend', api: 8830, web: 5330,
  owns: 'backend/** (app and tests); docs/api.md; docs/decisions/0007-unified-forecast-maths.md.',
  task: `TASK B4: BACKEND CLEAN-UP. Resolve EVERY backend item in docs/requests/phase3-verifier-notes.md and the backend requests in docs/requests/*.md. At least:
(1) Make views._project_derived_out public (rename it and update callers). Move WiringDep into api/deps.py.
(2) Plan cache and revision: only plan-affecting events should change the plan revision/ETag, OR document why every event bumps it. Pick the correct, simple approach and test it. Note and textbook edits must not force a plan refetch storm.
(3) Clock and config for determinism:
    - REMI_NOW (an aware datetime, test/dev env only) pins the wall clock for note timestamps. The existing REMI_TODAY behaviour stays.
    - REMI_DEFAULT_TIMEZONE (test/dev) overrides the /etc/localtime default in GET /setup.
    Both are refused in prod.
(4) Add RoutineOut.label (the curated display label the Timeline and Transition need; check the requests file for exact semantics). The 'empty' fixture triggers a chart garbage-collection sweep.
(5) Routine hours: clamp any value ≥ 0 to the settings capacity server-side, as the prototype does. Update the docs.
(6) Request strictness: CamelIn's lax mode accepts {"completed":"yes"} and {"bd":true}. Make booleans and integers strict in request models without breaking ISO date parsing from JSON. Test it.
(7) Rotation PUT: validate the total horizon BEFORE any calendar widening, so a refused request writes no events at all.
(8) Engine rotation: loop 1's loopBd and loopEnd must count only the first pass (the Build segments before the first Refresh). E.g. after PUT [..., DE Refresh, GR Build 3] the loop 1 figures stay 46 BD ending 8 Mar. Test it against the prototype goldens.
(9) ADR-0007 rows:
    - the simple reading no longer adds a note beside task_done (so drawer-review-offline shows 'Apply 6 changes' where the prototype showed 7). This was a deliberate quirk fix in PLAN/synthesis;
    - the check-in hours-a-day feed text 'Forecast moved 11 Dec → 25 Nov.' vs the prototype's 'holds';
    - any other divergence the notes mention.
(10) Update docs/api.md: the textbook blank-label rule, upload warnings, the chart GC grace period, and every behaviour change above.
The full \`uv run pytest\`, ruff (check and format) and pyright must stay green. Run \`make openapi\` if schemas change.` }

const F4P = { key: 'F4-platform', api: 8831, web: 5331,
  owns: 'frontend/src/{app,shell,stores,lib,api,test}/** (not api/schema.d.ts, which is generated); frontend/src/components/**; frontend/src/screens/foundations/**; frontend/vite.config.ts; frontend/src/main.tsx; frontend/package.json only if a code-splitting change truly needs it.',
  task: `TASK F4-PLATFORM: FRONTEND PLATFORM AND COMPONENT CLEAN-UP. Resolve EVERY platform, component and API-layer item in docs/requests/phase3-verifier-notes.md and in docs/requests/{C1-platform,C2-components,F-api-layer,UI-*}.md that targets your paths. At least:
(1) Rewrite the 3 stale tests in src/shell/ScreenStack/ScreenStack.test.tsx for the real screens. Mock the API with msw, or assert the keep-mounted cross-fade structure without depending on screen content.
(2) Load appearance (accent pair, serif, motion) from settings at the app root, so Settings changes apply everywhere immediately. Add paths.settings(section).
(3) API layer:
    - add useUpdateUiPrefs;
    - useDeleteProject must not invalidate the deleted project's snapshots (that caused a 404); remove that query instead;
    - apply any other F-api-layer notes.
(4) Components:
    - Roll: support the needs the screens worked around with local copies (TodayRoll, LocalRoll, HomeRoll; the srOnly span issue). Give Roll a clean API so the screens can drop their copies, and document it in docs/requests/F4-platform.md for the screens agent;
    - StaleBadge gap spans;
    - pass data-* attributes through on TimelineBar and RotationSegment;
    - the InlineList variants requested;
    - an optional dimmed flag on BauChip and CapacityBar.
(5) The Foundations dev page fidelity. It is currently 29% off: the page is 1920×7009 against the prototype's 1920×4944, and the text differs. Rebuild it to match "Remi Foundations.dc.html" closely (the parity state 'foundations', baseline parity/baselines/prototype/foundations.png and .json).
(6) Bundle size. The build warns that one chunk is 646 kB. Code-split so no chunk exceeds 500 kB: lazy-load the Textbook route and KaTeX, and the Setup, Settings and Foundations routes. The Home and app-shell screens must still render instantly; keep the 8 app screens eagerly mounted, as ScreenStack requires.
Run the full vitest, eslint and tsc -b, and \`npm run build\` (no chunk over 500 kB, stay-local check passing). Screenshot /foundations and compare it with the prototype baseline.` }

const F4S = { key: 'F4-screens', api: 8832, web: 5332,
  owns: 'frontend/src/screens/** except screens/foundations.',
  task: `TASK F4-SCREENS: SCREEN FIXES. Resolve EVERY screen item in docs/requests/phase3-verifier-notes.md (all the UI-* sections, including the non-blocking notes) and in docs/requests/UI-*.md and F4-platform.md. At least:
(1) Workspace 'Plan as of': match the PROTOTYPE. Its live snapshot on the history strip is dated at the last check-in date (Workspace.dc.html: the last snapshot is replaced with {current live state, date: lastCheckin.date}), so the text reads e.g. 'Plan as of <last check-in date>', not today. This fixes Tier A for workspace-ret, -manco, -play, -fion and -ret-datepicker. Keep behaviour sensible when there are no check-ins, as the prototype does.
(2) Timeline: on an empty plan, the day slivers draw over the footnote. Fix the empty-state layout.
(3) Home: on an empty install, the Textbook card shows the sample preview. It must show the real Textbook state: a designed empty preview when there are no pages, or a real excerpt from the user's own first page when pages exist. Keep the prototype look when the design seed is loaded, so the home parity states still pass.
(4) Replace the local Roll copies (TodayRoll, LocalRoll, HomeRoll, …) with the shared Roll now that F4-platform has given it a clean API (read docs/requests/F4-platform.md and components/Roll). Keep the visuals identical.
(5) Every other open screen note: text mismatches, missing interactions, empty-state glitches, keyboard behaviour.
For EACH screen state you touch, run the app on your ports with the design seed, screenshot it at 1920x1080 with reduced motion, the Europe/London timezone, en-GB and the clock fixed at 2026-10-05T09:30+01:00, and compare it with parity/baselines/prototype/<state>.png and .json. Also check the empty-install rendering of every screen on a fresh backend without fixtures, after completing /setup through the API. Run vitest, eslint and tsc -b scoped to screens.` }

const H4 = { key: 'H4-harness', api: 8804, web: 5304,
  owns: 'parity/**; Makefile; README.md; docs/parity-report.md.',
  task: `TASK H4: HARNESS HARDENING AND A GREEN \`make check\`. Resolve EVERY P-harness item in docs/requests/phase3-verifier-notes.md. At least:
(1) A blank or wrong live chart must FAIL. Add a chart-specific check: screenshot the chart iframe region in both apps and require meaningful, non-background pixel content and a similar content fingerprint. Test the check by blanking the chart.
(2) NetTracker in drivers/remi.ts must drop requests that a navigation abandons (e.g. on framenavigated / page load), so ready() never waits out the 20s quiet window.
(3) The egress navigation flow must click the NavRail <button>s inside nav[aria-label='Screens'], not links. A failed click must FAIL the test, not just annotate it.
(4) The 4th listed item, and every other harness note.
(5) Determinism:
    - use REMI_NOW=2026-10-05T09:30:00+01:00 and REMI_DEFAULT_TIMEZONE=Europe/London in the harness backend (the B4 backend agent added these; check backend/app/core/config.py);
    - the setup-wizard state must be machine-independent;
    - the Notes stamp behaviour flow must pass.
(6) Divergences: add parity/divergences.ts rows for every ADR-0007 divergence that shows up in the text (for example drawer-review-offline 'Apply 6 changes' vs 7). The Workspace 'Plan as of' divergence should now be FIXED by F4-screens, so do NOT add a row for it; verify it passes.
(7) The behaviour suite must reach 15/15 passing (plus a first-run wizard → empty states flow, if not already there). Fix genuine app bugs you find ONLY by recording them precisely in docs/requests/H4-harness.md; do not edit app code.
(8) The Makefile \`check\` target runs lint, typecheck, test, openapi-check, design-verify, build, goldens-check, parity, behaviour and egress, and must be fully green. Update README.md with the final run instructions: make setup, make dev, make serve, the remi CLI (with the iCloud .venv note and the \`python -m app.main\` fallback), AI provider configuration, the stay-local guarantee and how to verify it.
(9) Regenerate docs/parity-report.md. Target: Tier A 100% of states pass, or appear only with documented divergences; Tier B ≥ 95%.
Run \`make check\` from the root and report the exact results.` }

phase('Backend + Platform')
const [b4, platformAndScreens] = await Promise.all([
  buildVerifyFix(B4, 'Backend + Platform'),
  (async () => {
    const p = await buildVerifyFix(F4P, 'Backend + Platform')
    phase('Screens')
    const s = await buildVerifyFix(F4S, 'Screens')
    return [p, s]
  })(),
])

phase('Harness')
const h4 = await buildVerifyFix(H4, 'Harness')

phase('Final')
const final = await robust(`${RULES}\n\nYou are the FINAL Phase 4 gate checker (ports 8899/5399). Do NOT edit repo files.
(1) From the repo root, run \`make check\` and report every target's result.
(2) Summarise docs/parity-report.md: the Tier A and Tier B counts, and the listed divergences.
(3) Run the production app via \`make serve\` on its default port, or \`cd backend && uv run python -m app.main --no-browser\` against a FRESH data dir (REMI_DATA_DIR=<tmp>). Check that / serves Home, /setup works end to end through the API, and that after setup every /app/* screen renders its empty state without console errors. Take screenshots of Home, Setup, Today (empty) and Timeline (empty) and describe them.
(4) List anything still open in docs/requests/*.md from this phase.
Return a concise, structured report.`, { label: 'final-gate', phase: 'Final' })

return { b4, platform: platformAndScreens[0], screens: platformAndScreens[1], h4, final }
