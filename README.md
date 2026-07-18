# Scantron — a ZipGrade-style bubble sheet grader

A multiple-choice quiz grader that runs entirely from **one local HTML file** and uses
**Google Sheets as its database** (via a Google Apps Script web app). No server, no accounts,
no install.

- **Each class is its own Google Sheet — and Scantron creates it for you.** One Apps Script
  deployment (the *bridge*) serves every class; your class list lives in your own Google account.
- **Tab 1 of each class Sheet is `student-info`** — the roster. Student ID in column A,
  `Last, First` in column B, last name in C and first name in D (C/D split from B automatically).
- **Import a roster** from a pasted list or a CSV (`ID, Last, First`), with a review step
  before anything is written — or add one student at a time.
- **Opening a class shows the Scores grid**: every student against their most recent
  assessments, colour-banded by percent. Click a name for that student's full history,
  or a score to open the whole quiz. A quiz a student never sat reads as a grey `–`,
  never as a zero.
- **Every quiz becomes another tab** in that same class Sheet (answer key + metadata in the header rows).
- **Student responses are scored and appended to that quiz's tab** — score, percent, and every
  answer, with wrong answers highlighted red.
- Grade by **camera scan** (point your phone/laptop camera at a filled bubble sheet),
  **photo upload**, or **manual/keyboard entry**.
- Print **bubble answer sheets** (20 / 50 / 100 questions) with corner markers and a
  student-ID grid directly from the app.
- Works offline: responses queue locally (remembering their class) and upload automatically
  when the bridge is reachable again.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app. Open it in any modern browser (Chrome/Edge/Safari). |
| `Code.gs` | The Apps Script bridge. Paste into **one** standalone Apps Script project (one-time setup). |
| `test/test-omr.mjs` | Node simulation test for the scanner pipeline (`node test/test-omr.mjs`). |
| `test/test-bridge.mjs` | Headless test of `Code.gs` against mocked Apps Script services. |
| `test/test-import.mjs` | Unit test for the roster import parser. |
| `docs/bug-report.md` | Template + checklist for reporting a bug. Start with Troubleshooting below. |

## One-time setup (~3 minutes)

You set this up **once**, not per class.

1. Go to **[script.google.com](https://script.google.com)** → **New project**. Delete the starter
   code and paste in the entire contents of `Code.gs`. Save.
   (A *standalone* project — don't bind it to a Sheet. The bridge creates the class Sheets itself.)
2. **File → + → HTML**, name it **`index.html`**, and paste in the entire contents of `index.html`.
   This is the copy the bridge hands out at its own URL.
3. **Run → `setup`** once. Google prompts for authorization; approve it. The execution log
   confirms the bridge can see your class registry.
4. **Deploy → New deployment → ⚙ type: Web app**
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone within your organization** (or **Anyone**)
   - Click Deploy and copy the web app URL (ends in `/exec`).
5. **Open the `/exec` URL.** That *is* Scantron, already connected to itself — the bridge bakes its
   own URL into the page it serves, so there's nothing to paste. Bookmark it on any device.
6. Click **+** in the class bar → **Create New Class**. Scantron makes a new Google Sheet in your
   Drive with a `student-info` tab. Optionally paste a Drive folder link to file it somewhere specific.

> **Two ways to run it, same app.** Opening the `/exec` URL is the easy path and the only practical
> one on a phone or iPad. Opening `index.html` straight from disk still works exactly as it always
> did — there it asks for the `/exec` URL on its connect screen. The two keep separate local
> settings (different browser origins), but both read the same class registry from the bridge.
>
> One difference: **live Camera scan only works from disk.** Google serves the app inside a sandboxed
> iframe that withholds camera permission, so the served build hides that mode and uses Photo upload
> — which on a phone opens the camera app anyway. See Troubleshooting.

> **Execute as: User accessing the web app** is what keeps each teacher's class list and Sheets
> their own — the bridge acts as whoever is signed in, so it can only touch that person's Drive.
> Your class registry is stored in your account's User Properties, never in a shared sheet.

### Redeploying after you edit `Code.gs`

Editing the code does **not** update the running web app. Push changes with
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the **same
`/exec` URL**, so you don't have to re-paste it in Settings. (Choosing *New deployment* instead
mints a *different* URL.)

The same applies to **`index.html`**: the project's copy is a *paste*, not a link. If you change
`index.html` here, re-paste it into the project's `index.html` file and deploy a new version, or
the served app stays on the old build while the disk copy moves ahead.

> **The Scores grid needs a redeployed bridge.** It calls the `getGradebook` action, which an
> older deployment doesn't know. Until you push a new version, the Scores tab reports
> *"Unknown action: getGradebook"* — everything else keeps working.

## Troubleshooting

- **"Could not reach the bridge" / nothing happens on connect** — in order:
  1. **Are you signed in to Google in this browser?** The bridge runs as *you*, so an unauthenticated
     browser can't call it at all. Open the `/exec` URL in a tab — you should get Scantron itself.
     If you get a login page, sign in and retry. (For a raw health check, add `?action=ping` — that
     still answers with JSON.)
  2. Confirm the URL ends in **`/exec`** (not `/dev`), and that you deployed a **new version** after
     your last code edit.
  3. Confirm *Who has access* includes your account (your domain, or Anyone with a Google account).
- **"You do not have permission to call DriveApp…"** (or any `…do not have permission to call…`)
  — your OAuth grant is **stale**. Apps Script picks its scopes by scanning the code and asks for
  them *once*, when you authorize; if the code later uses a service you hadn't granted, the call
  fails at runtime. The web app can't prompt you to fix it (a consent screen can't render inside a
  `<script>` tag), so refresh the grant from the editor: **Run → `setup`** and accept. If no prompt
  appears, revoke the project at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  and Run → `setup` again. Then redeploy a new version.
  - Only the **optional Drive folder** field needs Drive access. Creating a class, importing a
    roster, and grading all work without it — leave the folder blank and the Sheet lands in My Drive.
- **Opening the `/exec` URL shows JSON, not the app** — the deployed `Code.gs` predates `serveApp`,
  so it's still answering the bare URL the old way. Re-paste `Code.gs`, confirm the project has an
  `index.html` file too, and deploy a **new version**. (Both files, then deploy — updating one
  without the other is the usual cause.)
- **The served app asks for a bridge URL instead of connecting itself** — the URL-baking didn't
  happen. Either you're on the `/dev` test URL (which the bridge deliberately refuses to bake in,
  since the app can't call it), or the project's `index.html` copy is older than `serveApp`'s
  expectations. Re-paste `index.html` and deploy a new version. Pasting the `/exec` URL into the
  connect screen by hand also works.
- **There's no Camera scan option in the served app** — that's deliberate. Google serves the page in
  a sandboxed iframe that refuses camera permission (*"camera is not allowed in this document"*), and
  nothing in Apps Script can grant it, so the mode is hidden rather than left there to fail. Use
  **Photo upload**: on a phone it opens the camera app, which gives the scanner a sharper, better-lit
  image than live capture anyway. Open `index.html` from disk if you want live scanning.
- **`Unknown class`** — the bridge has no class registered under that id. Click **+** in the class
  bar and create one (or **Add Existing Sheet** to re-link a Sheet you kept).
- **Classes vanished after switching accounts** — expected. The registry lives in the signed-in
  user's properties, so each account has its own class list. Sign back in, or use **Add Existing
  Sheet** to re-link the Sheets (they're still in Drive).

> **Why JSONP and not `fetch`?** Because of *Execute as: User accessing the web app*. That setting
> makes Google require a signed-in caller, so it never serves the app anonymously. A cross-origin
> `fetch()` from a `file://` page carries no Google session, gets redirected to a login page that
> sends no CORS headers, and fails as a bare "Failed to fetch". A `<script>` tag isn't subject to
> CORS and does send the session cookie. So reads *and* writes are `GET`s with a `?callback=`,
> exactly as the sibling app's bridge does it. If you ever switch the transport back to `fetch`,
> you must also switch the deployment to *Execute as: Me* + *Anyone* — the two choices are a pair.

## Daily workflow

1. **👥 Students** → *Import Students* → paste `ID, Last, First` per line (or load a CSV),
   review the parsed rows, and import. They land in the class's `student-info` tab.
2. **New Quiz** → name it, pick the question count and choices, tap in the answer key →
   *Create quiz*. A new tab appears in that class's Google Sheet with the key in row 2.
3. **Print Sheets** → pick the matching form size (a 25-question quiz uses the 50-question form),
   print at **100% scale** on plain letter paper.
4. Students fill bubbles with pencil or dark pen; they can bubble their student ID in the top-right grid.
5. **Grade** → pick the quiz → **Start camera** → hold each sheet flat so the four black corner
   squares are in view. On a stable read the app beeps, fills in the detected answers, and
   (with *auto-save* checked) writes the scored row straight into the quiz's tab and waits for
   the next paper. Without auto-save, review the detected bubbles and hit *Score & save*.
   - No camera? Use *Photo upload* or type answers with *Manual entry* (fast field: just type `ABCAD…`).
6. Click a quiz on the **Quizzes** page for averages, per-student answer breakdowns, and
   per-question **item analysis** (% correct + most common wrong answer). Every number also
   lives in the Google Sheet tab, so you can chart/share/export from there.

Switch classes with the tabs in the header bar — one bridge serves them all, so switching
needs no reconnect.

## Updating an answer key

Re-key a quiz by calling the `updateKey` action (or edit the KEY row in the sheet tab, then
re-submit — the app scores server-side on each submission). `updateKey` rescores all existing rows.

## Scanning tips

- All **four corner squares** must be visible; lay the sheet flat, avoid glare and shadows.
- The scanner reads double-marks (e.g. `AB`) — they score as wrong unless the key is also `AB`.
- The camera won't re-save the same sheet twice in auto-save mode; remove the sheet from view
  and place the next one.

## How it works

`index.html` defines every bubble's position **in inches** in one shared layout module. The same
coordinates render the printable SVG sheets *and* drive the scanner: the app finds the four
corner squares in the camera frame, computes a perspective homography back to the layout, and
samples each bubble's darkness against the surrounding paper. Reads/writes go to Apps Script as
`text/plain` POSTs (no CORS preflight), and the Apps Script (`Code.gs`) owns everything
server-side: the class registry (User Properties), Sheet generation, the `student-info` roster
layout, one tab per quiz, scoring, and `LockService` for concurrent scans.

Class-management calls (`createClass`, `listClasses`, `registerClass`, `updateClass`,
`deleteClass`) need no Sheet. Every other call carries a `classId` that the bridge resolves to
that class's spreadsheet, so the browser never holds a Sheet id it could get wrong — the
registry is the single source of truth, and `index.html` only caches the last `listClasses`
response so the class tabs can paint before the network answers.

## Testing

```
node test/test-omr.mjs      # scanner pipeline  (~5 min — synthetic image rendering)
node test/test-bridge.mjs   # Apps Script bridge (fast)
node test/test-import.mjs   # roster import parser (fast)
```

- **`test-omr.mjs`** renders synthetic perspective-warped "photos" of filled sheets and asserts the
  scanner pipeline recovers the planted answers and student IDs (8 cases: all three forms, skew,
  noise, double-marks, blanks, partial forms). It also evaluates the whole `index.html` script under
  a stub DOM, so it doubles as a syntax/regression check on the app.
- **`test-bridge.mjs`** mocks `SpreadsheetApp`/`PropertiesService`/`DriveApp`/`LockService` and drives
  the real `Code.gs`: class creation puts `student-info` at tab 1 with the right columns, imports land
  in A/B without clobbering earlier rows, quizzes become later tabs, `listQuizzes` ignores the roster,
  classes stay isolated, and unknown classes fail with an actionable message instead of crashing.
- **`test-import.mjs`** extracts `parseImportLine` from `index.html` and checks the `ID, Last, First`
  parsing, header detection, extra-column warnings, and whitespace handling.
