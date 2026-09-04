# GUI Design System — Strict Standard (Brand Color Template)

This is a mandatory design contract. Every screen, component, and state must comply. The **only variable input required is the client's main brand color** — everything else derives from it automatically using the rules below.

---

## 0. Input

```
BRAND_COLOR = #B22222  ← the ONLY thing you fill in
```

Example: `BRAND_COLOR = #DC2626` (red) or `#2563EB` (blue).

Do not introduce any other color into the UI outside of what this document derives from `BRAND_COLOR`. One brand color in, one consistent palette out.

---

## 1. Core Principles (unchanged regardless of brand color)

- **Flat only.** No shadows implying elevation, no gradients, no glassmorphism, no glow, no 3D bevels.
- **Compact by default.** Tight padding, tight line-height, small type.
- **No AI-slop / no vibecoded look.** No gradient hero banners, no oversized rounded blobs, no emoji-as-icons, no mismatched icon styles, no random drop shadows, no inconsistent corner radii.
- **One accent color only** — derived from `BRAND_COLOR`. Never add a second "vibrant" color for decoration.
- Background and card surfaces stay **neutral** (white/gray) regardless of brand color — the brand color is an _accent_, not a wallpaper.

---

## 2. Deriving the Palette from `BRAND_COLOR`

Neutrals never change — only the accent ramp is generated from `BRAND_COLOR`.

### 2.1 Neutrals (fixed, brand-agnostic)

| Token                    | Value     | Usage                                              |
| ------------------------ | --------- | -------------------------------------------------- |
| `--color-bg`             | `#FFFFFF` | Page/app background                                |
| `--color-surface`        | `#FFFFFF` | Card, panel, modal background                      |
| `--color-border`         | `#e5e7eb` | Card border, dividers, input borders               |
| `--color-border-strong`  | `#d1d5db` | Hover/focus border                                 |
| `--color-text-primary`   | `#111827` | Primary text                                       |
| `--color-text-secondary` | `#6b7280` | Secondary/muted text                               |
| `--color-text-disabled`  | `#9ca3af` | Disabled text                                      |
| `--color-text-tertiary`  | `#9ca3af` | De-emphasized icons (e.g. sidebar icons vs. label) |
| `--color-sidebar-label`  | `#374151` | Default sidebar item labels; darker than icons     |
| `--color-sidebar-icon`   | `#b6beca` | Default and hover sidebar item icons               |
| `--color-surface-subtle` | `#f9fafb` | Zebra rows, inset panels                           |

### 2.2 Accent ramp (generated from `BRAND_COLOR`)

Use `color-mix()` so the whole ramp updates automatically from one hex value — no manual shade-picking, no drift.

```css
:root {
  --brand: #dc2626; /* ← set BRAND_COLOR here, nowhere else */

  /* Derived accent ramp — do not hardcode these anywhere */
  --color-accent: var(--brand);
  --color-accent-hover: color-mix(in srgb, var(--brand) 85%, black);
  --color-accent-active: color-mix(in srgb, var(--brand) 70%, black);
  --color-accent-subtle: color-mix(
    in srgb,
    var(--brand) 8%,
    white
  ); /* tag/badge bg */
  --color-accent-border: color-mix(
    in srgb,
    var(--brand) 30%,
    white
  ); /* tag/badge border */
  --color-accent-text: color-mix(
    in srgb,
    var(--brand) 85%,
    black
  ); /* text-on-white using brand */
  --color-on-accent: #ffffff; /* text/icon color when sitting on --color-accent fill */
}
```

Fallback if `color-mix()` isn't available in the build target: precompute the same 6 values with a color tool (e.g. mix with white/black at those percentages) and hardcode the hex results once, still from the single `BRAND_COLOR` input.

### 2.3 Status colors (fixed, independent of brand)

| Token             | Value     | Usage                       |
| ----------------- | --------- | --------------------------- |
| `--color-danger`  | `#dc2626` | Errors, destructive actions |
| `--color-success` | `#16a34a` | Success states              |
| `--color-warning` | `#d97706` | Warning states              |

> Exception: if `BRAND_COLOR` itself is red/green/amber, keep status colors as-is anyway — status meaning must stay universally recognizable and must never be ambiguous with brand actions.

---

## 3. Where the Brand Color Is Allowed to Appear

Restricting surface area is what keeps this from looking like a themed template. `--color-accent` (and its derived tokens) may **only** be used for:

- Primary button fill (`--color-accent` bg, `--color-on-accent` text)
- Active/selected sidebar nav item (solid full-row fill — see §7.1)
- Links
- Focus outline
- Checkboxes/radios/toggles when checked
- Progress bars / active step indicators
- Badge/tag using `--color-accent-subtle` + `--color-accent-border` + `--color-accent-text`

It must **never** be used for:

- Page or card backgrounds
- Large surface fills / hero sections
- Body text
- Icon default color (icons stay `--color-text-secondary` unless interactive/active)
- More than one saturation level competing on the same screen

---

## 4. Typography

- **Base font size: `13px`.**
- **Font family: Geist Sans, app-wide, no exceptions.**

```css
--font-family: "Geist", "Geist Sans", -apple-system, "Segoe UI", sans-serif;
```

Install via package (recommended for React/Next.js):

```bash
npm install geist
```

```jsx
// app/layout.tsx (Next.js example)
import { GeistSans } from "geist/font/sans";

<html className={GeistSans.className}>
```

Or via `<link>` / `@font-face` for non-Next stacks — self-host the Geist font files rather than pulling from a third-party CDN. Never mix in a second font family (no serif accents, no separate "display" font) — Geist Sans handles every text level below via weight/size only.

| Level   | Size | Weight |
| ------- | ---- | ------ |
| Display | 20px | 600    |
| H1      | 16px | 600    |
| H2      | 14px | 600    |
| Body    | 13px | 400    |
| Small   | 12px | 400    |
| Micro   | 11px | 500    |

Line height: `1.4–1.5` body, `1.2` headings. No text gradients, no text shadows, no brand-colored headings by default (text stays `--color-text-primary`).

---

## 5. Layout & Spacing

- Spacing scale (px): `4, 8, 12, 16, 20, 24, 32`.
- Control padding: `8px 12px`. Card padding: `12px 16px`.
- Border radius: one value for controls (`6px`), one for cards (`8px`) — no mixing.

### 5.1 Page-Level Layout Rule

- **No page — including Dashboard — is ever wrapped in a single outer card.** The page body sits directly on `--color-bg`, flat, full-width within the content area. Do not add a bordered/card container around the entire page's content as a page shell.
- Cards are used **locally**, for discrete pieces of content only: a stat block, a table panel, a chart, a form section, a list. A page is composed of multiple independent cards/sections placed on the flat background with normal spacing (`--space-4`–`--space-6` between sections) — not one big card holding everything.
- This applies to every page reachable from the sidebar, with no exception for Dashboard.

---

## 6. Cards

```css
background: var(--color-surface);
border: 1px solid var(--color-border);
border-radius: 8px;
box-shadow: none;
padding: 12px 16px;
```

No shadow lift on hover — border-color shift to `--color-border-strong` only.

---

## 7. Buttons

| Variant   | Background                                       | Border                          | Text                     |
| --------- | ------------------------------------------------ | ------------------------------- | ------------------------ |
| Primary   | `--color-accent` (hover: `--color-accent-hover`) | none                            | `--color-on-accent`      |
| Secondary | `--color-surface`                                | `1px solid var(--color-border)` | `--color-text-primary`   |
| Ghost     | transparent                                      | none                            | `--color-text-secondary` |
| Danger    | `--color-danger`                                 | none                            | `#FFFFFF`                |

Height `28–32px`. No gradient fill, no shadow, no glow — focus state is a `1–2px` solid outline using `--color-accent`.

---

## 7.1 Sidebar Navigation

Rest, hover, and active states for sidebar nav items. Active state is the **one place** besides primary buttons where `--color-accent` is used as a full solid fill.

| State      | Background               | Label text                  | Icon                        | Border |
| ---------- | ------------------------ | --------------------------- | --------------------------- | ------ |
| Default    | transparent              | `--color-sidebar-label`     | `--color-sidebar-icon`      | none   |
| Hover      | `--color-surface-subtle` | `--color-text-primary`      | `--color-sidebar-icon`      | none   |
| **Active** | `--color-accent` (solid) | `--color-on-accent` (white) | `--color-on-accent` (white) | none   |

```css
.sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 12px;
  border-radius: var(--radius-control);
  font-size: var(--font-size-base);
  color: var(--color-sidebar-label);
  background: transparent;
  cursor: pointer;
}

.sidebar-item svg {
  color: var(--color-sidebar-icon);
}

.sidebar-item span {
  color: var(--color-sidebar-label);
}

.sidebar-item:hover {
  background: var(--color-surface-subtle);
}

.sidebar-item:hover span {
  color: var(--color-text-primary);
}

.sidebar-item.active {
  background: var(--color-accent);
}

.sidebar-item.active span,
.sidebar-item.active svg {
  color: var(--color-on-accent);
}
```

Rules:

- Fill spans the **full row** (edge to edge within sidebar padding), flat, no gradient, no shadow — a solid rectangle/pill only, radius matches `--radius-control`.
- Icon inside an active item switches to `--color-on-accent` (white), same as the label — never leave the icon in its default muted color against a solid brand background.
- Non-active sidebar labels must be visibly darker than their icons even before hover: label text uses `--color-sidebar-label` by default and `--color-text-primary` on hover, while the icon stays `--color-sidebar-icon`. Do not give default sidebar text and icons the same color, and do not rely on only a tiny secondary/tertiary token difference for this contrast.
- Only **one** item is active at a time. Do not combine the solid fill with an additional left-border accent — pick this treatment exclusively, don't stack it with the older left-border pattern.
- Non-active items never get a background fill beyond the hover state above.
- **Icon color is stepped clearly lighter than the label text** on default and hover states, using `--color-sidebar-icon` — a fixed, solid color rather than opacity, so the effect stays consistent across every background the item can sit on. On the active state, the icon switches to full `--color-on-accent` (white) — same as the label — for full contrast against the solid brand fill.

```css
.sidebar-item svg {
  color: var(
    --color-sidebar-icon
  ); /* default + hover: icon quieter than label */
}

.sidebar-item.active svg {
  color: var(--color-on-accent); /* active: full white, matches label */
}
```

---

## 7.2 Tabs (Horizontal Tab Navigation)

Active tab indicator is a **flat bottom line only** — no rounded corner borders, no boxed/pill tab backgrounds, no partial border framing around the tab.

| State      | Text                     | Border                                                    |
| ---------- | ------------------------ | --------------------------------------------------------- |
| Default    | `--color-text-secondary` | none (shared `1px` bottom border spans the whole tab row) |
| Hover      | `--color-text-primary`   | none                                                      |
| **Active** | `--color-accent-text`    | `2px solid var(--color-accent)` on **bottom edge only**   |

```css
.app-tabs {
  display: flex;
  gap: var(--space-1);
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border); /* shared baseline for the whole row */
}

.app-tab {
  min-height: 32px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  cursor: pointer;
  white-space: nowrap;
}

.app-tab:hover {
  color: var(--color-text-primary);
}

.app-tab[aria-current="page"],
.app-tab.active {
  color: var(--color-accent-text);
  border-bottom: 2px solid var(--color-accent); /* brand color, bottom line only */
}
```

Rules:

- No rounded top corners, no partial border boxing the tab (do not replicate a border that wraps top + sides of only the active tab).
- No background fill on the active tab — brand text color + bottom border only.
- The `2px` bottom line always uses `--color-accent` (full brand color), never the subtle/tinted accent variant.
- Active tab text must use `--color-accent-text`, never gray/neutral text. The active state should read as selected through brand color, not through a gray weight change.
- This is a **separate pattern from Sidebar Navigation (§7.1)** — tabs never use a solid full fill; only the sidebar active state does.

---

## 8. Icons

- **`lucide-react` exclusively.**
- Sizes: `14px` dense UI, `16px` default, `20px` section headers.
- Stroke width: consistent app-wide, default `1.75–2`.
- Default icon color: `--color-text-secondary`. Only switch to `--color-accent` when the icon represents an active/selected/current state.

```jsx
import { Search, ChevronRight } from "lucide-react";
<Search size={16} strokeWidth={1.75} color="var(--color-text-secondary)" />;
```

---

## 9. Scrollbars

```css
* {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background-color: #d1d5db;
  border-radius: 8px;
}
*::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af;
}
```

---

## 10. Forms & Inputs

- Height: `32px` default, `28px` dense/table-inline.
- Border: `1px solid var(--color-border)`; focus: border-color `var(--color-accent)`, no glow ring.
- Labels: `12px`, weight `500`, `--color-text-secondary`.

---

## 11. Tables

Tables must be compact by default: dense data display over airy spacing. Table headers should read as quiet structural labels, not decorative blocks.

| Property          | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Row height        | `28-32px` (never taller by default)                                      |
| Cell padding      | `6px 10px`                                                               |
| Body font         | `12px`, weight `400`, `--color-text-primary`                             |
| Header font       | `12px`, weight `600`, `--color-text-secondary`                           |
| Header border     | `1px solid var(--color-border)` bottom only                              |
| Row border        | `1px solid var(--color-border)` bottom only (no vertical column borders) |
| Header background | transparent by default; `--color-surface-subtle` only for sticky headers |

### 11.1 Default Header

Use the minimal no-fill style for standard tables. The header sits flush with the table surface and uses muted text so it frames the data without competing with it.

```css
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

td {
  padding: 6px 10px;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border);
}

tr:hover td {
  background: var(--color-surface-subtle);
}
```

### 11.2 Sticky Header

Use a subtle neutral fill only when the table needs stronger separation, such as sticky headers or long scrolling data tables.

```css
th {
  background: var(--color-surface-subtle);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
```

Rules:

- Default to transparent table headers; use `--color-surface-subtle` only for sticky headers.
- Header text uses `--color-text-secondary`; avoid `--color-text-primary` unless a specific component requires stronger hierarchy.
- No shadows on sticky headers: border only.
- No brand, status, or decorative color in table headers.
- No uppercase table headers with letter spacing by default.
- No vertical/column dividers by default: rows are separated by horizontal border only, unless the data genuinely requires column separation (for example, a dense financial grid). If required, use `1px solid var(--color-border)` verticals, never a heavier or colored rule.
- Zebra striping is optional with `--color-surface-subtle` on alternating rows; never use brand-tinted rows.
- Avoid oversized action buttons/icons inside table cells; use `14px` icon size and `28px` max control height so row height does not inflate.
- Avoid excess vertical padding for readability; compactness takes priority.
- Avoid borders on all four sides of each `th`; that creates a boxed grid that reads dated.

---

## 12. States & Feedback

- Badges: `--color-accent-subtle` bg + `--color-accent-border` border + `--color-accent-text` text — flat, no solid saturated fill.
- Status badges (error/success/warning) use their own fixed tokens, same subtle-fill pattern, never brand color.
- Loading: simple spinner/skeleton in `#f3f4f6`. No rainbow shimmer.
- Empty states: Lucide icon (`24–32px`, `--color-text-secondary`) + short text, no illustrations.

---

## 13. Anti-Patterns (explicit — always avoid)

- ❌ Gradient buttons/text/backgrounds using the brand color or otherwise
- ❌ Full-page or full-card brand-color fills
- ❌ Drop shadows on cards, buttons, modals
- ❌ Mixed border-radius values in one view
- ❌ Emoji as functional icons
- ❌ Brand color used on more than the allow-list in §3
- ❌ A second competing accent color introduced ad hoc
- ❌ Font-size values outside the defined type scale
- ❌ Thick/colorful scrollbars
- ❌ Wrapping an entire page (including Dashboard) in one outer card as a page shell

---

## 14. Full CSS Variable Block (copy-paste, edit only line 1)

```css
:root {
  --brand: #dc2626; /* ← ONLY EDIT THIS LINE PER CLIENT */

  /* Neutrals — fixed */
  --color-bg: #ffffff;
  --color-surface: #ffffff;
  --color-surface-subtle: #f9fafb;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-text-primary: #111827;
  --color-text-secondary: #6b7280;
  --color-text-disabled: #9ca3af;

  /* Accent — derived from --brand, do not hand-edit below this line */
  --color-accent: var(--brand);
  --color-accent-hover: color-mix(in srgb, var(--brand) 85%, black);
  --color-accent-active: color-mix(in srgb, var(--brand) 70%, black);
  --color-accent-subtle: color-mix(in srgb, var(--brand) 8%, white);
  --color-accent-border: color-mix(in srgb, var(--brand) 30%, white);
  --color-accent-text: color-mix(in srgb, var(--brand) 85%, black);
  --color-on-accent: #ffffff;

  /* Status — fixed */
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #d97706;

  /* Radius */
  --radius-control: 6px;
  --radius-card: 8px;

  /* Type */
  --font-family: "Geist", "Geist Sans", -apple-system, "Segoe UI", sans-serif;
  --font-size-base: 13px;
  --font-size-sm: 12px;
  --font-size-xs: 11px;
  --font-size-h2: 14px;
  --font-size-h1: 16px;
  --font-size-display: 20px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
}

body {
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  background: var(--color-bg);
  color: var(--color-text-primary);
}

* {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background-color: #d1d5db;
  border-radius: 8px;
}
*::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af;
}
```

---

## 15. Usage Note

For any new client project: copy this file, set `--brand` on line 1 of §14 to the client's main color, and build against these tokens only. No other design decision changes per client — same spacing, same type scale, same component shapes, same restraint. Only the accent ramp shifts.
