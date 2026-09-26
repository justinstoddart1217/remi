# S-textbook: Textbook backend, chart store, production serving, `remi db`

## What exists (for the Textbook screen and anyone serving the app)

- **Services.** `app/services/textbook.py` handles sections, pages, block autosave, home, search and the tree. `app/services/chart_store.py` handles uploads, `GET /api/charts/{id}`, delete and GC.
  - Each command is one unit of work with one event: `textbook.*`, plus `textbook.charts_collected` with actor `system`.
  - The Textbook never uses `run_mutation`. It works before setup, but setup is what creates the three default sections. Before setup the tree is `{"sections": [], "pages": []}`.
- **Tree order.** `GET /textbook` returns `pages` depth-first in sidebar order: sections in order, then each top-level page followed by its sub-pages, siblings by `sortOrder`. The client can render the list as it comes.
- **Raw titles.** `title` and `pageTitle` are always the raw strings and may be `""`, so show "Untitled" yourself. Only `RecentPageOut.path` substitutes "Untitled section" and "Untitled".
- **Sections.**
  - `PATCH {label: "  "}` on an empty, unnamed section that is not the last one deletes it. That is the prototype's rename `commit`. The response is the section as it was, and the tree no longer lists it.
  - A blank label on a named section is ignored. Labels are trimmed.
  - A new section's accent is `NEW_ACCENTS[(n - 3) mod 5]`.
  - `POST /textbook/pages` for a top-level page also sets `collapsed: false` on its section (the prototype's `newPageIn`).
- **Pages.**
  - Titles keep their spaces, but newlines are removed.
  - Renaming does not bump `version`. Only a block change does. So a rename never makes an autosave in flight fail with a 409.
  - Creating a sub-page bumps the parent's `version`. The response's `parent` carries the new version and the link block.
  - `DELETE` returns `{deletedIds, nextPageId}`, where `nextPageId` is the parent, else the first remaining page in creation order across all sections (the prototype's `next[0]`), else `null`. No help page is ever re-seeded.
  - Link blocks elsewhere are removed. Those pages get `version + 1` (so an open editor reloads on its next save), but their `updatedAt` stays the same.
  - `settings.uiPrefs.lastTextbookPageId` and `collapsedPageIds` forget the deleted pages.
- **Autosave (`PUT …/blocks`).**
  - 409 `VERSION_CONFLICT` when stale. 422 for duplicate block ids, or an id that already belongs to another page; block ids are global primary keys.
  - A link to a page that no longer exists, or a chart whose asset is gone, is saved as `null` rather than failing the save.
  - The event stores only `{pageId, version, blockCount}`, with no diff.
- **Chart blocks.** `name` is stored per block. The upload response's `name` is the uploaded file's base name, even when the upload was deduplicated onto an existing asset.
- **Upload flow.** Call `POST /textbook/charts`, put `assetId` into a chart block, and let autosave run.
  - An asset that no block uses is kept for `GC_GRACE` (1 h). A re-upload restarts that grace period.
  - An asset that a save or delete just stopped using is collected at once, together with its file, unless it was uploaded again after that page last saved it. An upload answer is always honoured: its `assetId` stays valid for the grace period, even if a save that removes an older block with the same (deduplicated) asset commits first.
  - `warnings` holds one sentence when the HTML loads from the web: "x.html loads from the web (fonts.googleapis.com). Charts run offline, …". Both `http(s)://` and protocol-relative `//host/…` references count (in quotes, `url(…)` or attribute values; JavaScript `// comments` do not). XML namespace URIs do not count.
  - The 413 message is "{name} is over 4 MB; charts that large cannot be saved." Checking `file.size > 4 MB` in the client first saves the upload.
  - A body over 4 MB + 64 KiB is read and discarded as it arrives, then answered 413 before the form is parsed, so nothing is spooled to disk.
- **Counts.**
  - Words are counted as the prototype counts them: a non-empty text of only spaces is 1 word, and formulas do not count.
  - Charts are chart blocks that have an asset. The design seed gives 4 pages · 3 sections · 1 live chart · 256 words, which matches the `textbook-home` baseline.
- **Search.**
  - Case-insensitive substring match on titles and on the text of text and formula blocks. Chart file names are not searched.
  - Results come as the prototype lists them: flat, section by section, and within a section in creation order (a sub-page created later comes after its parent's later siblings). `snippet` is `""` for a title match; otherwise it is the matching block, cut to about 160 characters around the match with `…`.
- **Serving.**
  - `create_app` calls `app.api.static.install_static(app, cfg.frontend_dist)`, which sets the router's default handler. Any real route therefore wins, including routes a test adds later.
  - `/assets/*` is served `immutable`, and a missing asset is a 404.
  - Any other non-`/api` GET or HEAD gets `index.html` with `no-cache`.
  - `/charts/*`, `/docs` and `/redoc` are always 404.
  - If `dist/index.html` is missing, the page is a 503 saying "run make build"; the API keeps working.
- **CLI.** `remi db path|upgrade|backup` accepts `--data-dir` either before or after `db`. `make serve` sets `REMI_ENV=prod` and `REMI_FRONTEND_DIST`, then runs `python -m app.main --host 127.0.0.1 --port 8765`.

## Requests

1. *(Withdrawn: the upload route now bounds the body itself; no middleware change is needed.)*
2. **Owner of `services/views.py` (R-read), performance only.** Every Textbook event, including each autosave every 350 ms while typing, bumps `remi_events.seq`. That seq is the plan revision and ETag. So the next `GET /plan` rebuilds the plan and returns 200 instead of 304. Consider keying the plan cache on the latest *plan-affecting* event, for example ignoring `textbook.*` event types. Nothing is wrong today; it only costs time.
3. **Owner of `docs/api.md`.** Worth adding:
   - the blank-label rule for `PATCH /textbook/sections/{id}` (already in the route description and the TS types);
   - the upload `warnings`;
   - the 1 h grace before an unused upload is collected.
4. **Owner of `dev_fixtures.load_fixture`.** The `empty` fixture deletes the `chart_assets` rows but leaves the files on disk. The next Textbook GC sweeps them, since stray `<sha>.html` files with no row are collected. To sweep at once, register `chart_store.schedule_gc(m.uow, uow_factory, config.data_dir)` in `load_fixture`'s `change`. I did not, because it is outside the Textbook part of the file.
