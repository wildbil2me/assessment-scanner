# Portable Components

The modules a sibling app lifts directly from `src/dashboard.html`. Each entry says what
it is, where the canonical code lives (line numbers as of 2026-07-18 — re-grep the section
banner comments like `/* ── HEADER ── */` if they drift), what to copy, and what to rename.
`starter-template.html` in this folder already wires the frame-level ones together.

Rename rule for all modules: the app name, the favicon emoji, the localStorage prefix, and
the header subtitle are the only things that change. The CSS classes keep their names —
shared names are what make fixes portable across the suite.

---

## 1. Base layer (copy verbatim, always)

Source: top of the stylesheet (~lines 11–28) plus utilities (~562).

- Global reset: `* { box-sizing: border-box; margin: 0; padding: 0; }`
- `body` defaults: Segoe UI stack, `#f0f2f5` bg, `#1a1a2e` text, 14px,
  `overscroll-behavior-y: contain`, safe-area bottom padding.
- The grouped `touch-action: manipulation; user-select: none` selector — extend its class
  list with every new tappable class you create.
- Focus ring: `:focus-visible { outline: 2px solid #5b6fcc; outline-offset: 2px; }`
- Utilities: `.hidden { display: none !important; }` (the show/hide mechanism everywhere)
  and `.sr-only` for visually hidden accessible text.
- Emoji favicon pattern:
  `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>">`
- Viewport / iOS meta trio (`viewport` with `maximum-scale=1.0`,
  `apple-mobile-web-app-capable`, status-bar-style).

## 2. Header bar

Source: CSS `/* ── HEADER ── */` (~136–201), HTML ~1115–1162.

Two-row structure, ported as-is:

```html
<header class="header">
  <div class="header-top">
    <div class="header-left">
      <div class="header-logo">📋</div>            <!-- app emoji -->
      <div class="header-title">
        <h1>App Name</h1>
        <p id="headerSubtitle">One-line descriptor</p>
      </div>
    </div>
    <div class="header-actions"><!-- .hdr-icon-btn × N --></div>
  </div>
  <div class="header-bottom">
    <div class="hdr-class-tabs" id="classTabBar"><!-- .cls-tab × N --></div>
    <div class="hdr-right-controls">
      <div class="hdr-divider"></div>
      <nav id="quarterNav"><!-- .q-btn context tabs --></nav>
      <button class="compact-btn"><!-- view toggle, optional --></button>
    </div>
  </div>
</header>
```

- Top row = identity + icon actions (`.hdr-icon-btn`: 32×32, white-alpha bg, inline
  Feather SVG 16×16). Bottom row = navigation: primary tabs left (`.cls-tab`,
  horizontally scrollable), secondary context tabs right (`.q-btn`), separated by
  `.hdr-divider`.
- Keep the touch overrides for all header classes in `@media (pointer: coarse)` and the
  640px paddings — they ship with the module.
- An app with no tab concept keeps `.header-top` and drops `.header-bottom` whole; don't
  thin it out piecemeal.

## 3. Full-screen setup flow

Source: `/* ── LOADING ── */`, `/* ── CONNECT SCREEN ── */`, `/* ── FIRST-RUN WIZARD ── */`,
`/* ── LOGIN CLASS PICKER ── */` (~30–134).

Four fixed-position full-screen dark (`#0d2137`) screens sharing one visual grammar
(white 20px/700 `h2`, `.connect-sub` secondary text, white-alpha inputs that focus to
`#27ae60`, `.connect-btn` green CTA, `.wiz-skip` underlined skip link, `.wiz-hint`,
status line with `min-height` so it never reflows):

1. `#loadingScreen` — spinner (z-index 999)
2. `#connectScreen` — paste-your-bridge-URL first-run gate (z-index 1001)
3. `#wizardScreen` — multi-step `.wiz-step` create-first-thing wizard
4. `#classPickerScreen` — `.picker-class-btn` chooser on subsequent launches

Port all four; sequencing logic (which screen shows when) is app-specific. Toggle with
`.hidden`.

## 4. Page frame: `.main` + `.panel`

Source: `/* ── MAIN ── */`, `/* ── PANEL ── */`, `/* ── DATE / BATCH BAR ── */` (~376–447).

- `.main { padding: 20px; max-width: 1300px; margin: 0 auto; }`
- `.panel` (white, radius 14, shadow) → `.panel-header` → `.panel-title-row` →
  `.panel-title` (h2 15px/700 + 11px muted subtitle).
- `.search-row`: `.search-box` (360px, 🔍 + input + `.search-clear` ✕) left, `.pill`
  filter chips absolutely centered, right-aligned controls with `margin-left: auto`.
  The ≤1024px block un-centers the pills — take it too.
- Optional inset toolbar under the header: `.date-batch-bar` (gray strip, hairline top and
  bottom) holding `.batch-btn` wash-colored action chips and the save indicator.
- `.empty-state` for zero-data panels; `.tbl-wrap { overflow-x: auto; }` + the
  `thead th` uppercase-label table styling for tabular views.

## 5. Modal system

Source: `/* ── MODAL ── */` (~578–644), `/* ── CONFIG MODAL ── */` (~665–712),
`/* ── STUDENT REPORT MODAL ── */` (~751+), `/* ── REPORT MODAL ── */` (~954+).

Three tiers, all closed by toggling `.hidden` on the overlay:

- **Standard**: `.modal-overlay` (z-index 1000, scrim 0.5) + `.modal-panel` (480px,
  radius 14) with gradient `.modal-header` + white `.modal-close` ✕ + `.modal-body`.
  Inside: `.modal-section-label`, `.class-list`/`.class-row` rows with
  `.class-action-btn` outline buttons (accent-on-hover per action:
  `.archive`/`.delete`/`.restore`/`.primary`), `.paste-form` inline create forms,
  `.rename-input`.
- **Settings**: `.config-modal-panel` (660px, padded, no gradient header) with
  `.config-columns` two-column grid, `.config-row` label/control rows,
  `.config-num`/`.config-select`/`.config-date` inputs, `.config-hint`,
  `.config-actions` right-aligned footer, and the `.toggle-switch` /
  `.toggle-track` / `.toggle-thumb` switch.
- **Hero** (rich detail view): `.sr-overlay` at **z-index 1100** (it may stack over a
  standard modal) + `.sr-panel` (640px, radius 16, `max-height: 88vh`, flex column,
  `srIn` entrance animation) with gradient header. Also `.report-modal-panel` (700px,
  scrollable body + `.report-modal-footer`) and `.report-type-tab` segmented tabs.

Keep the z-index ladder exactly: content banners 90 · loading 999 · modals 1000 ·
setup screens 1001 · hero modal 1100.

## 6. Feedback & status modules

- **Save indicator** (~448–458 CSS; `showSaveState` ~3328): a chip cycling
  `saving / saved / error / syncing / queued / retry` wash colors;
  `updateSaveIndicatorFromOutbox()` derives the state from outbox length +
  `navigator.onLine` + retry count. Port the pair with the outbox.
- **Stale banner** (`#staleBanner`, ~460–471): amber offline strip with "Retry now"
  outline button.
- **Sticky alert banner** (`#activePassBanner` pattern, ~312–374): sticky top strip that
  animates open via a `.has-passes`-style class (max-height + padding transition),
  holding dark `.pass-card`s with name / type chip / big `tabular-nums` timer / green
  resolve button. Reuse for any "N things need attention now" surface.
- **Skeletons** (~646–661): `.skel` shimmer base + `.skel-avatar/.skel-text/.skel-circle/
  .skel-stat` variants for load-in placeholders.
- **Inline notice banner** (`#noSchoolBanner` pattern): wash-colored bordered strip inside
  the panel with inline outline action buttons.

## 7. Small shared pieces

- `.avatar` (32px circle, initials, `.av0`–`.av9` by `id % 10`) and `.pass-btn`-style
  wash chip buttons.
- `.risk-badge.warn/.crit` micro-badges; `.avg-pct.g/.w/.d` stat coloring.
- `.sort-btn` tiny sort toggles; `.pill` filter chips; `.as-tab`/`.report-type-tab`
  segmented tab rows.
- `.row-selected` row highlight (indigo wash + 3px left border) for keyboard navigation.
- Print scaffold: `#printHeader` + `@media print` chrome-hiding +
  `body[data-modal-print]` single-modal print mode.

## 8. JS plumbing (copy the functions, keep the names)

| Function(s) | Source ~lines | Notes |
|---|---|---|
| `jsonpFetch(url, onSuccess, onError)` | 4718–4752 | JSONP reads; 15s timeout; self-cleaning late-response stub. Keep the `if (DEMO)` seam. |
| `bridgePost(payload, onDone)` + `loadOutbox`/`saveOutbox` + `drainOutbox` | 2599–2727 | The write path: persistent queue, one-in-flight, ack-then-remove, exponential backoff (2s→60s), bridge-rejection drop, `writeId` generation. `coalesceOutbox` is Roll Call!-specific — port the hook, replace the coverage logic per app (or make it a no-op). |
| `updateSaveIndicatorFromOutbox()` / `showSaveState(state, n)` | 2729 / 3328 | Save chip driver. |
| `loadConfig()` / `saveConfig()` + `CONFIG_DEFAULTS` | 1520–1552 | Defaults-merge pattern: unknown stored keys ignored, missing keys defaulted. Rename the storage key. |
| Snapshot cache (`saveClassSnapshot` etc.) | ~1554+ | Offline snapshots, 72h max age; pairs with the stale banner. |
| `_escHtml(s)` | 1754 | **Every** interpolated string in rendered HTML goes through this. |
| `formatTime` / `formatDateShort` / `formatIsoShort` / `pad` | 4754–4774 | `formatIsoShort` parses `yyyy-mm-dd` field-by-field on purpose — `new Date(iso)` is UTC and lands a day early west of Greenwich. Time format `h:mm:ss a` must match the bridge. |
| `announce()` aria-live helper | grep `function announce` | Screen-reader announcements. |

Bridge-side (from `src/bridge.gs`): `doGet` action router, `respondOk`/`respondErr`
JSONP wrappers with `CacheService` writeId dedupe, and the meta-tab
create/inspect pattern (`generateClassSpreadsheet` / `inspectSheetTerms` analogues).

## 9. What is NOT portable

Attendance semantics (`.att` dots, P/T/A/E/D codes, `getThresholdState`,
`CONSEC_ABSENCE_LIMIT`), the compact grid cards (`.lc-*`), hall-pass logic, term/quarter
handling, and the Raw Input roster parsing. Those are Roll Call!'s app-middle. Use their
*styling grammar* (wash + strong color, chip shapes) for your own domain, but don't carry
the code.
