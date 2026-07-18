# Suite Design Framework

This folder is the **design framework for sibling apps** — new teacher-facing tools that
should look, feel, and behave like Roll Call! (a gradebook, seating chart, behavior log,
parent-contact tracker, hall-pass kiosk, etc.). It exists so a new project starts with a
working visual identity, a proven architecture, and pluggable components instead of a blank
page.

Everything in here was extracted from the shipped app (`src/dashboard.html` +
`src/bridge.gs`), not invented. When the app and these docs disagree, the app wins —
update the doc.

## The documents

| File | What it gives a new project |
|---|---|
| [style-guide.md](style-guide.md) | The visual language: palette, typography, spacing, radii, shadows, component styling rules, responsive/touch rules, accessibility, print. |
| [execution-guide.md](execution-guide.md) | The engineering rules: single-file app, zero dependencies, Apps Script bridge, JSONP reads / outbox writes, localStorage conventions, demo build, repo layout, git conventions. |
| [portable-components.md](portable-components.md) | The pluggable modules — header bar, full-screen setup flow, panel/page frame, modal system, save indicator, config modal, skeletons, helper functions — each with the exact CSS/HTML/JS to lift. |
| [starter-template.html](starter-template.html) | A runnable skeleton wired from those modules. Open it in a browser, rename things, and start building the app-specific middle. |

## What makes an app a member of the suite

1. **One HTML file is the whole frontend.** Opened from `file://` or served by its
   Apps Script bridge. No build step for the app itself, no dependencies, no framework.
2. **Google Sheets is the database; an Apps Script Web App is the backend.** All reads are
   JSONP; all writes go through a persistent localStorage outbox with `writeId` dedupe.
3. **The shared visual identity:** dark navy gradient header, white rounded panels on a
   cool gray page, the shared accent palette (green = confirm/positive, indigo = interactive,
   orange = warning, red = danger), 44px touch targets on coarse pointers.
4. **The shared UX skeleton:** full-screen dark setup flow (connect → wizard), two-row
   header, panel with title/search/pills, modal overlays, save indicator, offline banner.
5. **Teacher-owned data.** Each teacher deploys their own bridge; nothing central. Respect
   the FERPA stance in [../docs/FERPA.md](../docs/FERPA.md).

An app may skip a module it genuinely doesn't need (e.g. no batch bar), but should not
restyle a module it keeps. Divergence is a suite-wide decision, made here first.

## Roadmap for standing up a new sibling app

Work in phases; each phase ends in something you can open in a browser.

**Phase 0 — Define the sheet.** Decide the spreadsheet layout (tabs, header rows, column
map) the way `CLAUDE.md` documents Roll Call!'s. Write it down *before* coding; the sheet
layout is the real schema. Give the sheet a hidden `_<AppName>` meta tab with
`schemaVersion` from day one — linking existing sheets later depends on it.

**Phase 1 — Skeleton.** Copy `starter-template.html`, rename the app (title, favicon
emoji, header logo/title, localStorage prefix). You now have the header, page frame,
modal system, and setup screens working with no backend.

**Phase 2 — Bridge.** Copy `src/bridge.gs` and strip it to `doGet` routing +
`respondOk`/`respondErr` + the JSONP/dedupe plumbing, then add your app's read and write
actions. Follow the deployment rules in [execution-guide.md](execution-guide.md) exactly
(Execute as user accessing; GET only; keep the `createHtmlOutputFromFile('dashboard.html')`
name flat).

**Phase 3 — App middle.** Build the app-specific views inside the panel frame using the
style guide. Wire reads through `jsonpFetch` and writes through `bridgePost` — never a
bare fetch, never bypassing the outbox for a mutation.

**Phase 4 — Offline + polish.** Snapshot cache, stale banner, save-indicator states,
keyboard focus pass, `@media (pointer: coarse)` pass on every new control, print
stylesheet if the app prints.

**Phase 5 — Demo build (optional but recommended).** Clone `tools/build-demo.mjs` and the
fake-bridge pattern from `demo/demo-engine.js`: the engine's presence is the switch
(`var DEMO = typeof demoBridge === 'function'`), the build inlines it at an inject marker
and blanks the default bridge URL.

**Definition of done for the framework:** a new repo that has completed Phases 0–2 should
contain nothing hand-designed — every visible element either came from
`portable-components.md` or follows a rule in `style-guide.md`.
