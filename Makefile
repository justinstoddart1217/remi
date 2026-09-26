# Remi: a local-only planning app (FastAPI backend + React frontend).
# `make help` lists the targets. Everything binds to 127.0.0.1.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

BACKEND         := backend
FRONTEND        := frontend
CONTRACT        := contracts/openapi.json
TS_SCHEMA       := $(FRONTEND)/src/api/schema.d.ts
DESIGN_DIR      := Remi Dashboard Design Review
DESIGN_MANIFEST := docs/design-spec/design-manifest.sha256

HOST     := 127.0.0.1
API_PORT := 8765
WEB_PORT := 5173

UV  ?= uv
NPM ?= npm

.PHONY: help setup browsers dev dev-data-dir serve build dist-urls lint typecheck \
        test test-backend test-frontend test-harness openapi openapi-check icons \
        design-verify design-manifest check clean \
        goldens goldens-check parity-baseline parity parity-confirm behaviour egress \
        bundle release

help: ## List the targets
	@grep -E '^[a-z][a-z-]*:.*## ' $(firstword $(MAKEFILE_LIST)) \
	  | awk 'BEGIN {FS = ":.*## "}; {printf "  %-15s %s\n", $$1, $$2}'

# ------------------------------------------------------------------ setup
setup: ## Install backend (uv, Python 3.12), frontend and parity (npm) dependencies
	cd $(BACKEND) && $(UV) sync
	cd $(FRONTEND) && $(NPM) ci
	cd parity && $(NPM) ci --no-audit --no-fund

browsers: ## Install Playwright's Chromium for the parity, behaviour and egress runs
	cd parity && npx --no-install playwright install chromium

# ------------------------------------------------------------------ run
# make dev never opens the remi.db that make serve, the launchers and `remi` use: a dev build
# can load the sample fixture (⌘K "Reset to sample data"), which replaces everything in the
# database. Its data lives in REMI_DEV_DATA_DIR, by default a `dev` folder inside Remi's data
# folder (~/Library/Application Support/Remi/dev on a Mac). An exported REMI_DATA_DIR is ignored
# here on purpose; point REMI_DEV_DATA_DIR at the real folder only if you mean to.
REMI_DEV_DATA_DIR ?=
DEV_DATA_DIR_SH = if [ -n "$(REMI_DEV_DATA_DIR)" ]; then echo "$(REMI_DEV_DATA_DIR)"; else \
	  cd $(BACKEND) && $(UV) run --quiet python -c \
	    'from app.core.paths import default_data_dir; print(default_data_dir() / "dev")'; fi

dev-data-dir: ## Print the data folder make dev uses (REMI_DEV_DATA_DIR, default <Remi data>/dev)
	@$(DEV_DATA_DIR_SH)

dev: ## Backend on 127.0.0.1:8765 (reload, own data folder) + Vite on 127.0.0.1:5173
	@data="$$($(DEV_DATA_DIR_SH))"; \
	[ -n "$$data" ] || { echo "make dev: could not work out its data folder (set REMI_DEV_DATA_DIR)"; exit 1; }; \
	echo "API  http://$(HOST):$(API_PORT)/api/health"; \
	echo "Web  http://$(HOST):$(WEB_PORT)/"; \
	echo "Data $$data (make dev's own; REMI_DEV_DATA_DIR moves it)"; \
	trap 'kill $$(jobs -p) 2>/dev/null || true' EXIT; \
	(cd $(BACKEND) && REMI_ENV=dev REMI_DATA_DIR="$$data" REMI_WEB_PORT=$(WEB_PORT) \
	    $(UV) run uvicorn app.main:create_app --factory \
	    --reload --reload-dir app --host $(HOST) --port $(API_PORT)) & \
	(cd $(FRONTEND) && REMI_API_PORT=$(API_PORT) REMI_WEB_PORT=$(WEB_PORT) $(NPM) run dev) & \
	wait

# Backend entry points run as `python -m ...` from backend/ so they never depend on the editable
# install's .pth file (macOS iCloud marks dot-folders like .venv hidden, and Python skips
# hidden .pth files). `remi` behaves exactly like `python -m app.main`.
# One process on 127.0.0.1:$(API_PORT): the API under /api and frontend/dist for everything else
# (hashed /assets cached forever, client routes answered with index.html). Opens the browser;
# stop with Ctrl-C.
serve: build ## Build the SPA, then run Remi as one process on 127.0.0.1:8765
	cd $(BACKEND) && REMI_ENV=prod REMI_FRONTEND_DIST="$(CURDIR)/$(FRONTEND)/dist" \
	  $(UV) run python -m app.main --host $(HOST) --port $(API_PORT)

build: ## Build the frontend into frontend/dist and check it stays local
	cd $(FRONTEND) && $(NPM) run build
	@$(MAKE) --no-print-directory dist-urls

dist-urls: ## Fail if frontend/dist references any http(s) URL except XML namespaces
	cd $(FRONTEND) && node scripts/check-dist-urls.mjs dist

# ------------------------------------------------------------------ quality
lint: ## ruff (lint + format check) and eslint
	cd $(BACKEND) && $(UV) run ruff check . && $(UV) run ruff format --check .
	cd $(FRONTEND) && $(NPM) run lint

typecheck: ## pyright (strict), tsc -b (frontend) and tsc (parity harness)
	cd $(BACKEND) && $(UV) run pyright
	cd $(FRONTEND) && $(NPM) run typecheck
	@test -d parity/node_modules || (cd parity && $(NPM) ci --no-audit --no-fund)
	cd parity && $(NPM) run typecheck

test-backend: ## pytest
	cd $(BACKEND) && $(UV) run pytest

test-frontend: ## vitest
	cd $(FRONTEND) && $(NPM) run test

# No browser and no servers: the Remi-only states and their approvals, and the docs (README,
# docs/requests) against the files they describe. See parity/tests/.
test-harness: ## node --test: the parity harness's own checks, README and request docs
	cd parity && node --test --test-reporter=spec 'tests/*.test.ts'

test: test-backend test-frontend test-harness ## All unit tests

# ------------------------------------------------------------------ contract
openapi: ## FastAPI OpenAPI -> contracts/openapi.json -> frontend/src/api/schema.d.ts
	cd $(BACKEND) && $(UV) run python -m scripts.export_openapi ../$(CONTRACT)
	cd $(FRONTEND) && $(NPM) run gen:api

openapi-check: ## Fail if the committed contract or TS schema drifts from the backend
	@tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	(cd $(BACKEND) && $(UV) run python -m scripts.export_openapi "$$tmp/openapi.json") || exit 1; \
	(cd $(FRONTEND) && npx --no-install openapi-typescript "$$tmp/openapi.json" -o "$$tmp/schema.d.ts" >/dev/null) || exit 1; \
	diff -u $(CONTRACT) "$$tmp/openapi.json" || { echo "$(CONTRACT) is stale: run make openapi"; exit 1; }; \
	diff -u $(TS_SCHEMA) "$$tmp/schema.d.ts" || { echo "$(TS_SCHEMA) is stale: run make openapi"; exit 1; }; \
	echo "OpenAPI contract and TS schema are up to date"

icons: ## Rebuild the Material Symbols subset (build-time download; see frontend/scripts)
	cd $(FRONTEND) && $(NPM) run subset-icons

# ------------------------------------------------------------------ design reference
# The design folder is a local reference and may be absent (it left the repo in c4c88e6); the
# gates that read it then say so and pass. The committed parity baselines and goldens stand in.
design-verify: ## Fail if the read-only design folder changed since it was recorded (skipped if absent)
	@if [ ! -d "$(DESIGN_DIR)" ]; then echo "'$(DESIGN_DIR)' is not here: design-verify skipped"; else \
	  find "$(DESIGN_DIR)" -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z \
	    | xargs -0 shasum -a 256 | diff -u $(DESIGN_MANIFEST) - \
	    || { echo "'$(DESIGN_DIR)' differs from $(DESIGN_MANIFEST): the design folder is read-only"; exit 1; }; \
	  echo "Design folder unchanged ($$(wc -l < $(DESIGN_MANIFEST) | tr -d ' ') files)"; fi

design-manifest: ## Record the design manifest (only if absent; the folder is read-only)
	@test ! -e $(DESIGN_MANIFEST) || { echo "$(DESIGN_MANIFEST) exists; the design folder must not change"; exit 1; }
	find "$(DESIGN_DIR)" -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z \
	  | xargs -0 shasum -a 256 > $(DESIGN_MANIFEST)

# ------------------------------------------------------------------ parity harness (parity/README.md)
goldens: ## Extract golden values from the prototype into parity/golden (Node, offline, no deps)
	cd parity && node golden/extract.mjs

goldens-check: ## Fail if parity/golden is stale against the prototype (skipped if the design folder is absent)
	@if [ ! -d "$(DESIGN_DIR)" ]; then echo "'$(DESIGN_DIR)' is not here: goldens-check skipped"; else \
	  cd parity && node golden/extract.mjs --check; fi

parity-baseline: ## Capture prototype baselines (PNG + text/boxes JSON) and cross-check the goldens
	@test -d parity/node_modules || (cd parity && $(NPM) ci --no-audit --no-fund)
	cd parity && npx --no-install playwright test --project=prototype \
	  specs/prototype-baseline.spec.ts specs/golden-crosscheck.spec.ts

# The Remi runs start their own backend (127.0.0.1:8804, REMI_ENV=test, REMI_TODAY=2026-10-05,
# REMI_NOW=2026-10-05T09:30:00+01:00, REMI_DEFAULT_TIMEZONE=Europe/London, a fresh data dir and
# fixture) and frontend (127.0.0.1:5304); see parity/remi/servers.ts. REMI_PARITY_API_PORT and
# REMI_PARITY_WEB_PORT move them. PARITY_APPROVE=1 PARITY_APPROVER="<who>" (parity) records the
# Remi-only captures as their approved baselines (parity/baselines/remi-approved/, with the
# approval in approvals.json; PARITY_APPROVAL_NOTE adds a note); look at them first. A person
# then signs them off with parity-confirm (parity/approvals.ts).
# STATE=<regex> (parity) and FLOW=<regex> (behaviour) filter by test title. One PARITY_RUN_ID
# covers both parity invocations, so the report counts this run's rows and marks older ones stale.
PARITY_PW = cd parity && PARITY_TARGET=remi npx --no-install playwright test

parity: ## Visual parity: Remi vs the prototype baselines -> docs/parity-report.md (STATE=<regex>)
	@test -d parity/node_modules || (cd parity && $(NPM) ci --no-audit --no-fund)
	@status=0; export PARITY_RUN_ID="$$(date -u +%Y-%m-%dT%H:%M:%SZ)"; \
	(export PARITY_FIXTURE=design; $(PARITY_PW) --project=remi --pass-with-no-tests $(if $(STATE),--grep "$(STATE)",)) || status=1; \
	(export PARITY_FIXTURE=empty; $(PARITY_PW) --project=remi --pass-with-no-tests $(if $(STATE),--grep "$(STATE)",)) || status=1; \
	echo "Report: docs/parity-report.md (images in parity/report/)"; exit $$status

parity-confirm: ## Sign off approved Remi-only baselines after looking at them: STATE=<regex> BY="<your name>"
	@test -n "$(STATE)" -a -n "$(BY)" || { echo 'usage: make parity-confirm STATE=<regex> BY="<your name>"'; exit 2; }
	cd parity && node approvals.ts confirm "$(STATE)" "$(BY)"

behaviour: ## Playwright behaviour flows against Remi, one worker (FLOW=<regex>)
	@test -d parity/node_modules || (cd parity && $(NPM) ci --no-audit --no-fund)
	$(PARITY_PW) --project=behaviour --workers=1 $(if $(FLOW),--grep "$(FLOW)",)

egress: ## Stay-local crawl of Remi (a fresh production build, else Vite): no request leaves 127.0.0.1
	@test -d parity/node_modules || (cd parity && $(NPM) ci --no-audit --no-fund)
	export PARITY_SERVE=build; $(PARITY_PW) --project=egress

# ------------------------------------------------------------------ the APEX server (docs/deploy/APEX.md)
# The server runs a self-contained Windows bundle (its own Python, dependencies, backend and
# built dashboard) that its update-remi.bat downloads from this repository's GitHub Releases.
# Releases are built, install-tested on Windows and published by .github/workflows/release.yml
# when a version tag is pushed; make release makes that tag. make bundle builds the same zip
# here, to look inside it.
bundle: ## Build the Windows server bundle into build/release/ (to inspect; releases build it on GitHub)
	cd $(BACKEND) && $(UV) run python -m scripts.build_bundle --out "$(CURDIR)/build/release"

release: ## Release VERSION=x.y.z: bump, commit, tag and push; GitHub then builds and publishes the bundle
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { echo 'usage: make release VERSION=x.y.z (now: '"$$(grep -m1 '^version = ' $(BACKEND)/pyproject.toml | cut -d'"' -f2)"')'; exit 2; }
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "make release: switch to main first"; exit 1; }
	@git diff --quiet && git diff --cached --quiet || { echo "make release: commit or stash your changes first"; exit 1; }
	@! git rev-parse -q --verify "refs/tags/v$(VERSION)" >/dev/null || { echo "make release: v$(VERSION) already exists"; exit 1; }
	sed -i.bak -E 's/^version = ".*"/version = "$(VERSION)"/' $(BACKEND)/pyproject.toml && rm $(BACKEND)/pyproject.toml.bak
	cd $(BACKEND) && $(UV) lock --quiet
	@$(MAKE) --no-print-directory openapi
	git add $(BACKEND)/pyproject.toml $(BACKEND)/uv.lock $(CONTRACT) $(TS_SCHEMA)
	git diff --cached --quiet || git commit -m "Release $(VERSION)"
	git tag -a "v$(VERSION)" -m "Remi $(VERSION)"
	git push origin main "v$(VERSION)"
	@echo "Pushed v$(VERSION). GitHub now builds, tests and publishes the bundle (Actions > Release);"
	@echo "then run update-remi.bat on the APEX server."

# ------------------------------------------------------------------ all together
# Every gate, in order; stops at the first failure. Runs offline.
check: lint typecheck test openapi-check design-verify build goldens-check parity behaviour egress ## Everything CI runs
	@echo "make check: all green"

clean: ## Remove build output and tool caches (keeps dependencies)
	rm -rf $(FRONTEND)/dist $(FRONTEND)/node_modules/.tmp $(FRONTEND)/node_modules/.vite \
	  $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache
