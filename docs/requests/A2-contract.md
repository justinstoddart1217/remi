# Requests from A2-contract (API contract)

## 1. `backend/app/main.py`: wire the API with `install_api` (owner of main.py)

`app/api/router.py` exports `install_api(app: FastAPI, config: RemiConfig) -> None`. It is idempotent and does four things:

1. includes `api_router` (every `/api` group) if it is not already mounted;
2. includes the dev-only router (`POST /api/dev/fixtures`) when `config.env in {"dev", "test"}`;
3. installs the exception handlers (`app/api/errors.py`: `DomainError`, validation errors and `/api` 404/405 all become `{error:{code,message,field}}`);
4. installs the security middleware (`app/api/middleware.py`: loopback Host check, Origin + `X-Remi-Client: 1` guard on mutating `/api` calls, app CSP and other security headers).

Please change `create_app` from

```python
app.include_router(api_router)
```

to

```python
from app.api.router import install_api
...
install_api(app, cfg)
```

Until this lands, `POST /api/dev/fixtures`, the error envelope and the middleware are missing from the running app and from `contracts/openapi.json` (the dev route). `backend/tests/api/` calls `install_api` itself, so its tests pass either way. After the change, run `make openapi` once so the contract picks up `/api/dev/fixtures`.

**Status (verifier round 1): still open.** `backend/app/main.py:74` still calls
`app.include_router(api_router)`, so the running app has no envelope, no Host/Origin/
`X-Remi-Client`/CSP middleware (including the new `UnexpectedErrorMiddleware`, which gives
500s the security headers), and `contracts/openapi.json` has 98 operations instead of 99.
This blocks integration.

## 2. `DomainError` and `app.state` (A1): already compatible, nothing to do

`app/api/errors.py` maps `app.core.errors.DomainError` (`code`, `message`, `field`, `status`)
to `{"error": {"code", "message", "field"}}`; `field` is always present (`null` when unset).
`app/api/deps.py` reads `app.state.config`, `.clock`, `.db` (`core.db.Database`) and
`.uow_factory` (`core.uow.UnitOfWorkFactory`), which the lifespan in `main.py` already sets.

## 3. Static serving (owner of `app/api/static.py` / SPA fallback)

- `api/static.py` was not created by A2 (not in the A2 task). The SPA catch-all must not answer `/api/*`; the `/api` 404 envelope comes from `install_api`.
- Chart HTML is served by `GET /api/charts/{assetId}` (`app/api/endpoints/charts.py`). Its response must set `Content-Security-Policy` to `app.api.middleware.CHART_CSP`; the security middleware only adds the app CSP when a response has none.

## 4. For the P2 service implementers

- Import routes' dependencies from `app/api/deps.py` (`ConfigDep`, `ClockDep`, `SessionDep`,
  `UowFactoryDep`) and raise `DomainError` subclasses; the envelope is automatic.
- `backend/tests/api/test_stubs.py` expects 501 from every route except `/health`. When a route
  is implemented, exclude it there (the contract table in `tests/api/routes_table.py` stays).
