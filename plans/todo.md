# Todo

Running list of work items for the scantron app. Anything that graduates to
"do this next" moves to [priority-tasks.md](priority-tasks.md), and anything
finished moves to [completed/](completed/).

---

## Check header CSS and HTML

There's an orange bar visible in `reference/dashboard.html` that doesn't show up
in `index.html`. The two files have near-identical `.header` / `.header-top` /
`.header-bottom` rules, so the difference is probably an extra element in the
dashboard markup (a banner or accent strip) rather than a divergence in the
shared header block itself.

Compare the header CSS *and* the header markup between the two files, decide
whether the orange bar is intentional, and either port it to `index.html` or
drop it from the dashboard so the two headers match.

Status: known, Will is fixing this soon.

---

## Dual-use index.html

`index.html` should work the same two ways `dashboard.html` does: served as an
HTML file from the Apps Script project **and** opened directly from the local
filesystem for development.

That means:

- Add `index.html` to the Apps Script setup as an HTML file.
- Keep it running locally without an Apps Script host — no hard dependency on
  `google.script.run` at load time.
- Detect which mode it's in and route data access accordingly (Apps Script
  bridge when hosted, direct HTTP/fetch to the deployed endpoint when local).
- Make sure the local path still works when there's no live backend, so the UI
  can be worked on offline.

Look at how `dashboard.html` already solves this and follow the same pattern
rather than inventing a second one.

---

## Save scan images for reference

When a scan produces a wrong or questionable result, there's currently nothing
to look back at. Save an image of each scan so a bad grade can be traced to the
actual sheet that produced it.

Open questions to work through before building:

- Where do the images live — Drive folder, or inline in the Sheet?
- Original capture, the deskewed/normalized frame, or an annotated overlay
  showing what the OMR thought each bubble was?
- What links an image back to its result row (scan ID? student + quiz + timestamp?).
- Retention: keep everything, or only scans flagged as low-confidence?
- Storage cost and quota implications at classroom scale.

An annotated overlay is likely the most useful for debugging, since it shows the
detection decision and not just the paper.
