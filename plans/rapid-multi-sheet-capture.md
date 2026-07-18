# Rapid multi-sheet capture ("snap → confirm → next", ZipGrade-style)

## Context

Grading a stack of sheets today is one-at-a-time and stop-and-go. The live camera loop
(`scanLoop` / `onSheetCaptured` in [index.html](../index.html)) already auto-detects a sheet and,
with "auto-save each scan" ticked, saves and resumes — but every result lands in a single review
form with no running tally, and a low-confidence read halts the whole run. Photo upload is strictly
one sheet at a time. On a phone reached through the bridge there is **no live camera at all** and
cannot be — Google's sandbox iframe withholds camera permission
([CLAUDE.md](../CLAUDE.md), `SERVED_BUILD` in [index.html](../index.html)).

The teacher wants ZipGrade's rhythm on **both** desktop/doc-cam and phone: the camera stays open,
auto-snaps **only when the read is confirmed good**, tells you it got the sheet, and waits for a
**Next** tap before the next one; a shaky read is never silently snapped. Decisions locked with the
user: capture only confirmed reads (never auto-snap a low-confidence sheet), and get the phone its
own live camera by **hosting `index.html` on a real HTTPS origin** (the only route past the sandbox
constraint; the code already supports live camera on any secure origin).

Outcome: run a whole stack without touching the keyboard — swap sheet, hear the beep, tap Next — and
see a live tray of everything graded this session, with shaky/unmatched sheets flagged for a quick
end-of-batch fix.

## Approach

### 1. Session capture tray (shared by camera + photo)

Add an in-memory session log rendered in the Grade view, under the scan panel.

- State: `session.captures = []`, each entry `{ name, studentId, answers, score:{earned,possible,percent}, status, ts }` where `status ∈ 'saved' | 'queued' | 'review'`.
- UI: a running header ("**12 graded this session**") plus a scrollable list — each row shows name (or ID, or "unmatched"), score, and a status pill (✓ saved / ⏳ queued / ⚠ review). Reuse existing score-color logic from `showScore`.
- Tapping a row reloads that capture into the existing review form (`grStudent`, `grStudentId`, `grAnswers` + `paintGrid`/`syncFastFromGrid`, per `applyScanResult`) so the teacher fixes the ID/answers and re-saves. A re-save appends a new row and the newest timestamp wins per the sheet layout, so no dedupe work is needed.
- `scoreAndSave` gains an optional caller-supplied entry hook: on success push a `saved` entry, on the offline-queue path push `queued`. Keep its existing behavior otherwise.

### 2. Reshape the camera loop into confirm-then-advance

Rework `scanLoop` / `onSheetCaptured` around an explicit arming state on `scanState` (`armed`, `awaitingNext`):

- **Armed + confident read** (stable as today AND `!isLowConfidence(res)`): capture once → `beep()` → freeze the overlay with a green "Got it — <name> · X/Y" banner (look the name up from the roster, see §4) → **save automatically** (confirmed = save; this replaces the meaning of the old `chkAutoSave` toggle) → push to the tray → set `awaitingNext = true` and show a large **"Next sheet ▸"** button. The loop keeps running but will not capture again while `awaitingNext`.
- **Armed + stable but low-confidence/unmatched**: do **not** capture. Keep the camera open and show inline guidance in `#scanStatus` ("hold flatter / lighting" or "ID not on roster"). Offer a small **"Capture anyway"** control that forces the capture and files it with `status:'review'` so the teacher can force through a genuinely faint sheet and fix it in the tray later.
- **Next** (button tap) or the sheet leaving the frame (existing `fiducials < 2` reset in `scanLoop`) clears `awaitingNext` and re-arms. Keep the `lastSavedSig` guard so the just-saved sheet can't be re-captured before it's swapped.
- Retire the `chkAutoSave` checkbox; confirmed reads always save in this flow. (Optional: keep a "Review each before saving" toggle for the cautious, defaulting off.)

### 3. Photo mode feeds the same tray

Add `multiple` to `#photoFile` and loop the existing read → score path over `e.target.files`, pushing each into the tray (confident → save, shaky → `review`). This gives the served-build/phone-without-hosting a batch path for free and shares all the tray UI.

### 4. Roster lookup for names + unmatched flag

Fetch the roster once on entering Grade mode / picking a quiz (reuse `getRoster` and the `_roster` cache) so the capture banner can show the student's **name** for a scanned ID and the tray can flag an ID that matches no one as **unmatched** (mirrors the Scores-tab unmatched surfacing). Cache-only; no new bridge action.

### 5. Host index.html on HTTPS for live phone camera

`SERVED_BUILD` stays `false` on a plain HTTPS host (it's only flipped by the bridge's `serveApp` rewrite), so camera mode and the whole loop above work unchanged on a phone once the page is on a secure origin.

- Publish `index.html` to a static HTTPS host (GitHub Pages is the simplest — no build step needed). Document this in [README.md](../README.md).
- The hosted page is a **separate origin** with its own localStorage, so the teacher pastes the bridge `/exec` URL once on the phone via the existing connect screen (`store.bridgeUrl` already falls back through localStorage → constant, [CLAUDE.md](../CLAUDE.md) "Serving the app"). It stays cross-origin to the bridge, so the existing **JSONP** transport is exactly what's needed — no Code.gs change, no redeploy. (Optionally bake `DEFAULT_BRIDGE_URL` into the hosted copy to skip even the paste; leave it blank in the repo copy so the `file://` build is unaffected.)

### Files touched

- **index.html** — new tray state + render, reworked `scanLoop`/`onSheetCaptured`, `scoreAndSave` entry hook, `multiple` photo loop, roster prefetch, Grade-view markup for the tray + "Next sheet" / "Capture anyway" buttons, remove `chkAutoSave`.
- **README.md** — HTTPS hosting steps for the phone; note the one-time bridge-URL paste.
- **Code.gs** — **no change** (`submit` already scores server-side; cross-origin JSONP already works).
- **plans/** — move this file into `plans/completed/` when done.

## Verification

- **Automated:** `node test/test-omr.mjs` (evaluates the whole `<script>` under a stub DOM — new load-time code must not touch browser APIs the stub lacks; keep new listeners/handlers lazy and guard like existing code) and `node test/test-import.mjs`. `node test/test-bridge.mjs` should still pass untouched since Code.gs is unchanged (incl. test 8d's `serveApp` regex).
- **Desktop / doc-cam (file://):** open `index.html`, pick a quiz, Camera scan. Run a stack of ~5 filled sheets: confirm each confident sheet beeps + shows the name banner + auto-saves + appears in the tray, the loop waits on "Next", a deliberately faint/half-out-of-frame sheet is **not** auto-captured (guidance shows, "Capture anyway" files it as review), and the running count is correct. Tap a tray row and confirm it reloads into the form and re-saves.
- **Photo batch:** select several sheet photos at once and confirm each lands in the tray with the right status.
- **Phone (HTTPS host):** publish, open the HTTPS URL on a phone, paste the bridge URL once, and confirm the same live "camera open → confirm → Next" loop runs with the back camera and scores save to the sheet.
- Cross-check saved rows/scores in the Scores tab (`getGradebook`) against the tray.
