# Launch blockers

Things that must be resolved before the app goes to teachers other than Will.

This is not the general todo list ([todo.md](todo.md)) and not the current work queue
([priority-tasks.md](priority-tasks.md)). An item earns a place here only if shipping without it
would hurt a user we can't sit next to — silent data loss, an unsupportable bug report, or an
onboarding step a teacher can't reasonably complete.

Status values: **confirmed** (diagnosed, cause known) · **needs check** (suspected, not verified).

---

## 1. localStorage keys renamed with no migration — *confirmed*

The rebrand (`f00d273`) renamed every `store` key from `scantron.*` to `quizsheets.*`
(index.html:1039-1067) without migrating the old values. Anything saved before that commit —
bridge URL, class cache, current class, camera choice, **OAuth Client ID** — became unreadable in
place. It is not deleted, just orphaned under a name nothing reads.

This already bit us once: the wiped `scantron.driveClientId` made Drive image upload fail silently
and looked for a while like a Drive outage.

Worth being precise about who this affects: a brand-new teacher has no `scantron.*` keys, so the
rename costs them nothing. It matters because —

- Will's own installs are all pre-rebrand, and each origin holds its own copy (GitHub Pages build,
  `file://` build, and the bridge-served `/exec` build are three separate localStorage stores).
- Any pilot tester onboarded before the rename hits the same silent loss.
- The fix is roughly ten lines, and skipping it leaves a known silent-failure mode in the codebase
  for no gain.

**Fix:** a one-time migration that runs before `store` is first read — for each known key, if the
`quizsheets.*` name is absent and the `scantron.*` name is present, copy it across (leave the old
one in place; it's harmless and makes the migration safe to re-run). Cover the `quizsheets.quizzes.<classId>`
prefix too, which is per-class and won't be caught by a fixed key list.

**Also:** treat this as a standing rule, not a one-off. Renaming a persisted key without a
migration is a silent data-loss bug — it should not happen a second time.

## 2. Drive upload failures are invisible — *confirmed*

`attachScanImage` swallows every Drive error (index.html:3818), so a misconfigured Client ID, an
expired token, a revoked scope, and a real outage all present as "nothing happened". A teacher can
scan an entire class and lose every image with no signal at all.

**Fix:** planned in [surface-drive-upload-errors.md](surface-drive-upload-errors.md).

## 3. Every teacher must supply their own OAuth Client ID — *needs check*

Drive image saving is off until the teacher pastes an OAuth Client ID into Settings
(index.html:3717, 3953). Creating a Google Cloud project, enabling the Drive API, making an OAuth
client, and setting authorized JavaScript origins is not a step a classroom teacher will complete.

Since the app is served from one origin, **one** project-owned Client ID with that origin
authorized should work for everyone — each teacher grants consent individually through the GIS
flow, and `drive.file` keeps the app scoped to files it created. Before relying on that, confirm:

- the unverified-app user cap (Google limits unverified OAuth clients to ~100 users) and what
  verification would require for a `drive.file`-only app;
- whether the `file://` build can still work, since it has no origin to authorize;
- whether a shipped Client ID constant conflicts with the hand-pasted setting (keep the setting as
  an override, same shape as `DEFAULT_BRIDGE_URL`).

## 4. No way to tell which build a user is running — *confirmed*

There is no version stamp anywhere in the UI. Three separate caches sit between a commit and a
phone: the push to GitHub Pages, the Pages rebuild, and the service worker's stale-while-revalidate
(`sw.js:16`, which lands new code on the *second* launch). During this session that combination
twice made a working fix look broken — once because commits were unpushed, once because the worker
was serving the previous shell.

That is survivable when the developer owns the phone. It is not survivable when a teacher reports
"the beep doesn't work" and nobody can tell what code they're actually running.

**Fix:** stamp a short build identifier (commit SHA or ISO date) into the page and show it in
Settings; have the service worker cache name derive from it so a new build reliably supersedes the
old one.

## 5. Student-data handling has no stated policy — *open question, needs Will's call*

Scores live in the teacher's own Sheet and images in the teacher's own Drive, which is a defensible
design — nothing transits a server we run. But before a wider launch there should be an explicit,
written answer to: what is retained, for how long, who else can reach it (the Drive folder's
sharing state), and what a teacher should do at end of term.

Not a code change necessarily — but shipping to other people's students without having decided this
is the kind of gap that is much cheaper to close now than after.

---

## Explicitly not blockers

- The two folders in Drive (`Scantron/` from before the rebrand, `Quiz Sheets/` after). Old images
  stay reachable because review resolves by stored Drive file id, not by path. Cosmetic only.
- Camera on the bridge-served build. It cannot work (see CLAUDE.md, "Serving the app") and the
  build correctly hides the mode instead of offering a dead button.
