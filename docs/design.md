# Gousset: design

Where each element sits is fixed by the validated wireframes ([`wireframes/`](wireframes/index.html), one screen per `?s=<id>`). This file says what they look like.

Status: the naming of CSS variables is validated. The rest of the visual direction is the starting point: the first screen built in the real stack (the monthly review, on made-up data, with its motion) is checked by the maintainer and then serves as the reference for the other screens.

## References

- **[bklit.com](https://bklit.com)**: the basis of the look. Carefully drawn charts on white surfaces, hatched fills, few colours.
- **[ui-sdk.dev](https://ui-sdk.dev)**: everything is built on it. Behaviours (popups, selection, autocomplete, keyboard focus, reordering, virtualised lists) and the components made with them.
- **[motion.dev](https://motion.dev)**: polished, smooth motion wherever it helps.
- **[pug.sh](https://pug.sh)** and its demo: for the **chart rendering only**, not for layout or behaviour. Pug draws its charts with Bklit: its demo uses Bklit's theme variables (`--chart-line-primary`, `--chart-crosshair`, `--chart-scale-01`…). It is an example of Bklit dressed in a real app.

## Interface stack

- **React.** Bklit exists only for React, and Motion covers React, JavaScript and Vue, not Solid. ui-sdk works with React, Vue, Svelte, Solid and Web Components. Solid would lose Bklit and Motion's layout animations.
- **ui-sdk** for behaviours and base components.
- **Bklit UI** for charts. It is built on shadcn/ui, Tailwind and visx.
- **Motion for React** for animation.
- **Tailwind**, **Geist** (typeface) and **Tabler** (icons). Geist sets every text of the app, headings included; the logo's wordmark is drawn in Instrument Sans and converted to paths, so the app never loads that font.
- **kloq** for the few calendar views (recurring payments, see issue #34): installed from its shadcn registry into `packages/ui`, read only, adapted to Gousset's theme.

The rest of the stack is in [`architecture.md`](architecture.md).

## Light and dark

- **A light theme and a dark theme, both first-class.** The system chooses by default; a setting forces one or the other.
- Every colour, every hatching and every chart is checked in both.

## Colour

### Neutral interface, coloured data

The interface stays neutral and the data carries the colour. Text and surfaces are warm greys. Colour is used only for chart series and for states (drifting, to review).

### One colour per role

One colour per role, the same across the whole app:

| Role | Variable |
|---|---|
| spent | `--money-spent` |
| set aside | `--money-saved` |
| left | `--money-left` |
| income | `--money-income` |

These roles hold for the month bar, the breakdowns and the accounts.

### Hatching for money apart

Restricted money in benefit accounts, credits that expire and the refunded part of an expense are **hatched**, like Bklit's patterns (`--money-restricted`). They read as "yours, but not the same" without adding a colour.

## Charts

- Charts have **Bklit's rendering**, as in Pug: thin strokes, a crosshair on hover, sober tooltips, flat fills and hatching. Their layout stays the one of the validated wireframes.
- **The previous month and the average are dotted** on line charts.

## Numbers

Geist, with **tabular numerals** wherever amounts line up.

## Surfaces

- Blocks sit one step above the background: white on very light grey in light, grey on near-black in dark.
- A soft shadow **or** a border, never both.
- 12 px corners.
- No block inside a block.

## Motion

Motion where it explains what changes, never as decoration:

- **Changing month**: bars and amounts move from one value to the next (the digits roll) instead of reloading the page.
- **Approving a line to review**: the line folds away, the "to review" counter goes down, and the bar of the category concerned grows.
- **Opening a detail**: the clicked line becomes the detail panel (a shared layout animation), and folds back into its place on close.
- **Hovering a chart**: a crosshair follows the pointer and the displayed value slides.
- **Import**: the steps advance with the real progress; nothing spins in a void.
- Short durations (150 to 300 ms), easing out at the end.
- Everything is cut when the system asks for reduced motion.

Motion is shared: ui-sdk animates the entry and exit of popups, menus and panels in CSS (`data-starting-style`, `data-ending-style`), and Motion does the rest.

## CSS variables

### What the libraries bring

- **ui-sdk** has variables only in its optional starter style (`web.css`), all prefixed `--ui-`:
  - `--ui-background`, `--ui-foreground`, `--ui-muted`, `--ui-muted-foreground`, `--ui-border`, `--ui-input`, `--ui-ring`, `--ui-primary`, `--ui-destructive`, `--ui-overlay`, `--ui-shadow`;
  - `--ui-radius` (0 by default), `--ui-spacing`, `--ui-font-size`, `--ui-font-sans`, and icons in `--ui-icon-*`.

  They are oklch greys, and each colour carries both values with `light-dark()`, which follows the CSS `color-scheme` property. There is no chart variable. In its examples without `web.css`, the documentation reads shadcn's names: `var(--muted, …)`, `var(--input, …)`, `var(--ring, …)`.
- **Bklit** adds the `--chart-*` variables (`--chart-1` to `--chart-5`, `--chart-positive`, `--chart-negative`, `--chart-grid`, `--chart-crosshair`, `--chart-tooltip-*`…) in `:root` and `.dark`. Some parts read shadcn's variables directly: `--background`, `--foreground`, `--border`, `--popover`, `--muted-foreground`.
- **Pug** uses exactly that: shadcn's variables plus Bklit's `--chart-*`.

### What Gousset does

- **shadcn's names are the source** (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--primary`, `--popover`, `--destructive`…), plus Bklit's `--chart-*`, all defined by Gousset in light and in dark.
- **The `--ui-*` variables are not used**: ui-sdk is styled with Tailwind on shadcn's names. If `web.css` is ever used, each `--ui-*` points to its shadcn equivalent.
- **One switch drives both libraries.** They do not turn dark the same way: ui-sdk through `color-scheme` (its `createColorScheme` sets `data-color-scheme`), Bklit through the `.dark` class. A single choice sets `data-color-scheme`, `color-scheme` and `.dark` on the root.

### Naming

The role logic shared by shadcn, ui-sdk and Bklit:

- names in English, kebab-case: a prefix per domain, then the element, then the role;
- the text set on a colour takes the suffix `-foreground`;
- series are numbered.

| Domain | Names |
|---|---|
| Interface | shadcn's names, no prefix (`--background`, `--muted-foreground`…) |
| Charts | Bklit's `--chart-*`, as they are |
| Money, Gousset's own | `--money-spent`, `--money-saved`, `--money-left`, `--money-income`, `--money-restricted` |

## The first screen built

No throwaway HTML prototype. The first development ticket builds the **monthly review** in the real stack, with its motion and made-up data. Once the maintainer has validated it, it is the reference for the other screens.
