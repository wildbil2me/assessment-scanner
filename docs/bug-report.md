# Reporting a Scantron bug

Scantron is one HTML file talking to a Google Apps Script "bridge" over JSONP. That
architecture produces failure modes that don't look like ordinary web bugs — a stale
deployment, a half-granted OAuth scope, or a signed-out browser all present as *"nothing
happened."* So the fix usually hinges on details that are easy to leave out of a report.

Work through **Before you file**; it resolves most reports in a couple of minutes. If the
problem survives that, copy [the template](#the-template) into your report and fill it in.

---

## Before you file (~2 minutes)

1. **Is the connection dot green?** It sits next to "Bubble Sheet Grader" in the header.
   Grey means the last bridge call failed — start with [README → Troubleshooting](../README.md#troubleshooting),
   which covers the usual causes in order.
2. **Open your `/exec` URL in a browser tab.** You should see a JSON blob saying the bridge
   is reachable. A **login page** means you're signed out — that alone breaks everything,
   because the bridge runs as *you*. An **error page** means the deployment itself is broken.
3. **Did you edit `Code.gs` and not redeploy?** Editing the code does *not* update the
   running web app. Push it: **Deploy → Manage deployments → ✏️ Edit → Version: New
   version → Deploy**. A symptom of exactly this is `Unknown action: …`.
4. **Does it happen in a different class, or only one?** A class-specific fault points at
   that class's Sheet; an everywhere-fault points at the bridge or the page.
5. **Reload the page.** If a reload fixes it, say so in the report — that's a real clue,
   not a non-event. It usually means stale in-memory state rather than bad data.

---

## Never include

This is a classroom tool, so a bug report can leak things it shouldn't:

- **No student data.** No real names, no student IDs, no rosters, no score screenshots.
  Crop them out, or retype a couple of rows with fake names that show the same shape.
  A bug in the Scores grid reproduces just as well with `Test, Alice / 001`.
- **No `/exec` URL.** It's tied to your Google account. Say *"the URL ends in `/exec`"* —
  that's the only part anyone needs to know.
- **No OAuth tokens.** If a console line contains a long random string, don't paste it.

A **filled bubble sheet photo is fine** as long as the ID grid and name are blank or fake —
and for scanning bugs it's the single most useful attachment.

---

## The template

```markdown
### What happened
<One sentence. The observable thing, not the theory.>

### What I expected instead
<One sentence.>

### Steps to reproduce
1.
2.
3.

Happens: [ ] every time  [ ] sometimes  [ ] once, can't reproduce

### Where
- Area:  [ ] Connect/Settings [ ] Scores grid [ ] Quizzes [ ] New Quiz
         [ ] Grading (camera / photo / manual) [ ] Roster import [ ] Printing [ ] Classes
- Browser + OS:            <e.g. Chrome 131 on Windows 11>
- Opened the app from:     [ ] file:// (double-clicked index.html)  [ ] a web server
- Connection dot:          [ ] green  [ ] grey
- Redeployed the bridge after the last Code.gs change? [ ] yes [ ] no [ ] never edited it
- Happens in other classes? [ ] yes [ ] only one class [ ] haven't tried

### Console output
<See "Getting the console output" below. Paste red errors — or "none".>

### Anything on screen
<Exact text of any toast, banner, or ✕ message. Copy the wording; it's specific.>

### Notes
<Screenshot with student data removed, or anything else relevant.>
```

---

## What to include, by area

Extra detail that actually helps, depending on what broke.

### Connecting / the bridge

The most valuable fact is **what the `/exec` URL shows in a browser tab** (JSON / login page /
error page). Also: did this ever work, or is it a fresh setup? If a call fails with
`…do not have permission to call DriveApp…`, that's the stale-grant case — the README covers
it, and it only affects the optional Drive folder field.

### The Scores grid

- Does the grid say the **bridge is out of date**? Then it's the redeploy above.
- Is a score **wrong**, or **missing**? Missing usually means the scan's student ID doesn't
  match the roster — check the amber "didn't match anyone" banner above the grid.
- A grey `–` means *no scan on file for that quiz*. That's not the same as a `0%`, and it is
  not a bug on its own.
- If a score is wrong, **open the quiz's tab in the Sheet** and say what row 2 (the key) and
  the student's row actually contain. The grid only ever reflects the tab.

### Grading / scanning

Say **which of the three paths** you used — camera, photo upload, or manual entry — because
they share almost no code. For camera and photo:

- Attach the photo (with the ID grid blank or fake).
- Which printed form (20 / 50 / 100 questions), and did it come from **Print Sheets** or from
  somewhere else? Third-party sheets aren't supported — the corner markers must match.
- Lighting, angle, shadow across the page, phone vs laptop camera.
- Did it misread *some* bubbles or fail to find the sheet entirely? Different bug.

### Roster import

Paste the **input lines that misbehaved, with fake names but the real shape** — the column
count, stray commas, and quoting are exactly what matters. Expected format is `ID, Last, First`.
Note whether the review step showed a warning and what it said.

### Printing

Browser, and the print dialog's **scale** and **margins** settings. "Fit to page" or any
scaling other than 100% moves the corner markers and will break scanning — that's the usual
cause.

---

## Getting the console output

The console is where a silent failure stops being silent, so this is worth the 20 seconds.

1. **Chrome / Edge:** `F12` (or `Ctrl+Shift+J`; on a Mac `Cmd+Option+J`) → **Console** tab.
   **Safari:** enable *Develop* in Settings → Advanced, then `Cmd+Option+C`.
2. Reload the page and redo the thing that broke, so the console captures it fresh.
3. Copy the **red** lines. Yellow warnings are rarely the cause.
4. If it's a bridge problem, also check the **Network** tab for the `/exec` request and note
   its status.

> A JSONP failure often logs **nothing at all** — the `<script>` tag just quietly does
> nothing. "No console output" is therefore a real, useful answer. Say it explicitly rather
> than leaving the field blank, so nobody has to wonder whether you looked.

---

## If you can, check it against the tests

If you're comfortable at a terminal, this narrows a bug to one side of the wire fast:

```
node test/test-bridge.mjs   # Apps Script bridge logic (fast)
node test/test-import.mjs   # roster import parser (fast)
node test/test-omr.mjs      # the scanner pipeline (~5 min)
```

A failing test is a much sharper report than a screenshot — paste the failing lines. All three
passing tells you the bug is in the page or in your specific Sheet/deployment, not in the
core logic.
