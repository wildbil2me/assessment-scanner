# Suite Execution Guide

How a suite app is built, structured, and shipped. These are the engineering rules that
made Roll Call! survivable for one maintainer with no build pipeline — inherit them
wholesale.

## 1. Architecture invariants

1. **One HTML file is the entire frontend.** HTML + CSS + JS in a single `src/<app>.html`.
   It must work in two contexts from the same source: **Local** (opened from `file://`)
   and **Served** (pasted into the Apps Script project and served by `HtmlService` at the
   bridge URL). Anything context-specific is feature-detected, never forked into two files.
2. **Zero dependencies, no build step for the app.** `package.json` stays private and
   empty of deps; no linter, no test framework, no bundler. The only build in the repo is
   the optional demo generator (`node tools/build-demo.mjs`), which has zero deps itself.
3. **Google Sheets is the database.** One spreadsheet per class/unit-of-work, with a
   documented tab-and-column layout. The sheet layout **is** the schema — document it in
   `CLAUDE.md` before writing code, and give every generated sheet a hidden meta tab
   (label-value rows in A:B: `schemaVersion`, config JSON, `created`). The meta tab is how
   a sheet identifies itself; linking an existing sheet must verify it server-side.
   `SCHEMA_VERSION` is the layout's contract number: accept older, refuse newer.
4. **An Apps Script Web App is the sole backend** (`src/bridge.gs`), deployed
   **Execute as: User accessing the web app** so each teacher's data and registry
   (UserProperties) are isolated. There is no central server, ever.
5. **ES5-flavored JS.** `var`, `function`, string concat over template literals in new
   code paths that render HTML with inline `onclick="..."` handlers. Consequence:
   **never trust a linter's dead-code report** — half the functions are referenced only
   inside HTML strings.

## 2. The transport layer (non-negotiable)

The page runs from `file://`, so CORS rules out normal fetch. Two patterns only:

- **Reads = JSONP.** `jsonpFetch(url, onSuccess, onError)` injects a `<script>` whose
  `src` carries `?action=...&callback=_cbN`; the bridge replies with `_cbN({...})`.
  15s timeout; on timeout the callback is swapped for a self-cleaning no-op (a late
  response calling a deleted global would throw).
- **Writes = outbox + acknowledged GET.** `bridgePost(payload, onDone)` never touches the
  network directly: it appends `{ writeId, params, ts }` to a persistent
  `localStorage` outbox and calls `drainOutbox()`. The drain sends one item at a time as a
  JSONP GET, removes it **only when the bridge's callback confirms it**, retries with
  exponential backoff (2s → 60s cap), survives reloads, and pauses when
  `navigator.onLine === false`. Every write carries a `writeId` the bridge dedupes via
  `CacheService`. A bridge-side *rejection* (`data.error`) drops the item instead of
  wedging the queue.
- **Never use POST.** Apps Script 302-redirects before `doPost`; browsers convert
  POST+302 to GET and drop the body. Never bypass the outbox for a mutation.

Bridge response contract: every action returns
`{ ok: true, ... }` or `{ error: 'message' }`, JSONP-wrapped by a shared
`respondOk`/`respondErr` pair that also handles the writeId dedupe.

## 3. localStorage conventions

Namespace every key with the app's prefix (Roll Call! uses `rollcall_`):

| Key pattern | Purpose |
|---|---|
| `<app>_bridge_url` | The teacher's deployed bridge URL (set by connect screen / Settings). |
| `<app>_config` | UI config; merged over a `CONFIG_DEFAULTS` object on load so new keys get defaults for free. |
| `<app>_outbox` | The write queue. |
| `<app>_snap_<id>` | Per-class data snapshots for offline/stale display (72h max age), powering the stale banner. |

`DEFAULT_BRIDGE_URL` in source is a personal-convenience fallback only — blank it (`''`)
in anything distributed.

## 4. Repo layout

Mirror the parent repo exactly:

```
README.md  CLAUDE.md  package.json  .gitignore     ← the ONLY root files
src/        <app>.html, bridge.gs
demo/       demo-engine.js (hand-written), demo.html (generated, git-ignored)
tools/      build-demo.mjs
docs/       DOCUMENTATION.md, FERPA.md, CHANGELOG.md
plans/      ROADMAP.md, TESTING.md, todo.md, per-phase plans
site/       blog/, guides/, screenshots/ — published web content
backup/     dated snapshots — never read or modified by tooling
design/     (this framework, if the app carries its own copy)
```

If you're about to add a fifth root file, it belongs in a folder.

## 5. Demo build

The public demo is the whole app against an in-memory fake bridge, no Google account:

- `demo/demo-engine.js` implements `demoBridge(params)` mirroring every bridge action,
  plus seed-data builders.
- The app declares `var DEMO = typeof demoBridge === 'function'` — **presence is the
  switch**; the shipped app can never enter demo mode.
- `tools/build-demo.mjs` copies `src/<app>.html`, inlines the engine at an
  `<!-- DEMO-ENGINE-INJECT -->` marker ahead of the app's own script, and force-blanks
  `DEFAULT_BRIDGE_URL`. Rerun it after any change to either input.
- `if (DEMO)` guards sit at the seams only: `jsonpFetch`, `drainOutbox`, outbox
  load/save, snapshots, `saveConfig`, `window.onload`.

## 6. Deployment discipline

- Deploy bridge.gs as Web App, **Execute as: User accessing the web app**; push updates
  via **Manage Deployments → Edit → New version** so the URL never changes.
- The bare `/exec` URL serves the dashboard via
  `HtmlService.createHtmlOutputFromFile('dashboard.html')`. The Apps Script project is
  **flat** — that filename refers to a file inside the deployed project, not your disk.
  Never rewrite it to a `src/` path; it breaks the Served build with no local symptom.
- Served-build update = paste the full contents of `src/<app>.html` into the project's
  `dashboard.html` file and redeploy. Bridge changes always require a redeploy.

## 7. Verification & git

- **No test framework, by design.** Verify by driving the built demo in headless
  Edge/Chromium over CDP, plus the manual smoke-test checklist in `plans/TESTING.md`
  before merging any phase branch.
- **One integration branch: `main`** — also the GitHub default. Phase branches
  `phase/<letter>-<slug>` are cut from `main`, merged back, deleted. Never keep an
  "identical alias" branch; that's how docs start lying.
- Commit style: short imperative summary line; body optional for small changes.

## 8. Cross-file couplings — document every one

Some constants exist on both sides of the bridge and nothing enforces agreement (e.g.
Roll Call!'s `CONSEC_ABSENCE_LIMIT` in both files, and the dashboard's literal
`'No School'` marker matching the bridge's exception list). When you create one:
declare it near the top of each file, and record the pairing in `CLAUDE.md` under a
"keep in sync" note. Same for time formats: bridge stores `'h:mm:ss a'` (no leading
zero) and the frontend's `formatTime()` must emit the identical shape.

## 9. Documentation contract

`CLAUDE.md` is the codebase guide (architecture, sheet schema, gotchas, scars —
*why* things are the way they are). `docs/DOCUMENTATION.md` is the full technical
reference. `docs/CHANGELOG.md` gets a line per notable change. Plans live in `plans/`,
never the root. When a decision reverses an old one, write down the reversal and the
reason where the old decision was documented.
