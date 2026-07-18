# Android live-scan for Scantron — HTTPS PWA + TWA, images to your Drive

## Context

The research in `research/` describes ZipGrade's phone workflow: pick a form, key the quiz,
align four corner squares, **hands-free auto-capture**, instant grade, then review/override the
stored paper image. Scantron already replicates the OMR core (`buildLayout` → `readSheet`, shared
print/scan geometry) and already **beats ZipGrade on privacy**: it stores *no image* and no third
party ever touches student data — the camera/photo frame is decoded to answers in the browser and
only answers + score go to the teacher's own Google Sheet via the Apps Script bridge (JSONP).

Two gaps remain versus the ZipGrade experience wanted on Android:

1. **No live camera in the Apps-Script-served build.** Verified and unfixable: HtmlService serves
   the page inside a `googleusercontent.com` sandbox iframe that withholds camera permission, so
   `getUserMedia` dies with *"camera is not allowed in this document."* Today the served build sets
   `SERVED_BUILD = true` and hides camera mode, leaving one-tap Photo upload.
2. **No stored paper image** for ZipGrade-style review/override.

**Decisions taken:** live auto-capture matters → serve the page from a real HTTPS origin you control
(Apps Script stays as the data bridge only); package it as an installable **Android app (TWA)**; and
**save each scanned image to your own Google Drive** for review.

The key realization that makes this work *while keeping the Apps Script handling*: only the **page
serving** moves off Apps Script. A TWA renders your HTTPS page in **real Chrome**, so (a) the page is
a top-level HTTPS origin → camera works, and (b) Chrome's cookie jar still carries your Google
session → the existing JSONP calls to `/exec` (Execute-as-User) keep working unchanged. A
bundled-WebView wrapper would break this — Google blocks its OAuth/session inside embedded WebViews —
which is exactly why TWA (not Capacitor/Cordova) is the right wrapper here.

## Approach

Build in phases; **Phase 1 alone delivers live camera on Android** and each later phase is optional
polish. `Code.gs` and the OMR pipeline are essentially untouched.

### Phase 1 — Serve `index.html` from a real HTTPS origin (unlocks live camera)

- **Host:** Firebase Hosting (recommended — stays in *your* Google account, free HTTPS, you control
  the response `Permissions-Policy`). GitHub Pages is an acceptable lighter alternative: it serves
  only the static app shell, and no student data/images ever pass through it (those go
  phone → your `/exec` → your Sheet).
- **Bake the bridge URL like `serveApp` does, but at deploy to the host.** Keep
  `const DEFAULT_BRIDGE_URL = ''` a single-quoted one-liner ([index.html:919](../index.html#L919)); a
  tiny deploy step rewrites it to your `/exec` URL in the hosted copy (mirror of `serveApp`'s regex
  rewrite in `Code.gs`). Leave `SERVED_BUILD = false` ([index.html:937](../index.html#L937)) so camera
  mode stays — this origin is a top-level Chrome tab, not Apps Script's sandbox iframe, so
  `getUserMedia` is allowed. No change to the camera loop or `readSheet`.
- **PWA installability + offline** (also a TWA prerequisite):
  - Add `<link rel="manifest" href="manifest.webmanifest">` in `<head>` (before
    [index.html:470](../index.html#L470)) — a `<link>`, **not** a script.
  - Add `manifest.webmanifest` (name, `display:standalone`, `start_url:"."`, theme color, 192/512
    icons) and PNG icons as separate files.
  - Register a service worker **inside the existing single `<script>` block** (near the top, after
    [index.html:903](../index.html#L903)); `sw.js` is a separate file that cache-first serves the app
    shell for offline scanning. **Do not add a second `<script>` tag** — `test-omr.mjs` and
    `test-import.mjs` extract code by regex over the one block (see CLAUDE.md); a second tag breaks
    them.
- **Files:** `index.html` (manifest link + SW registration only), new `manifest.webmanifest`,
  `sw.js`, `icons/`. A small `deploy` note/script that bakes `DEFAULT_BRIDGE_URL`.

### Phase 2 — Install on Android (no store needed)

From Android Chrome at the HTTPS origin, **Add to Home Screen** yields a standalone app with live
camera, offline, and your Google session intact. This already satisfies "an app on Android." Nothing
to build.

### Phase 3 — Wrap as a TWA APK (the "real app")

- Use **Bubblewrap** (or **PWABuilder**) to wrap the Phase-1 PWA into a Trusted Web Activity. No
  `index.html` changes — the TWA just renders the same HTTPS PWA in Chrome, so camera + JSONP auth
  behave identically to Phase 2.
- Add `/.well-known/assetlinks.json` (Digital Asset Links) to the HTTPS host to verify app↔origin
  ownership and drop the URL bar.
- Output: a signed APK to sideload, or a Play Store listing if you want one.

### Phase 4 — Scanned images → your Google Drive (ZipGrade-style review/override)

- On a stable or low-confidence read, keep the captured frame as a JPEG blob (the scanner already has
  the frame in `workCanvas`; `canvas.toBlob`).
- **Save on-device first:** write the blob to **IndexedDB** keyed by class/quiz/student/`writeId`.
  This gives instant, offline review and matches "on the device **and** in Drive."
- **Upload to your Drive with Google Identity Services (GIS) + Drive REST**, not through Apps Script.
  Why not the bridge: JSONP is GET-only and can't carry a full image; a cross-origin `fetch` POST to
  `/exec` has no CORS headers and the Execute-as-User session problem. So the page uploads the blob
  directly to *your* Drive via `files.create` (multipart) into a `Scantron/<class>` folder — entirely
  in your own Google account, no third party. GIS sign-in works because a TWA is real Chrome (not an
  embedded WebView, where Google blocks it). Use the narrow **`drive.file`** scope (app only sees
  files it creates); it's a **front-end** grant, independent of the bridge's OAuth, so it does **not**
  force re-granting the Apps Script authorization (avoids the CLAUDE.md DriveApp-scope pitfall — keep
  `DriveApp` out of image handling in `Code.gs`).
- **Link the image to the row:** pass the returned Drive `fileId` to the existing `submit` action as
  an optional `imageId` param; store it in one new column on the quiz tab (append-only, consistent
  with how rescans append). Minimal `Code.gs` change: accept/store `imageId`, pass it through
  `getGradebook`/quiz reads.
- **Review Papers screen (new, client-side):** list a quiz's scans, fetch each image by `fileId` with
  the same GIS token, and let the teacher override the decoded bubbles using the **existing**
  manual-override UI on `readSheet`'s output, then re-`submit` (rescan already appends, newest wins).

## Files to touch

- `index.html` — manifest `<link>`, in-block SW registration, keep `DEFAULT_BRIDGE_URL`/`SERVED_BUILD`
  one-liners; Phase 4 adds capture-to-blob, IndexedDB cache, GIS+Drive upload, and the Review screen.
- New: `manifest.webmanifest`, `sw.js`, `icons/`, `/.well-known/assetlinks.json` (Phase 3), a deploy
  step that bakes the bridge URL.
- `Code.gs` — Phase 4 only: accept/store an optional `imageId` on `submit` and surface it in reads.
  No `DriveApp` for images. Redeploy a new version (same `/exec`).

## Verification

- **Tests still green:** `node test/test-omr.mjs`, `node test/test-bridge.mjs`, `node
  test/test-import.mjs`. Critical checks: still exactly one `<script>` block, `parseImportLine`
  unchanged, `DEFAULT_BRIDGE_URL`/`SERVED_BUILD` still one-liners (Test 8d in `test-bridge.mjs` runs
  `serveApp` against the real `index.html`).
- **Phase 1 on Android:** deploy to the HTTPS host, open in Android Chrome, start Camera scan, and
  confirm live auto-capture works and a scored row lands in the class Sheet (proves the Google session
  carries over JSONP from the new origin).
- **Phase 3:** build the TWA with Bubblewrap, sideload the APK, repeat the Android camera + grade
  check inside the app; confirm no URL bar (asset links verified).
- **Phase 4:** scan a sheet, confirm the JPEG appears in `Drive/Scantron/<class>`, the quiz row holds
  its `fileId`, and the Review screen renders the image and re-scores after an override.
- Re-run the existing `test-omr.mjs` synthetic-photo cases to confirm the OMR pipeline is byte-for-byte
  unchanged by the packaging work.

## Notes / risks

- **Firebase vs GitHub Pages:** recommending Firebase since it stays in your Google account; GitHub
  Pages is fine (shell-only, no data) if you'd rather not stand up Firebase.
- **GIS SDK** loads from Google's own `gstatic`/`accounts.google.com` — Google infrastructure, no
  student data sent to it; watch for any CSP you add on the host.
- Phases 2/3 are independent: an installed PWA (Phase 2) already gives you the app + live camera; the
  TWA (Phase 3) is only for a true APK / Play Store presence.
