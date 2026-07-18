# Design alignment with Roll Call!

Bring `index.html`'s page design in line with `reference/dashboard.html` so the two read as sibling
apps — or as two functions of one app — rather than as a fork that drifted.

**Scope: `index.html` only.** `reference/dashboard.html` is Roll Call's file and stays untouched.
Where Scantron's rule is better, Scantron keeps it and the improvement gets written up for Roll Call
to adopt later (see [Deliverable 2](#deliverable-2--referenceroll-call-recommendationsmd)).

---

## Why this is smaller than it sounds

Scantron was built from the dashboard pattern and still says so in its own CSS — `/* same as Roll
Call! */` at [index.html](../index.html) lines 121, 209, 312, and 457. Large regions are already
byte-identical: the connect screen, `.header` / `.header-top` / `.header-bottom`, the `.hdr-*` family,
`.cls-tab`, `.modal-overlay` / `.modal-header`, the whole `.class-*` row family, `.rename-input`,
`.paste-form`, the `.av0`–`.av9` avatar palette, `.sr-only`, and the `:focus-visible` ring.

So this is not a redesign. It's closing a set of small, enumerable drifts, plus two places where the
same class name means two different things in the two apps.

The acceptance test: diff the two `<style>` blocks side by side. Every rule in the shared region
should be identical, and every remaining divergence should be one Deliverable 2 explains.

## Two ground rules

**No `:root` custom properties.** Neither file has them; every color is hardcoded hex. Tokenizing
Scantron alone would make the two stylesheets textually *diverge* — a shared rule could no longer be
copied or diffed straight across, which is the whole point of the exercise. Revisit only if both files
get tokenized in the same pass.

**Don't collide with the header todo.** [todo.md](todo.md)'s "Check header CSS and HTML" item — the
orange bar present in the dashboard but not here (almost certainly `#staleBanner`, the amber `#fff8e6`
strip between header and main) — is marked *known, Will is fixing this soon*. This plan deliberately
does not touch the banner region between `.header` and `.main`. If that work lands first, nothing here
conflicts with it.

---

## Deliverable 1 — `index.html`

### A. Top-level skeleton

Adopt the dashboard's landmarks.

| Now | Change to | Why |
|---|---|---|
| `<div class="header">` | `<header class="header">` | dashboard uses the real landmark |
| `<main>` + bare `main {}` selector | `<main class="main">` + `.main {}` rule | dashboard styles a class, not the element |
| `#srLive` last child of `<body>` | first child of `<body>` | dashboard's order |

Replace `main { padding: 20px; max-width: 1000px; margin: 0 auto; }` (line 133) with the dashboard's
rule verbatim:

```css
.main { padding: 20px; max-width: 1300px; margin: 0 auto; }
```

**This is the most visible change in the plan** — every view gets 300px wider. It's right for the
scores grid, which is a wide student×quiz matrix that currently scrolls sooner than it needs to. The
form-shaped views (New Quiz, Grade, Settings) will read a little sparser; `.row > * { min-width: 130px }`
already stops their fields stretching pathologically. **Worth eyeballing before committing to it.**

### B. Drifted rules — adopt the dashboard's value

One-liners in the `<style>` block:

- `.cls-tab` — padding `5px 14px` → `4px 14px`
- `.q-btn` — add the `:disabled` state; `:hover` → `:hover:not(:disabled)`
- `.save-indicator` — add the missing `.retry` variant (`background:#fef5ea; color:#e67e22; opacity:1`)
- `.panel-title-row` — add `margin-bottom: 12px`
- `.avatar` — `font-weight: 700` → `800`
- `.empty-state`, `.paste-form-actions` — match the dashboard's property order / drop the stray
  `margin-top: 12px`

Keep Scantron's `white-space: nowrap` additions on `.cls-tab` / `.q-btn` / `.save-indicator` — additive,
and they stop long class names wrapping inside a tab. Log them.

### C. The two name collisions

Same class name, different component in each app. Both adopt the dashboard's look.

**`.sort-btn`** — Scantron's is an 11px chip (`padding:5px 10px; border-radius:6px; border:1.5px;
background:#fff`); the dashboard's is a 9px micro-button (`padding:2px 6px; border-radius:4px;
border:1px; background:#f0f2f5`). Adopt the dashboard's rule verbatim **except** keep Scantron's
`font-family: inherit` — the dashboard's omission is a bug, not a choice (logged). Keep `flex-shrink: 0`
on `.sort-btns`, which Scantron needs because its instance sits in a flex row; the dashboard's
`margin-top: 5px` doesn't apply here.

Affects the sort controls at index.html:544-547 (gradebook) and 813-815 (roster modal). **They get
visibly smaller** — the other change worth eyeballing.

**`.gb-cols-btn`** (index.html:281-286) exists only because it duplicated the *old* `.sort-btn`. With
`.sort-btn` now 9px it no longer belongs to that family — point its single usage (`#gbShowAll`) at the
existing `.action-btn` and **delete the rule**. Dedup, no new names.

**`.pill`** — adopt the dashboard's rule verbatim: padding 4px→5px, weight 700→600, gains
`cursor: pointer`, and picks up the `.active` / `.tardy.active` / `.absent.active` semantic variants
unused but present so the vocabulary matches.

`cursor: pointer` is *correct* here, incidentally: Scantron's `.pill` badges render inside `.quiz-item`
(index.html:2320), which is already a clickable row carrying `cursor: pointer`. No wart.

### D. Table base

The biggest shared-rule win. Copy the dashboard's bare-element table rules in verbatim:

```css
.tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; }
thead th {
  padding: 9px 10px; text-align: left; font-size: 10px; font-weight: 700;
  color: #8a9bb0; letter-spacing: 0.5px; text-transform: uppercase;
  border-bottom: 1px solid #eef0f4; white-space: nowrap;
}
tbody tr { border-bottom: 1px solid #f3f4f6; transition: background 0.1s; }
tbody tr:hover { background: #fafbfc; }
tbody td { padding: 9px 10px; vertical-align: middle; }
```

Then:

- **Delete `table.results`** (index.html:441-446) — it now inherits. Its two JS call sites (2359, 2372)
  keep `class="results"` as a hook but need no rules; swap their inline `<div style="overflow-x:auto">`
  wrappers for `class="tbl-wrap"`.
- **Delete `.gb-table`'s redundant `thead th` / `tbody td`** (290-294, 305) — now inherited.
- **Keep, layered on top:** `th.gb-quiz-th`, `.gb-q-name`, `.gb-q-date`, the sticky-column rules,
  `.gb-cell`, `.gb-avg-td`, `.gb-taken`.

⚠️ The sticky name column (300-304) depends on `background: #fff` being opaque, and on
`tbody tr:hover td.gb-name-td` staying in sync with the new global `tbody tr:hover`. Both must survive
verbatim or scrolled content bleeds through the sticky cell.

Rename to the dashboard's vocabulary — both are set via `className =` in JS, so the edits are contained:

- `.gb-student` → `.student-cell` (rule at 306, set at 1367)
- `.gb-name-link` → `.s-name` (rule at 316-317, set at 1373). The dashboard's `.s-name` has no `:hover`
  underline; keep Scantron's and log it.

### E. Search box

`.gb-search` and the dashboard's `.search-box` are the same component built two ways. Adopt the
dashboard's: a bordered flex wrapper holding a borderless input with `.search-clear` as a flex sibling,
replacing Scantron's relative wrapper + absolutely positioned clear button.

- Adopt `.search-box`, `.search-box input`, `.search-clear`; delete `.gb-search`, `.gb-search input`,
  `.gb-search-clear`.
- Restructure the two markup sites: index.html:540-542 (gradebook) and 809-811 (roster modal). **Keep
  the ids** `gbSearchClear` / `rosterSearchClear` so the `.hidden` toggles at 1457 and 2006 keep working
  untouched.
- **Do not adopt the dashboard's `.search-row`.** It centers `.pills` with `position:absolute; left:50%;
  transform:translateX(-50%)`, a hack its own 1024px breakpoint then has to undo. Scantron's
  `.gb-controls` flex row is the better container — keep it.
- `.search-box { flex: 0 0 360px }` is a fixed width that would overflow the roster modal, so also adopt
  the dashboard's `≤1024px` override (`flex: 1 1 auto`).

### F. Shared vocabulary Scantron is missing

Add the dashboard's loader verbatim and retire the `⏳` emoji placeholders inside `.empty-state`
(index.html:1298, 2333):

```css
.spinner {
  width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.15);
  border-top-color: #27ae60; border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

Those border colors are tuned for the dashboard's dark `#0d2137` loading screen. On Scantron's white
panels the track needs `rgba(0,0,0,0.08)` — add that as a scoped override rather than editing the
shared rule.

### G. Housekeeping

- Update the `touch-action` selector list (index.html:16-19) for any renamed class. It enumerates every
  button class by hand — miss it and mobile gets the 300ms tap delay back.
- Sort the breakpoints ascending (currently 640 → 700 → 560 → coarse) and fold in the `≤1024px`
  `.search-box` override from §E.

### Out of scope — do not touch

- **`renderSheetSVG()`** (2606-2661). Its inline fills, strokes, and geometry are an optical contract
  with the OMR scanner, driven by the same `buildLayout(formKey)` that drives the printed sheet. These
  are not design tokens. Changing them breaks scanning.
- **`#camWrap` / `#camOverlay` / `#camVideo`.** The overlay canvas is aligned to the video in CSS-pixel
  space; any padding, border, or transform on the wrapper misaligns the fiducial markers. Inline styles
  may become classes, but the geometry survives verbatim.
- **The print path** (2670-2682) writes a self-contained iframe document and inherits nothing from the
  page CSS — a real isolation win, and out of reach anyway.
- **`.pct.mt`'s grey** — semantic ("never taken ≠ a real zero", per the comment at 320-321). Don't
  normalize it into a score band.
- **The banner region between `.header` and `.main`** — see the header todo above.
- The z-index ladder: header `20` < `.modal-overlay` `1000` < `#connectScreen` `1001` < `.toast` `1100`.

---

## Deliverable 2 — `reference/roll-call-recommendations.md`

A new file recording every place Scantron keeps its own version because it's better, so Roll Call can
adopt them later. Not a patch — a reviewed list, each entry naming the rule, the dashboard line, and
the concrete defect it fixes.

1. **`.modal-panel` needs `max-height: 90vh; display:flex; flex-direction:column`** and `.modal-body`
   needs `overflow-y: auto` (dashboard.html:583-598). Without them a tall modal overflows the viewport
   with no way to scroll. The dashboard worked around this by growing three *more* modal shells —
   `.config-modal-panel`, `.report-modal-panel`, `.sr-panel` — two of which re-solve it inconsistently
   and one of which (`.config-modal-panel`) still can't scroll. Adopting Scantron's single
   `.modal-panel` would let all four collapse into one.
2. **`font-family: inherit` is missing** on `.q-btn` (183), `.compact-btn` (195), `.modal-close` (592),
   and `.sort-btn` (549) — they render in the UA's default button font, not Segoe UI. The dashboard
   repeats `font-family: inherit` ~25 times elsewhere, so this is an oversight.
3. **`.header` should be `position: sticky; top: 0; z-index: 20`.** The dashboard's header scrolls away,
   taking the class tabs and quarter nav with it.
4. **One global `.hidden { display:none !important }`** instead of the global rule *plus* per-screen
   `#connectScreen.hidden`, `#wizardScreen.hidden`, `#classPickerScreen.hidden`, `.wiz-step.hidden`
   (50, 74, 76, 121, 562).
5. **`white-space: nowrap` on `.cls-tab` / `.q-btn`** — without it a long class name wraps inside its tab.
6. **`.s-name:hover { color:#5b6fcc; text-decoration:underline }`** — the dashboard's clickable student
   name has no hover affordance.
7. **`@keyframes pulse`** (321) is defined but never referenced. Dead CSS.
8. **`.q-btn` and `.compact-btn` are byte-identical** (183-201), as are `.as-tab` and `.report-type-tab`
   modulo padding. Merge candidates.

---

## Verification

No build, lint, or test runner — each test is a standalone Node script that prints ✓/✗ and exits
non-zero on failure.

```
node test/test-omr.mjs      # ~5 min — the critical one
node test/test-import.mjs   # fast
node test/test-bridge.mjs   # fast; should be untouched (no Code.gs changes)
```

`test-omr.mjs` regex-extracts the single `<script>` block from `index.html` and evaluates it under a
stub DOM, so it doubles as a syntax check on the app *and* proves the scanner still reads synthetic
warped photos. Any rename that misses a JS call site surfaces here. **Don't add a second `<script>`
tag** — the `/<script>([\s\S]*)<\/script>/` match would break for reasons unrelated to this work.

Then open `index.html` in a browser, since most of this is visual and none of it is asserted anywhere:

- All four nav views plus Settings (reachable only via the ⚙ icon) — judge the 1300px measure.
- **Scores grid**: sticky name column still opaque while scrolling sideways; row hover keeps the sticky
  cell in sync; `.pct` bands intact and `.mt` still grey.
- **Search + sort** in both the gradebook and the roster modal — the rebuilt `.search-box`, the clear
  button showing/hiding, all three sort buttons toggling `.active`.
- **Every modal** (print, manage, students, student detail) — open, scroll a long one, close.
- **Grade view**: start the camera and confirm the fiducial overlay still registers against the video.
  That's the one thing a CSS change could silently break.
- **Print a sheet** — should be byte-identical to before, since the iframe is isolated.
- Narrow to ~560px, and emulate `pointer: coarse`, for the reordered breakpoints.

Finally, **diff the two `<style>` blocks side by side.** That's the actual acceptance criterion.
