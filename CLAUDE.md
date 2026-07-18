# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A ZipGrade-style bubble-sheet grader with no server and no build step: `index.html` is the entire
app, and `Code.gs` is a Google Apps Script web app — "the bridge" — that owns Google Sheets as the
database. See README.md for setup and daily workflow.

`index.html` runs in **two contexts**, from one file: opened straight from the filesystem, or served
by the bridge at its own bare `/exec` URL (`serveApp`, mirroring Roll Call!'s `serveDashboard`).
Both talk to the bridge the same way — see "Serving the app" below.

## Commands

```
node test/test-omr.mjs      # scanner pipeline — ~5 min (renders synthetic warped "photos")
node test/test-bridge.mjs   # Apps Script bridge against mocked services — fast
node test/test-import.mjs   # roster import parser — fast
```

There is no build, lint, package.json, or test runner. Each test is a standalone Node script that
prints ✓/✗ lines and exits non-zero on failure; there is no way to run a single case short of
editing the script. To "run" the app, open `index.html` in a browser.

Both `test-omr.mjs` and `test-import.mjs` reach into `index.html` by regex — `test-omr.mjs` matches
`/<script>([\s\S]*)<\/script>/` and evaluates the whole script under a stub DOM (so it doubles as a
syntax check on the app), and `test-import.mjs` extracts `parseImportLine` with
`/function parseImportLine\(line\) \{[\s\S]*?\n\}/`. Renaming that function, adding a second
`<script>` tag, or introducing browser APIs the stub doesn't implement will break the tests for
reasons unrelated to the change.

Changes to `Code.gs` reach users only after **Deploy → Manage deployments → Edit → New version**
(which keeps the same `/exec` URL). A client change that calls a new action fails against an
un-redeployed bridge with `Unknown action: …`. The same is true of `index.html`: the Apps Script
project holds a hand-pasted *copy* under the same name, so a change here reaches the served build
only after re-pasting **and** redeploying. The disk copy updates the instant you save.

## Serving the app

`serveApp()` answers the bare `/exec` URL with `index.html`, rewriting `const DEFAULT_BRIDGE_URL`
to `ScriptApp.getService().getUrl()` on the way out — so the served build is connected on arrival
and never shows the connect screen. This is necessary, not a convenience: HtmlService sandboxes the
page onto a `googleusercontent.com` origin, so `window.location` is the sandbox, not the web app,
and the page cannot discover its own bridge. Only the server can.

`store.bridgeUrl` reads localStorage first and falls back to the constant, so a hand-pasted URL
still wins and the `file://` copy (constant left `''`) behaves exactly as before. A `/dev` URL is
deliberately *not* baked in — `getUrl()` returns it when run from the editor, and the app can't
call it. Test 8d in `test-bridge.mjs` runs `serveApp` against the real `index.html`, so it fails if
that constant is renamed or restyled and the regex silently stops matching.

The served page is cross-origin to the bridge, so **JSONP is still required** — being served by the
bridge buys no same-origin privileges. The two contexts also keep **separate localStorage**, being
separate origins.

**The served build has no camera, and this is not fixable.** Verified against a real deployment:
`getUserMedia` there dies with *"Permissions policy violation: camera is not allowed in this
document."* Camera permission must be granted at every hop of `/exec` → Google's iframe →
`userCodeAppPanel` → this page, and we control none of those iframe tags — there is no
`allow="camera"` reachable from Apps Script, and embedding `/exec` in your own permissive iframe
doesn't help either, since Google's inner frame still won't propagate it. So `serveApp` flips
`SERVED_BUILD`, and the page removes camera mode outright rather than showing a dead button. Don't
"fix" this by retrying getUserMedia or sniffing for a workaround; the only route to live camera on a
phone is hosting `index.html` on a real HTTPS origin, which the bridge is not.

Photo mode works in both contexts (a plain file input; on a phone it opens the camera app), and
`file://` keeps live scanning. Note that camera failures report into `#scanStatus` inline, not only
via `toast()` — the toast is `position:fixed`, which anchors to the *iframe* viewport in the served
build and can fire off-screen, making a real error look like a dead button.

## Architecture

**Central-bridge model** (mirrors the sibling "Roll Call!" app kept in [reference/](reference/) —
`bridge.gs` and `dashboard.html` are that app's files, for comparison, not part of this one). One
Apps Script deployment serves every class. Each class is its own Google Sheet the bridge creates on
demand; the class registry lives in the teacher's **User Properties**, which is why the deployment
must be *Execute as: User accessing the web app*.

The registry is the single source of truth. Class-management actions (`createClass`, `listClasses`,
`registerClass`, `updateClass`, `deleteClass`) need no Sheet; every other action carries a `classId`
the bridge resolves to a spreadsheet, so the browser never holds a Sheet id. `store.classes` in
localStorage is only a cache of the last `listClasses` response so the tab bar can paint early.

**Sheet layout** (constants at the top of [Code.gs](Code.gs)): tab 1 is `student-info` (roster — ID
in A, `Last, First` in B, C/D split from B by formula). Every later tab is one quiz: row 1 metadata
starting with the `SCANTRON` marker, row 2 the answer key, row 3 headers, row 4+ responses. A tab is
a quiz iff A1 === `SCANTRON`, which is how `listQuizzes` skips the roster.

**Scoring is server-side, always.** `submit` scores against the key in the sheet; `updateKey`
rewrites the key and rescores every existing row. Blank key entries are unscored (0 points possible)
in both `scoreAnswers` and `keyPossible` — keep those two in agreement.

**`getGradebook`** exists so the scores grid is one round trip: it crosses the roster with every
quiz, reading only columns A–E. A rescan appends a new row rather than replacing, so the newest
timestamp wins per student per quiz. `null` means never sat the quiz and must stay distinct from a
real 0. Scans whose ID matches nobody are surfaced as `unmatched`, never dropped.

**Shared geometry is the core idea.** `buildLayout(formKey)` in [index.html](index.html) defines every
bubble position in **inches** on a US-letter page, and that one layout drives *both* the printed SVG
sheet (`renderSheetSVG`) and the scanner (`readSheet`): the scanner finds the four corner fiducials,
computes a homography from normalized fiducial-rect coordinates back to image pixels, and samples
each bubble's darkness (inner disk vs. surrounding ring). A bubble added to the layout is
automatically findable in a photo — so never hardcode coordinates in the renderer or the scanner.

## Transport: JSONP GET, deliberately

Reads *and* writes are `GET`s with `?callback=`, via injected `<script>` tags. This is forced by
*Execute as: User accessing the web app*: Google requires a signed-in caller, a cross-origin
`fetch()` from `file://` carries no session and dies at the login redirect with no CORS headers, and
a `<script>` tag does send the cookie. The transport and the deployment mode are a pair — switching
to `fetch` also means switching to *Execute as: Me* + *Anyone*. (README.md's "How it works" section
still describes `text/plain` POSTs; that's stale — the code is JSONP.)

Consequences: array params (`key`, `answers`, `students`) arrive as JSON *strings*, hence
`parseArrayParam`. Writes carry a `writeId` that `handle()` dedupes through CacheService, because the
offline queue retries writes whose response was lost. `WRITE_ACTIONS` exists in both files and must
stay in sync. The callback name is regex-checked before being echoed into executable JS.

## OAuth scopes

Apps Script picks scopes by statically scanning `Code.gs` and asks once, at authorization. Using a
service the user didn't grant fails at runtime with `You do not have permission to call …`, and the
web app cannot prompt (a consent screen can't render in a `<script>` tag) — the user has to
Run → `setup` from the editor. So: **DriveApp is touched only inside the optional folder feature** of
`createClass`. Don't reach for DriveApp elsewhere (e.g. to confirm where a new Sheet landed) — it
would make every teacher re-grant a full Drive scope.

## Planning docs

[plans/todo.md](plans/todo.md) is the running list, [plans/priority-tasks.md](plans/priority-tasks.md)
is what's actually being worked on now, and finished plans move to [plans/completed/](plans/completed/)
named after the work rather than the date.
