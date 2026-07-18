# Scantron on GitHub Pages — single-user Android live-scan + images to Drive

## Context

You want ZipGrade-style **live camera scanning on your Android phone**. The Apps Script-served build
can't do it: HtmlService renders the page in a `googleusercontent.com` sandbox iframe that withholds
camera permission (`getUserMedia` → *"camera is not allowed in this document"*), and that's unfixable
from Apps Script. The fix is to serve `index.html` from **GitHub Pages** — a real HTTPS *top-level*
origin in Chrome, where the camera is allowed — while your **existing Apps Script bridge stays exactly
as-is** as the data API. This is scoped to **you as a single user**; opening it to more teachers is a
later decision.

Alongside the move, add ZipGrade's one missing capability: **save each scanned sheet image to your own
Google Drive** so you can review a paper and override an ambiguous read.

**Privacy is preserved.** GitHub serves only the static app shell — no student data or images ever
pass through it. Decoded answers still go phone → your `/exec` → your Sheet; images go phone → your
Drive. No third party stores or transports student data.

Two hard constraints carried from the codebase:
- **One `<script>` block only.** `test-omr.mjs` and `test-import.mjs` extract code by regex over the
  single block ([index.html:903](../index.html#L903)–[3435](../index.html#L3435)). Never add a second
  `<script>` tag; register the service worker and load any external SDK **from inside** that block.
- **Keep `DEFAULT_BRIDGE_URL` / `SERVED_BUILD` as bare one-liners**
  ([index.html:919](../index.html#L919), [937](../index.html#L937)) — `serveApp`'s regex and
  `test-bridge.mjs` Test 8d depend on it.

---

## Part A — GitHub Pages PWA (unlocks live camera)

1. **Repo + Pages.** Create a repo (public is fine — there are no secrets; the `/exec` URL is
   auth-gated anyway). Put `index.html` at the root, enable GitHub Pages. Add an empty **`.nojekyll`**
   file so a future `.well-known/` (for a TWA) isn't stripped by Jekyll — harmless now.
2. **Bridge URL stays in localStorage.** Leave `DEFAULT_BRIDGE_URL = ''`; on first load paste your
   `/exec` into the connect screen once. `store.bridgeUrl` reads localStorage first
   ([index.html:952](../index.html#L952)), so it persists per device. Leave `SERVED_BUILD = false` so
   camera mode stays (this origin isn't Apps Script's sandbox iframe).
3. **PWA plumbing (also makes it installable):**
   - `manifest.webmanifest` — name, `display:"standalone"`, `start_url:"."`, theme color, 192/512
     icons.
   - `<link rel="manifest" href="manifest.webmanifest">` in `<head>` (before
     [index.html:470](../index.html#L470)) — a `<link>`, **not** a script.
   - `sw.js` — cache-first for the app shell (offline scanning). **Register it inside the existing
     `<script>` block** near [index.html:903](../index.html#L903); `sw.js` itself is a separate file,
     never a `<script>` tag.
   - `icons/` PNGs.
4. **Install on the phone.** Open the Pages URL in **Android Chrome** (signed into your Google
   account) → **Add to Home Screen** → grant camera once. Live auto-capture runs through the existing
   `scanLoop`/`readSheet` unchanged.

**Files:** `index.html` (manifest link + in-block SW registration only), new `manifest.webmanifest`,
`sw.js`, `icons/`, `.nojekyll`.

---

## Part B — Save scanned images to your Drive (review / override)

**Reuse points:** `workCanvas` holds the captured frame in both the camera loop
([index.html:3208](../index.html#L3208)) and photo path ([index.html:3351](../index.html#L3351));
`onSheetCaptured` ([3265](../index.html#L3265)) and the photo handler ([3344](../index.html#L3344))
are the capture hooks; `applyScanResult` ([3291](../index.html#L3291)) already fills the editable grid
(`grGrid`/`grAnswers`/`grStudentId`) = the override UI; `scoreAndSave`
([2488](../index.html#L2488)) builds the `submit` payload with `writeId`; `getResults`
([Code.gs:653](../Code.gs#L653)) lists a quiz's rows.

1. **Capture a blob.** At capture, `workCanvas.toBlob(blob => …, 'image/jpeg', 0.7)`; keep it with the
   pending scan.
2. **On-device first.** Store the blob in **IndexedDB keyed by `writeId`** — survives offline and gives
   instant review without a network round trip.
3. **Upload to Drive via Google Identity Services (`drive.file` scope):**
   - **Dynamically inject** the GIS client (`accounts.google.com/gsi/client`) from JS — no static
     `<script>` tag (honors the one-block rule).
   - `initTokenClient({ scope: 'drive.file' })` → one consent on first scan; cache the token in memory.
   - `files.create` (multipart) into a `Scantron/<class>/<quiz>` folder → returns a `fileId`.
   - `drive.file` (app only sees files it creates) is a **front-end** grant, independent of the
     bridge's OAuth, so it does **not** re-trigger the Apps Script authorization — keep `DriveApp` out
     of `Code.gs` (avoids the CLAUDE.md DriveApp-scope pitfall).
4. **Link the `fileId` to the row.** Add `imageId` to the `scoreAndSave` payload
   ([index.html:2490](../index.html#L2490)). In `Code.gs`, `submit` ([612](../Code.gs#L612)) pushes a
   trailing **"Image"** column after the answer columns (`row[5 + numQuestions]`, past `markWrongAnswers`
   so highlighting is unaffected); `getResults` ([653](../Code.gs#L653)) reads one extra column and
   returns `imageId`. **Redeploy a new bridge version** (same `/exec`).
5. **Offline path.** If the network is down, queue the `submit` (existing `store.queue`,
   [index.html:2524](../index.html#L2524)) and keep the blob in IndexedDB by `writeId`; on flush, upload
   the blob → `fileId` → include it in the retried `submit`. *v1 simplification if this gets fiddly:*
   always cache the blob locally, upload to Drive only when online.
6. **Review / override screen (new, client-side).** From the Quizzes results (`getResults` rows, now
   carrying `imageId`), open a paper → show the image (IndexedDB first, else fetch from Drive by
   `fileId` with the same token) beside the decoded answers in the **existing** grid → edit → re-run
   `scoreAndSave` (a rescan appends; newest timestamp wins per student, as today).

**Files:** `index.html` (capture-to-blob, IndexedDB helper, dynamic GIS + Drive upload, `imageId` in
payload, Review screen); `Code.gs` (`imageId` trailing column in `submit` + `getResults`).

---

## Verification

- **Tests still green:** `node test/test-omr.mjs`, `node test/test-bridge.mjs`, `node
  test/test-import.mjs`. Confirm: still exactly one `<script>` block, `parseImportLine` unchanged,
  `DEFAULT_BRIDGE_URL`/`SERVED_BUILD` still one-liners (Test 8d runs `serveApp` over the real
  `index.html`).
- **Part A on the phone:** open the Pages URL in Android Chrome → Add to Home Screen → Start camera →
  confirm live auto-capture reads a sheet and a scored row lands in the class Sheet (proves the Google
  session carries over JSONP from the new origin, and the camera works at a top-level HTTPS origin).
- **Part B:** scan a sheet → the JPEG appears in `Drive/Scantron/<class>/<quiz>`, the quiz row's
  **Image** column holds the `fileId`, and the Review screen renders the image and re-scores after an
  override. Confirm the `drive.file` consent appears once and doesn't disturb the bridge's existing
  auth.
- **Desktop `file://` build unaffected:** `DEFAULT_BRIDGE_URL` empty, camera still on, same behavior as
  before.

## Notes

- **Public repo is fine** — no secrets; keep `DEFAULT_BRIDGE_URL` empty so the `file://` copy and any
  future shared copy behave identically.
- **`.nojekyll` now** saves a headache if you later wrap this as a TWA (which needs
  `/.well-known/assetlinks.json` served from the Pages root).
- **GIS SDK loads from Google's own origin;** no student data is sent to it. GitHub Pages sets no CSP
  by default, so the dynamic GIS load and `googleapis.com` calls are unblocked.
- **Opening to more users later** (Model A: one shared bridge + per-teacher authorize; Model B: each
  teacher deploys their own) is deliberately out of scope here.
