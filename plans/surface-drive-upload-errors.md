# Surface Drive image-upload failures

## Context

Scanned sheet images stopped reaching Drive, and nothing in the app said so. The scans saved
normally, no toast fired, no console error — the failure was invisible until Drive was inspected
by hand.

Root cause of *this* incident: the rebrand (`f00d273`) renamed every localStorage key from
`scantron.*` to `quizsheets.*` with no migration, so the saved OAuth Client ID under
`scantron.driveClientId` became unreadable. `store.driveClientId` returns `''`, `getDriveToken`
throws on its first line, and the upload never runs.

But the incident is not the defect worth fixing. The defect is that `attachScanImage`
(index.html:3818) swallows *every* Drive failure:

```js
} catch (e) { /* Drive off or offline — retried on flush / re-scan */ }
```

Best-effort upload is the right design — a Drive problem must never block a score — but
"best-effort" was implemented as "silent", so a config loss, an expired token, a revoked scope, and
a genuine outage all look identical: like nothing happened. Re-pasting the Client ID fixes today's
symptom; this change makes the next one visible in seconds instead of by hand-inspecting Drive.

Goal: Drive failures stay non-blocking, but become visible — once per session as a toast,
persistently per-sheet in the batch tally, and with the actual cause retrievable in Settings.

## Out of scope

- The `scantron.*` → `quizsheets.*` key migration. There is one install; re-pasting the Client ID
  in Settings resolves it, and migration code for a single known device is not worth carrying.
- Any `Code.gs` change (so no redeploy) and any new OAuth scope.

## Changes — all in index.html

### 1. Drive trouble state + reporter

Add just above `attachScanImage` (index.html:3805):

- `let lastDriveError = ''` and `let driveWarned = false`.
- `noteDriveTrouble(e)` — records `e.message`, and toasts **once per session**:
  `Images are NOT being saved to Drive — <message>`. Once-per-session matters: toasting per sheet
  would fire 30 times through a batch and bury the message.
- `clearDriveTrouble()` — resets both, called on a successful upload.

Reset `driveWarned` from the existing `resetDriveAuth()` (index.html:3742) so saving a new Client
ID re-arms the warning.

`getDriveToken` already throws human-readable messages ("Drive image save is off — add an OAuth
Client ID in Settings…"), so no new message text is needed — the existing throws just need
somewhere to land.

### 2. Report an "expected but missing" image, not merely "no image"

`attachScanImage` returns nothing today. Change it to return a state so callers can distinguish
cases that must never be confused:

- `'none'` — no blob to save (hand entry, or an override reusing `reviewImageId`)
- `'saved'` — uploaded and `payload.imageId` stamped → `clearDriveTrouble()`
- `'failed'` — a blob existed and the upload threw → `noteDriveTrouble(e)`

This distinction is the point: a manual entry legitimately has no image and must not be flagged,
while a *scan* with no image is a real problem.

Thread it through `commitScore` (index.html:2671) — it already calls `await
attachScanImage(payload)` at index.html:2686 — and include `imageState` in its returned object
alongside `{ ok, data, student }`. Both callers (`scoreAndSave`, and the photo handler at
index.html:3878) already use that return value.

Apply the same reporting to the second swallow site, the queued-image upload in `flushQueue`
(index.html:2776).

`openReview` (index.html:2575) already surfaces its fetch error into `#reviewStatus` — leave it
alone.

### 3. Persistent per-sheet marker in the scan tally

A toast is missable mid-batch; the tally is the batch's durable record. In `addScanTally(res, out)`
(index.html:3526), carry `noImage: out && out.imageState === 'failed'` onto the pushed item, and in
`renderScanTally` (index.html:3542) append a `⚠ no image` chip built exactly like the existing
`⚑ review` and `⏳ queued` chips — reuse the `tally-flag` class, so **no new CSS**.

### 4. Make the cause retrievable in Settings

Reuse the existing `#driveStatus` element (already written to by the Save and Connect handlers,
index.html:3953-3964). In the `name === 'settings'` branch of `showView` (index.html:1262), after
setting `$('setDriveClient').value`, show `✕ Last Drive error: <message>` when `lastDriveError` is
set. This is where the user lands after the toast is gone, and it puts the real cause next to the
field that fixes it.

## Constraints to respect

- **One `<script>` block.** `test/test-omr.mjs` extracts the script by
  `/<script>([\s\S]*)<\/script>/`; a second tag breaks it (see CLAUDE.md).
- **Stub-DOM safe.** That test evaluates the whole script under a stub DOM, so any new element
  access must null-check the way `renderScanTally` already does
  (`const el = $('scanTally'); if (!el) return;`).
- Drive stays strictly best-effort: no new path may throw out of `commitScore` or block a save.

## Verification

- `node test/test-omr.mjs` — must stay at 20/20 and print "app script evaluated OK" (doubles as the
  syntax check on these edits).
- `node test/test-bridge.mjs` — must stay at 111 checks; confirms the `DEFAULT_BRIDGE_URL` /
  `SERVED_BUILD` regexes in `serveApp` still match.
- Manual (file:// build), Drive **misconfigured** (clear the Client ID in Settings): scan a sheet
  and confirm the score still saves, one toast says images are not being saved, the tally row
  carries `⚠ no image`, and Settings shows the cause. Scan a second sheet: tally marks it too, and
  there is **no second toast**.
- Manual, Drive **configured**: scan and confirm no toast, no `⚠ no image` chip, and the image
  lands in `My Drive/Quiz Sheets/<class>/<quiz>/`.
- Hand-enter a result through the review modal with Drive off — confirm it is **not** flagged
  (`imageState === 'none'`).
- Override an existing scanned row with no new photo — confirm the original `imageId` still carries
  over and no warning fires.
