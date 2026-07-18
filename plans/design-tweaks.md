# Design Tweaks

Running list of UI/UX design notes. Each entry is a proposed change to discuss/implement.

## Grade tab — ✅ Implemented

The Grade tab is **only about scanning images in**. Manual override/correction belongs on a
different screen.

- **On load, the flow should be:**
  1. Pick a quiz name.
  2. Pick a scan method — **camera scan** or **photo upload**.
- **Remove the superfluous controls.** The second "Start Camera" button and the other extra
  items don't belong here.
- **Running tally below (optional).** A live error/status tally can sit below the scan area:
  - notes on scans that need **manual review**
  - a **confidence %** for each scan
- Manual override goes on a separate screen (not here).

**Done** — Grade is now scan-only: two-step flow (pick quiz → pick method), camera auto-starts
on select, the Start-camera/auto-save/manual-grid controls are gone, and a live per-scan tally
(`#scanTally`) shows confidence % + a review flag per sheet. Every readable scan auto-commits;
low-confidence reads are saved *and* flagged. Override + hand entry moved to a modal
(`#reviewModal`) launched from the Quizzes tab (**📷 Review** / **✎ Enter by hand**).
