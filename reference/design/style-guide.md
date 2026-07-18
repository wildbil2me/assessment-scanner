# Suite Style Guide

The visual language shared by every app in the suite. Values are quoted from
`src/dashboard.html` — copy them literally. Colors are defined inline (no CSS variables);
that is a deliberate convention, keep it unless the whole suite migrates at once.

## 1. Palette

### Chrome (dark surfaces)
| Role | Value |
|---|---|
| Header / setup-screen background | gradient `linear-gradient(135deg, #0d2137 0%, #1a3c5e 60%, #2a2a6e 100%)`; solid `#0d2137` for full-screen overlays |
| Modal header gradient | `linear-gradient(135deg, #0d2137 0%, #1a3c5e 100%)` |
| Active-alert banner background | `#0d1f2f` |
| On-dark text | `#fff`; secondary `rgba(255,255,255,0.5–0.6)`; hints `rgba(255,255,255,0.45)` |
| On-dark controls | bg `rgba(255,255,255,0.08)`, border `1.5px solid rgba(255,255,255,0.15–0.25)`, hover bg `rgba(255,255,255,0.16–0.18)` |

### Page (light surfaces)
| Role | Value |
|---|---|
| Page background | `#f0f2f5` |
| Panel / card background | `#fff`; subdued card `#f8f9fc` with border `#e0e4f0`; inset bar `#f8f9fb` |
| Primary text | `#1a1a2e` |
| Secondary text | `#6b7a8d`; muted labels `#8a9bb0`; disabled/empty `#a0aab8` |
| Hairlines | `#eef0f4` (panel dividers), `#f3f4f6` (table rows), inputs `#e0e4ea`, stronger `#d0d8e4` |

### Semantic accents — each has a strong tone + a pale wash used as its background
| Meaning | Strong | Wash | Border tint |
|---|---|---|---|
| Positive / present / confirm | `#27ae60` (hover `#219a52`) | `#eafaf1` | `#a3e4bc` |
| Interactive / selection / info | `#5b6fcc` (hover `#4a5fbb`) | `#eef0fb` / `#eef2ff` | `#b0bcf0` |
| Warning / tardy | `#e67e22` | `#fef5ea` | `#f5c98a` |
| Danger / absent | `#e74c3c` (deep `#c0392b`, alt `#dc2626`) | `#fdeaea` | `#f0b0b0` |
| Special state (e.g. dismissed) | `#7c3aed` (hover `#6d28d9`) | `#f3eaff` | `#c8a0f0` |
| Caution banner (offline/stale) | text `#8a6d1a`, border `#c9a83f` | `#fff8e6` | `#f0dfa8` |
| Warn badge | text `#c0700a` | `#fff3cd` | — |

**Rule:** interactive chips/buttons are wash-background + strong-color text (+ optional
1.5px tinted border). Solid strong-color fills are reserved for the *active/selected*
state and primary CTAs.

### Avatar palette
Ten fixed classes `.av0`–`.av9`, assigned by `id % 10`:
`#5b6fcc #27ae60 #e67e22 #e74c3c #8e44ad #0097a7 #c0392b #1a6b3a #2471a3 #d4ac0d`

## 2. Typography

- Font stack: `'Segoe UI', system-ui, sans-serif` everywhere; every `<button>`/`<input>`
  gets `font-family: inherit`. Reports meant to be pasted into email use
  `Arial, Helvetica, sans-serif`.
- Base size `14px` on `body`; UI text runs small: 13px controls/body, 12px secondary,
  11px chips/labels, 10px uppercase section labels, 9px micro-badges.
- Headings are small and bold, not large: page/panel/modal titles are 15–16px / 700.
  Full-screen (dark) titles 20–22px / 700.
- Section labels: 10px, 700, `#8a9bb0`, `letter-spacing: 0.8px`, uppercase.
- Weights: 600 names/labels, 700 buttons/titles, 800 stats and big numbers. Timers and
  stat numbers get `font-variant-numeric: tabular-nums`.

## 3. Shape, depth, spacing

- Radii: 6px small controls · 7–8px buttons/inputs/cards · 10px feature cards · 14px
  panels and modal panels · 16px hero modal · 20px pill filters · 50% avatars/dots.
- Borders on light surfaces are `1.5px solid` (hairline dividers are 1px).
- Shadows: panel `0 1px 4px rgba(0,0,0,0.07)` · header `0 2px 12px rgba(0,0,0,0.3)` ·
  modal `0 8px 32px rgba(0,0,0,0.25)` · hero modal `0 12px 48px rgba(0,0,0,0.28)`.
- Overlay scrims: `rgba(0,0,0,0.5)` (0.55 for the hero modal).
- Spacing rhythm: 20px panel padding and page gutters; 12–16px within groups; 4–8px gaps
  between sibling controls; `.main { max-width: 1300px; margin: 0 auto; }`.
- Global reset: `* { box-sizing: border-box; margin: 0; padding: 0; }`.

## 4. Motion

Small and fast; no library. `transition: all 0.15s` (or named props) on interactive
elements; 0.1s on micro-interactions. Press feedback `transform: scale(0.95)` on `:active`.
Hover-grow on round dot-buttons `scale(1.15)` + shadow. Entrances: 0.18s ease
opacity+scale (`@keyframes srIn`). Loading: 0.8s `spin` for spinners, 1.4s `shimmer` for
skeletons. Collapsible banners animate `max-height` + `padding` over 0.3s.

## 5. States

- Hover: darken solid buttons one step; on-dark controls brighten their white alpha;
  outline buttons take the accent color on border+text.
- Active/selected: solid accent fill + white text (`.pill.active`, `.q-btn.active` inverts
  to white bg + navy text on the dark header; `.cls-tab.active` goes `#1a1a2e`).
- Disabled: `opacity ~0.35–0.5`, `cursor: not-allowed`, washed colors.
- Focus: global `:focus-visible { outline: 2px solid #5b6fcc; outline-offset: 2px; }` —
  never remove it, never style `:focus` bare.
- Save indicator states (chip): saving=orange wash, saved=green wash, error=red wash,
  syncing/queued=indigo wash, retry=orange wash. Icons: ⏳ ✓ ✕ ↻ ⏸.

## 6. Responsive & touch

Breakpoints, in the order the stylesheet declares them:
- `@media (pointer: coarse)` — **the touch pass.** Every interactive control gets
  `min-height: 44px` (icon buttons 44×44), font sizes bump ~1–2px, hover-only affordances
  become always visible. Every new control must appear in this block.
- `@media (max-width: 1024px)` — tablet: search stretches, pill row wraps, grids drop a column.
- `@media (max-width: 640px)` — phone: page padding 10px, modals `width: 95vw`,
  two-column grids, bars wrap.
- `@media (orientation: portrait) and (max-width: 1024px)` — portrait-tablet grid tweak.

iOS/iPad specifics: viewport meta with `maximum-scale=1.0`, `apple-mobile-web-app-capable`,
`env(safe-area-inset-top/bottom)` padding on header/body, `overscroll-behavior-y: contain`,
`-webkit-overflow-scrolling: touch` on scrollers, and `touch-action: manipulation;
user-select: none` on every tappable class (one grouped selector at the top of the sheet).

## 7. Accessibility

- `aria-label` + `title` on every icon-only button; `aria-pressed` on toggles;
  `role="group"` + label on filter pill rows; `.sr-only` utility for visually hidden text.
- Live announcements go through an `announce()` helper into an `aria-live` region
  (save failures, offline queueing).
- Emoji used as decoration get `aria-hidden="true"`.
- Icons are inline Feather-style SVGs: `viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`,
  16×16 on desktop (18×18 on touch). No icon font, no image files.

## 8. Light theme only — and print

There is **no dark mode** in suite apps: no theme toggle, no `[data-theme]` rules. Don't
write dark variants for new elements. (The dark chrome surfaces above are part of the
light theme.)

Print: `@media print` hides app chrome; a hidden `#printHeader` becomes visible to title
the printout; a `body[data-modal-print]` attribute flips the page to print a single modal.

## 9. Voice

Friendly-utilitarian, teacher-facing. Sentence case everywhere except the uppercase micro
section labels. Emoji are functional signposts (📋 ⚠ 🚫 ✓ ↩), used sparingly in chrome and
banners, never decorating body text. Errors say what happened and what to do next
("The bridge did not respond within 15 seconds. Check your connection and try again.").
