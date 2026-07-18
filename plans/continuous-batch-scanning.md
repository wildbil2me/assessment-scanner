# Continuous batch scanning (phone photo mode)

## Context

Grading a stack of sheets on a phone is slow. On the served / GitHub Pages build the only
usable capture is **Photo upload** (index.html:3674) — and it has *no* auto-save. Every sheet
costs: tap file input → take/confirm photo → scroll down → tap **Score & save** → scroll back
up → tap the file input again. The live-camera path already has a hands-free loop (`scanLoop` →
`onSheetCaptured` with `chkAutoSave`, index.html:3399), but that path is removed on the served
build (`SERVED_BUILD`, index.html:3710) — Google's iframe refuses camera permission, and that is
not fixable.

Goal: on the phone, **scan a sheet → hear/see a confirmation → immediately scan the next**, with
no Score tap and no scrolling. Problem sheets are flagged, not held; end-of-batch review happens
in the existing **Scores tab** (+ Drive image review/override).

Decisions (confirmed with the user):
- Primary target: **phone photo upload**.
- Confident scan: **auto-save, just confirm** — no per-sheet Score tap.
- Low-confidence scan: **save it, flag it, keep going** (distinct beep + counter; Drive photo
  kept for later review). This intentionally reverses the current "hold low-confidence for a
  glance" behavior in `onSheetCaptured`.
- End-of-batch: **flag only, use the Scores tab** — no new in-session list UI.

## Constraint that shapes the design

A browser will only open a file picker from a **user gesture**. After an async `scoreAndSave()`
completes, that gesture is gone, so we **cannot** auto-reopen the OS camera. The realistic floor
in photo mode is therefore **one tap per sheet** (the tap that reopens the camera), plus the
inherent OS take/confirm. The work is to make that single tap prominent and scroll-free, and to
strip out the Score tap + scrolling that exist today.

## Changes — all in index.html

### 1. Photo handler becomes auto-save-aware
Rework the `#photoFile` `change` handler (index.html:3674) to mirror `onSheetCaptured`
(index.html:3399), reusing `beep()`, `applyScanResult()`, `setPendingImage()`,
`isLowConfidence()`, and `scoreAndSave()`:
- `!res.ok` → keep current behavior: `renderScanDebug`, toast to retake, **not saved**; bump
  `scanSession.skipped`.
- `res.ok` **and** `chkAutoSave` on → `applyScanResult`, `setPendingImage`, `beep()`,
  `await scoreAndSave()`; `scanSession.saved++`; if `isLowConfidence(res)` also
  `scanSession.flagged++` with a distinct beep/toast. Set `#scanStatus` to a compact confirmation
  carrying the running count (e.g. `Saved ✓ — 3 this session (1 flagged). Tap "Scan next
  sheet".`). Render `#photoDebug` only on the flagged/failed paths, not the clean one.
- `res.ok` and auto-save **off** → current review behavior (fill grid, prompt Score & save).

Note: `scoreAndSave()` already clears the form, mints an idempotent `writeId`, attaches the Drive
image, and falls back to the offline queue — no change needed there. Low-confidence rows land in
the sheet like any other and stay reviewable via the Scores tab's existing Drive review/override
(`openReview`, index.html:2518).

### 2. Auto-save on by default + persisted
`#chkAutoSave` currently defaults off and lives only in the camera toolbar (but already renders in
photo mode, since the mode switch doesn't hide that toolbar). Persist its state in `store`
(localStorage, same pattern as other `store.*` keys around index.html:1028) and default it
**checked**, so the batch flow is the default. Add a `change` listener to save it. Relabel to
"auto-save each scan (confident + flagged)".

### 3. Prominent, scroll-free "Scan next sheet" control
In `#photoPanel` (index.html:660), restyle the file input as a large button-styled
`<label for="photoFile">` at the **top** of the panel so no scrolling is needed between sheets;
keep the raw `<input type="file" accept="image/*">` present but visually hidden. Toggle its text
`📷 Scan sheet` → `📷 Scan next sheet (N)` after the first save. This single tap is the
camera-reopen gesture (see Constraint above).

### 4. Session progress (counts only, no list)
Add an in-memory `scanSession = { saved, flagged, skipped }`, surfaced in `#scanStatus` (and
optionally a small count badge by the scan button). Reset it when the quiz changes
(`rebuildGradeGrid`) or when switching into photo mode. No list UI — per the user's choice, the
**Scores tab** is the end-of-batch review surface.

## Out of scope
- Live-camera changes (already has the loop; not the phone path).
- Any new server/`Code.gs` action — submission is unchanged.
- An in-session scanned-sheet list or a new low-confidence column in the sheet.

## Verification
- `node test/test-omr.mjs` — must still pass; it evaluates the whole `<script>` under a stub DOM,
  so it doubles as a syntax check on the edits. (`readSheet` is untouched.)
- Manual (file:// build, Photo mode): feed several generated/sample sheets and confirm —
  1. A clean read **auto-saves** with a beep and a "Saved ✓ — N this session … Tap Scan next
     sheet" status, **no Score tap, no scrolling**.
  2. A faint/ambiguous read auto-saves with a **distinct** beep/toast and bumps the flagged count.
  3. An unreadable image toasts "retake" and is **not** saved (skipped count bumps).
  4. Toggling "auto-save" off restores the review → Score & save behavior.
  5. Flagged rows appear in the **Scores tab** and open their photo via the existing review button.
- Served build: `SERVED_BUILD` already opens on Photo; confirm the new button + auto-save behave
  there (test 8d in `test-bridge.mjs` still passes — the `DEFAULT_BRIDGE_URL` rewrite is untouched).
