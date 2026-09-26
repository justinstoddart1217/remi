# Architecture decision records

One short ADR per binding decision in [`docs/PLAN.md`](../PLAN.md). Changing a decision
means a new ADR that supersedes the old one; the frozen API contract (after P1) also changes
only through an ADR plus `make openapi`.

| ADR | Decision |
| --- | --- |
| [0001](0001-backend-python-fastapi.md) | Backend: Python 3.12 + FastAPI, fixed package layout |
| [0002](0002-frontend-react-typescript-vite.md) | Frontend: React 19 + TypeScript on Vite |
| [0003](0003-local-only-no-network.md) | Local only: loopback, single user, no runtime network calls |
| [0004](0004-pluggable-ai-check-in.md) | AI check-in: pluggable, default `none`, proposals only |
| [0005](0005-scope-everything.md) | Scope: every screen the design shows |
| [0006](0006-start-empty.md) | Start empty: first-run wizard, sample data only in fixtures |
| [0007](0007-unified-forecast-maths.md) | Forecasting: one set of formulas, preview == apply |
| [0008](0008-build-what-the-design-renders.md) | Build what the design renders; hidden features are data only |
| [0009](0009-day-counts-exclude-today-and-move-day.md) | Day counts exclude today and the move day |
| [0010](0010-new-ui-for-data-the-design-cannot-create.md) | New UI (wizard, Settings, inline lists) in the Foundations language |
| [0011](0011-ninety-one-redesign.md) | The Ninety One redesign: brand tokens, Visuelt fonts, top bar, re-approved new UI |
