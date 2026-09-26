export const meta = {
  name: 'remi-p5-adversarial-review',
  description: 'Phase 5: six-lens adversarial review of Remi, skeptical verification of each finding, area fixers, make check gate — looped until dry — then handover docs',
  phases: [
    { title: 'Review', detail: '6 lenses find issues' },
    { title: 'Verify', detail: 'skeptical refutation per finding' },
    { title: 'Fix', detail: 'area fixers with disjoint ownership' },
    { title: 'Gate', detail: 'make check must be green' },
    { title: 'Handover', detail: 'final docs and report' },
  ],
}

const ROOT = '/Users/justinstoddart/Desktop/Ninety One/remi'
const BASE = `
CONTEXT: Remi, a local-only personal workflow dashboard (FastAPI backend + React/TS frontend), productionised from a Claude Design prototype.
- Repo: "${ROOT}" (git, nothing committed; do NOT commit). The design reference "${ROOT}/Remi Dashboard Design Review/" is READ-ONLY.
- Binding decisions: docs/PLAN.md and the ADRs in docs/decisions/ (0007 lists the deliberate divergences from the prototype).
- Design spec: docs/design-spec/ (synthesis.json, critique.md, files/<key>.json, arch-*.md). API: docs/api.md. Parity report: docs/parity-report.md.
- Status: \`make check\` is fully green (lint, typecheck, 1206 backend and 687 frontend tests, openapi-check, design-verify, build, goldens-check, parity Tier A and B 38/38 plus 8/8 Remi-only states, behaviour 15/15, egress 46/46).
- Launchers: launch.command (macOS) and launch.bat (Windows) at the root.
- Toolchain: uv (Python 3.12) from backend/; run as \`uv run python -m ...\` (the repo is on iCloud Desktop, so don't use the .venv/bin/remi shim). Node 25 and npm. Playwright and Chromium are in parity/node_modules.
- Running the app with the design data: \`cd backend && REMI_ENV=test REMI_TODAY=2026-10-05 REMI_NOW=2026-10-05T09:30:00+01:00 REMI_DEFAULT_TIMEZONE=Europe/London REMI_DATA_DIR=<fresh tmp> REMI_WEB_PORT=<web> uv run python -m app.main --no-browser --port <api>\`, then POST /api/dev/fixtures {"fixture":"design"} with the headers X-Remi-Client: 1 and Origin http://127.0.0.1:<api>. For the UI, either \`cd frontend && REMI_API_PORT=<api> REMI_WEB_PORT=<web> npx vite\`, or build and let the backend serve dist.
- USE ONLY YOUR ASSIGNED PORTS, and stop your servers when done.
- Keep your FINAL message short.`

async function robust(prompt, opts) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await agent(prompt, opts)
    if (r !== null && r !== undefined) return r
    log(`${opts && opts.label}: attempt ${attempt} failed (likely network); retrying`)
  }
  return null
}

const AREAS = {
  backend: 'backend/** ; docs/api.md ; docs/decisions/**',
  platform: 'frontend/src/{app,shell,stores,lib,api,test,components}/** ; frontend/src/screens/foundations/** ; frontend/vite.config.ts ; frontend/src/main.tsx ; frontend/package.json',
  screens: 'frontend/src/screens/** except screens/foundations',
  harness_docs: 'parity/** ; Makefile ; README.md ; docs/** except docs/api.md and docs/decisions ; launch.command ; launch.bat',
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'short, specific' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          area: { type: 'string', enum: ['backend', 'platform', 'screens', 'harness_docs'] },
          file: { type: 'string', description: 'primary file:line' },
          detail: { type: 'string', description: 'what is wrong and why it matters' },
          repro: { type: 'string', description: 'exact steps/commands/inputs that demonstrate it, and the expected vs actual result' },
          fix: { type: 'string', description: 'suggested fix' },
        },
        required: ['title', 'severity', 'area', 'file', 'detail', 'repro'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = { type: 'object', properties: { confirmed: { type: 'boolean' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, evidence: { type: 'string' } }, required: ['confirmed', 'evidence'] }

const KNOWN_OPEN = `Known open items from Phase 4. Include each as a finding if still present:
- On an empty install, the Home Textbook card shows a stray '1.1'.
- The no_pc header copy 'Move not planned yet' reads poorly, and it is duplicated on Today.
- The Textbook save-status copy 'Saved in this browser' is inaccurate: pages save to the server.
- frontend/src/screens/home/textbookExcerpt.ts drops unknown symbol commands (\\hbar, \\dagger), leaving hanging operators.
- The texPlain superscript minus (U+2212) is not mapped, so it renders as 'Σ^(−1)' in the aria-label.
- TextbookPreview.tsx puts an aria-label on a role-less div.
- frontend/src/screens/calendar/nav.test.ts is flaky and times out.
- The UI-timeline docs are outdated.
- The 8 Remi-only baselines (the setup wizard and 7 empty screens) were only self-approved. Review them visually for design quality and coherence with the Foundations language.
- README.md lacks a 'Launching Remi' section for launch.command and launch.bat.`

const LENSES = [
  { key: 'correctness', ports: [8840, 5340], prompt: `LENS: CORRECTNESS. Try to break the numbers and data integrity. Check:
- the engine and services against the prototype goldens and ADR-0007;
- preview == apply == GET /plan under odd sequences;
- date edge cases: holidays for both regions, year boundaries, the move date changed to before or after projects, leave, a timezone change near midnight, day rollover while the app is open;
- empty and edge states: no PC projects, key project deleted, routines handed over, the rotation empty or changed;
- event log invariants, cascades, textbook version conflicts, chart dedupe and GC, notes tagging edge cases, check-in parse/validate edge cases.
Exercise the live API with curl scripts and read the code. Report only issues you can reproduce.` },
  { key: 'fidelity', ports: [8841, 5341], prompt: `LENS: VISUAL, MOTION AND COPY FIDELITY vs the prototype. Beyond the static parity states (which pass):
- interactions and animation: hover and linked highlight dimming, the arrival staggers, the card → workspace view transition, the plan-moves glide, ghost and moved chip after a check-in, the Roll odometer, drawer and palette open/close, SidePanel enter/exit, timeline zoom morph, calendar month switch, the Home expand overlay, the Textbook slash menu and resize;
- durations and easing vs synthesis.motionSystem;
- reduced motion;
- 2560×1440 layout;
- copy vs the critique (quote any mismatch).
Serve the prototype (python3 -m http.server --directory "Remi Dashboard Design Review" on your web port+100) and the app side by side in Playwright. Use screenshots and video frames and compare. Report concrete mismatches with the expected vs actual value.` },
  { key: 'security', ports: [8842, 5342], prompt: `LENS: SECURITY AND STAY-LOCAL. Attack the local surface:
- the Host and Origin guards, DNS rebinding, CSRF from a malicious page (simulate with a page served on another port), and the CSP on app and chart responses;
- chart iframe sandbox escape (try top navigation, parent access, fetch, forms, window.open from an uploaded chart);
- XSS via notes, textbook blocks, KaTeX input, project names and aliases;
- path traversal in static and chart serving; oversized uploads;
- AI key handling (never in responses or logs); AI prompt injection leading to applied changes; context leakage (goals and charters must never be sent);
- DB and data dir permissions; any runtime network egress (grep the built dist and the backend for outbound calls);
- dev-only endpoints (fixtures, REMI_TODAY/NOW) reachable in prod;
- the launchers (launch.command, launch.bat) for command injection or unsafe behaviour.
Report exploitable or clearly unsafe issues with a PoC.` },
  { key: 'product_scope', ports: [8843, 5343], prompt: `LENS: PRODUCT, SCOPE AND NEW-UI QUALITY. Check:
(a) Binding decisions: the app starts empty with AI 'none' by default; nothing computed-but-unrendered is built as UI (decision 8); day counting per decision 9; the new UI (setup wizard, Settings, inline lists, empty states) is present and coherent with the Foundations language.
(b) Do a FRESH install as a real user. Run the setup wizard, then create a PC project and an FI project, add routines with a checklist, set up the rotation, add notes, do a check-in with the simple reader, use the Textbook with a formula and chart, and open Settings to change the move date, hours, key project and appearance. Find anything confusing, broken or unfinished; any copy that is wrong, stale or placeholder; and any dead ends. Screenshot and inspect every screen.
(c) Review the 8 Remi-only parity baselines in parity/baselines/remi/ for design quality.` },
  { key: 'a11y_keyboard', ports: [8844, 5344], prompt: `LENS: ACCESSIBILITY AND KEYBOARD. Check:
- every keyboard behaviour in docs/design-spec/critique.md: ⌘K even while typing, the Esc ordering (inline field revert, date picker, textbook fullscreen and slash, then overlays top-first), ⌘↵ in the drawer, 1/2 on Home with guards, palette arrows, textbook Enter/Backspace semantics;
- focus management: palette focus return, drawer focus trap and return, inert hidden screens, focus after navigation;
- ARIA roles and labels (Roll accessible name, checkboxes, the history scrubber, SidePanel, drawer aria-modal), screen-reader text for icon-only buttons;
- colour contrast of text tokens on paper; tab order; visible focus.
Use Playwright's keyboard and accessibility snapshots (and axe-core if you can load it LOCALLY, from npm into your scratchpad).` },
  { key: 'robustness_perf', ports: [8845, 5345], prompt: `LENS: ROBUSTNESS, PERFORMANCE AND OPERATIONS. Check:
- GET /plan latency with the design seed and with a scaled dataset (e.g. 40 projects, 30 routines, 2,000 notes, a 200-page textbook); render performance of the Timeline and Calendar at that scale (long tasks, frame drops on hover and scrub);
- memory over a long session;
- behaviour when the API is down or slow (error states, retries, no blank screens), reload persistence, the day rollover at midnight, and two browser tabs editing (version conflicts);
- DB migration from an older schema, backups;
- launch.command end to end on a spare port with a temp data dir: first run builds, a second run detects the running server. Read launch.bat for Windows correctness (quoting, paths with spaces, errorlevel handling) without running it;
- the \`remi db\` commands; \`make serve\`.
Report concrete problems with measurements.` },
]

const seenTitles = []
const allConfirmed = []
const roundsLog = []
const keyOf = f => `${f.area}|${(f.file || '').split(':')[0]}|${f.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)}`
const seen = new Set()

for (let round = 1; round <= 3; round++) {
  phase('Review')
  const already = seenTitles.length ? `\nALREADY REPORTED IN EARLIER ROUNDS (do not repeat these; they are handled):\n- ${seenTitles.join('\n- ')}` : ''
  const found = (await parallel(LENSES.map(l => () =>
    robust(`${BASE}\n\nYou are an adversarial REVIEWER (round ${round}). Do NOT edit repo files; scratch work goes in the scratchpad or /tmp. Your ports: api ${l.ports[0]}, web ${l.ports[1]}.\n${l.prompt}\n${round === 1 ? KNOWN_OPEN : ''}${already}\nReturn every concrete issue you find, with severity, area (backend/platform/screens/harness_docs), file, detail and repro. Return an empty list if you find none. Quality over quantity: no speculative issues.`,
      { label: `review-r${round}:${l.key}`, phase: 'Review', schema: FINDINGS })
  ))).filter(Boolean).flatMap(r => r.findings || [])

  const fresh = []
  for (const f of found) { const k = keyOf(f); if (!seen.has(k)) { seen.add(k); fresh.push(f); seenTitles.push(`[${f.area}] ${f.title}`) } }
  log(`Round ${round}: ${found.length} findings, ${fresh.length} new`)
  if (!fresh.length) { roundsLog.push({ round, found: 0, confirmed: 0 }); break }

  phase('Verify')
  const judged = await parallel(fresh.map((f, i) => async () => {
    const votes = f.severity === 'critical' || f.severity === 'high' ? 2 : 1
    const vs = (await parallel(Array.from({ length: votes }, (_, j) => () =>
      robust(`${BASE}\n\nYou are a SKEPTICAL VERIFIER (#${j + 1}). Try to REFUTE this finding. Reproduce it yourself on ports api ${8850 + (i % 20)}, web ${5350 + (i % 20)}, and read the code. Do NOT edit repo files. Confirm ONLY if you reproduced it, or the code unambiguously shows it and it matters. It must not be a documented, deliberate divergence (ADR-0007, docs/parity-report.md) or allowed by a binding decision. Re-assess the severity.\nFINDING: ${JSON.stringify(f)}`,
        { label: `verify-r${round}:${i}.${j}`, phase: 'Verify', schema: VERDICT })
    ))).filter(Boolean)
    const yes = vs.filter(v => v.confirmed)
    const ok = yes.length > 0 && yes.length * 2 >= vs.length
    return ok ? { ...f, severity: (yes[0].severity || f.severity), evidence: yes.map(v => v.evidence).join(' | ') } : null
  }))
  const confirmed = judged.filter(Boolean)
  allConfirmed.push(...confirmed.map(c => ({ ...c, round })))
  log(`Round ${round}: ${confirmed.length} confirmed of ${fresh.length}`)
  roundsLog.push({ round, found: fresh.length, confirmed: confirmed.length })
  if (!confirmed.length) break

  phase('Fix')
  const byArea = {}
  for (const c of confirmed) (byArea[c.area] = byArea[c.area] || []).push(c)
  const fixPorts = { backend: [8870, 5370], platform: [8871, 5371], screens: [8872, 5372], harness_docs: [8873, 5373] }
  await parallel(Object.entries(byArea).map(([area, items]) => () =>
    robust(`${BASE}\n\nYou are the ${area.toUpperCase()} FIXER (round ${round}). Your ports: api ${fixPorts[area][0]}, web ${fixPorts[area][1]}.\nYOU OWN ONLY: ${AREAS[area]}. Other fixers are working in parallel on the other areas, so edit ONLY your owned paths. If a fix needs another area, note it in docs/requests/p5-${area}.md.\nFix ALL of these CONFIRMED findings properly (root cause, not symptoms), add or adjust tests that would have caught each one, and keep design fidelity and the binding decisions intact:\n${items.map((c, k) => `${k + 1}. [${c.severity}] ${c.title} (${c.file})\n   detail: ${c.detail}\n   repro: ${c.repro}\n   evidence: ${c.evidence}${c.fix ? `\n   suggested: ${c.fix}` : ''}`).join('\n')}\nRun the tests, lint and typecheck relevant to your area. For UI changes, re-check the affected parity states (\`make parity STATE=<name>\` if supported, or a screenshot compare against parity/baselines/prototype).`,
      { label: `fix-r${round}:${area}`, phase: 'Fix' })
  ))

  phase('Gate')
  let gate = await robust(`${BASE}\n\nGATE (round ${round}). Your ports are 8899/5399; parity uses its configured ports. Run \`make check\` from the repo root. If it is fully green, reply with exactly 'GREEN' followed by a one-line summary. If anything fails, FIX it. You may edit ANY file now, because the fixers are done. Make the minimal correct fix, and never loosen a test or a parity threshold to hide a real regression. Then re-run \`make check\` until it is green. Also handle any docs/requests/p5-*.md cross-area notes from this round. Reply 'GREEN' plus a summary of what you changed, or 'RED' plus what remains.`, { label: `gate-r${round}`, phase: 'Gate' })
  log(`Gate round ${round}: ${String(gate).slice(0, 120)}`)
  roundsLog.push({ round, gate: String(gate).slice(0, 400) })
}

phase('Handover')
const handover = await robust(`${BASE}\n\nFINAL HANDOVER. You may edit docs and README only.
(1) Run \`make check\` one final time and record the results.
(2) Update README.md so a non-developer can use it. Cover:
    - a 'Launching Remi' section (double-click launch.command on the Mac: first run builds, keep the window open, the right-click → Open note for the first time; launch.bat on Windows with its prerequisites);
    - first-run setup;
    - where data lives and how to back it up (\`remi db backup\` via \`uv run python -m app.main db backup\`);
    - the AI provider (off by default; how to enable Anthropic or Ollama, and what data leaves the Mac when enabled);
    - swapping in the Ninety One brand (tokens.css);
    - make targets for developers;
    - the iCloud .venv note.
(3) Write docs/HANDOVER.md, a concise status: what was built, how it was verified (the numbers), the documented divergences from the prototype, known limitations and deferred items (brand tokens, Outlook/Excel integrations, the AI route pending compliance), and the Phase 5 review summary.
Phase 5 review data (JSON): rounds=${JSON.stringify(roundsLog)}; confirmed findings=${JSON.stringify(allConfirmed.map(c => ({ round: c.round, severity: c.severity, area: c.area, title: c.title })))}.
Reply with a short summary.`, { label: 'handover', phase: 'Handover' })

return { rounds: roundsLog, confirmed: allConfirmed.map(c => ({ round: c.round, severity: c.severity, area: c.area, title: c.title, file: c.file })), handover }
