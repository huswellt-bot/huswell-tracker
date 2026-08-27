# Huswell Command Center Design System

## Intent

Huswell is a practical command center for operations, sales, finance, inventory, and people. Its interface uses the supplied reference as inspiration for its hierarchy: a dark operational sidebar, a crisp utility header, and a calm light canvas for business data. It remains original to Huswell in content, information architecture, logo treatment, and layouts.

## Visual Direction

- **Command-center shell:** Deep navy navigation anchors the desktop experience; the work area is a pale blue-gray canvas.
- **Clear and operational:** Information is organized into compact, white cards with fine borders, small shadows, and color only where it conveys status.
- **Friendly precision:** Poppins, rounded controls, restrained iconography, and generous whitespace keep dense business data approachable.
- **Single accent:** Blue is the primary action and active-navigation color. Green, amber, purple, and red carry specific positive, warning, inventory, and exception meanings.

## Tokens

### Primitive

```css
:root {
  --blue-600: #2168d6;
  --blue-700: #1958b6;
  --navy-950: #061426;
  --navy-900: #0a1c34;
  --slate-950: #151922;
  --slate-600: #626b7a;
  --slate-400: #8b92a1;
  --slate-200: #dfe5ed;
  --slate-100: #edf1f5;
  --slate-50: #f5f7fa;
  --white: #ffffff;
  --green-600: #159957;
  --amber-500: #f5a524;
  --red-600: #df3d3d;
  --purple-600: #7352cf;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --radius-control: 8px;
  --radius-card: 14px;
}
```

### Semantic

```css
:root {
  --canvas: var(--slate-50);
  --surface: var(--white);
  --surface-muted: #f8faff;
  --border: var(--slate-200);
  --text: var(--slate-950);
  --text-secondary: var(--slate-600);
  --text-muted: var(--slate-400);
  --primary: var(--blue-600);
  --primary-hover: var(--blue-700);
  --sidebar: var(--navy-950);
  --success: var(--green-600);
  --warning: var(--amber-500);
  --danger: var(--red-600);
}
```

## Component Rules

- **Sidebar:** 256px wide on desktop; dark navy with a subtle right edge. The active link is solid blue with white text. Inactive links are soft blue-gray and brighten on hover. Put the profile and sign-out controls at the bottom.
- **Header:** White, 80â€“88px high, with the menu control, contextual greeting/title, date, notification affordance, and compact profile summary. It stays visually separate from the work canvas with a fine bottom border.
- **Cards:** White, 14px rounded corners, 1px border, 18â€“24px padding, and only a minimal shadow. Use cards for metrics, tables, charts, and forms.
- **Metric cards:** A 48px colored circular icon sits beside a muted uppercase label, a compact semibold value, and a short contextual note. Values remain dark; semantic colors belong to the icon and change indicator.
- **Buttons:** Primary buttons are blue with white, 600-weight text; secondary buttons are white with a quiet border. All controls use 8px radius and at least 36px height.
- **Tables:** Use small uppercase/slate header labels, 44â€“48px rows, faint separators, and a pale hover state. Status is a small soft-color badge, never a large saturated block.
- **Forms and dialogs:** White controls, fine borders, 8px radii, and a blue focus ring. Dialogs float above a subtle navy overlay with a card-style surface.

## Layout

- Desktop content starts after the persistent sidebar. The page body uses 20â€“28px padding and 16â€“20px card gaps.
- Dashboards use a responsive metric grid (four columns on wide desktop, two on tablet, one on mobile) followed by a 12-column content grid.
- Small screens use a slide-over sidebar. Tables may scroll horizontally, but content cards must collapse before becoming cramped.
- Use Lucide outlined icons at 16â€“18px, or 20px only for high-level metric symbols.

## Accessibility and Quality Bar

- Maintain WCAG AA contrast and provide a visible blue focus state.
- Never use color alone for warning, error, or success; labels and icons support the color.
- Respect reduced motion and avoid gradients, glass effects, large decorative artwork, deep shadows, or oversized type.
- The result should feel like Huswellâ€™s own business workspace, not a copy of the referenceâ€™s logo, labels, data, or exact dashboard composition.
