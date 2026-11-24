# Gousset: design

Where each element sits is fixed by the validated wireframes ([`wireframes/`](wireframes/index.html), one screen per `?s=<id>`). This file says what they look like.

The 0.2 finishing pass ([`prototypes/0.2/`](prototypes/0.2/index.html)) is validated after them and wins where the two differ. The import screen's file list follows it: four columns instead of the wireframe's seven (screen 6, block 2), the format, the account and the period set back under the file's name, each still named for screen readers, and a dash for a fact not found yet.

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
- **Tailwind**, **Geist** (typeface) and **Tabler** (icons, see [Icons](#icons)). Geist sets every text of the app, headings included; the logo's wordmark is drawn in Instrument Sans and converted to paths, so the app never loads that font.
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

A list of amounts by direction (the operations) colours money in with `--amount-in`, the income hue a shade darker in light so that it keeps 4.5:1 on a hovered or open row, and leaves money out in the text's colour. Its sign is always written (a plus, a true minus), so the direction reads without the colour.

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

### Floating surfaces

What floats above the page (menus, popovers, a select's or a combobox's list, the calendar, tooltips, toasts, dialogs and sheets) must never be mistaken for it, over the page, a block or the sidebar, in either scheme. It takes **all three**, never one alone, unlike blocks:

- **Its own surface**: `--popover`. White in light, like the blocks: the edge and the shadow set it off. In dark, a step above the blocks (nearer is lighter).
- **A visible edge**: a 1 px border in `--popover-border`, darker than the blocks' `--border` in light and lighter in dark. It keeps **1.7:1 or more** against the page, the blocks, the sidebar and its own inside, in both schemes (the blocks' `--border` gives 1.2 to 1.4:1). `src/lib/contrast.test.ts` measures it from `globals.css`, and the "Theme/Tokens" story lists the figures: 1.74:1 on the page and 1.87:1 on a block or the sidebar in light; 2.07:1 on the page, 1.90:1 on a block or the sidebar and 1.79:1 on its inside in dark.
- **An elevation shadow**: `--popover-shadow` (`shadow-popover`), a tight contact shadow and a wide soft one. Deeper in dark, where a soft shadow is lost on the near-black page.

The classes live once in `packages/ui` (`floatingSurfaceClasses`); a floating component uses them and adds only its size and spacing. A sheet keeps its edge on the side that faces the page. The charts' tooltip is Bklit's own panel, vendored: it takes the same edge and shadow (`border-popover-border`, `shadow-popover`) as a recorded local change (`charts/UPSTREAM.md`), its surface being `--chart-tooltip-background`, which is `--popover`.

Behind a dialog or a sheet, a **backdrop** dims the page: the scrim `--overlay`, dark in both schemes, so the page behind never reads as disabled. Over it the sheet or the dialog stands out by its own surface and its shadow: in light the white fill against the dimmed page (about 2.1:1), in dark its edge (about 2.2:1). The 1.7:1 rule of the edge holds for what floats over the page itself, not over the scrim, where the light edge is about 1.1:1 and the fill carries it. A press on it closes what it is behind, as Escape and the close button do, except while a form there is being sent.

### The focus ring

2 px in `--ring`, 2 px away from the element, on everything that takes focus. It is **never clipped**: a container that scrolls keeps 4 px of padding inside the scroller on every side where a field can sit, and as much scroll padding, so a field scrolled into view keeps its ring whole (a sheet's body, a dialog). A row of a list, whose neighbours touch it, draws its ring 2 px inside instead.

## Actions and forms

A page shows things; it does not hold an action's form.

- **An action that asks for input** (create, edit, reset, note a balance, set an expiry…) is a button that opens a **dialog** holding the form (`Dialog` with `onSubmit`). The button sits where the action applies: beside the title of the block it changes ("Create a user" beside the list of users), or beside the page's title for the screen's main action.
- **A long form** (several groups of fields, with effects to read: creating a subject, editing a rule) opens in a side `Sheet` instead, as the wireframes draw it (screens 8 and 9). It is still a button that opens it, never a form inline in the page.
- **On a phone** (below 768 px, where the tab bar shows) both are a **sheet** along the bottom edge, its whole width: the dialog, and the side sheet.
- The dialog's actions are Cancel (a ghost button), then the submit button. While the form is sent the dialog stays open, its button busy: neither the backdrop, Escape, the close button nor Cancel closes it. A refusal keeps the dialog open and says why under the field at fault; once the form is accepted the dialog closes, focus goes back to the button that opened it, and the page shows the result (the new line in its list, a sentence saying what was done).
- **Settings that apply at once** (a switch, a choice, a button that turns something on) stay inline in the page: they ask for nothing to fill in.
- A screen that is itself the task (signing in, the first setup, changing a temporary password, an MCP client's consent, importing a statement) is not a page that shows things: its form is the screen. On the import screen, what an import asks before it goes on (the account a file is for, a CSV file's columns) stays under its row, a step of that import.

Motion: the dialog fades and grows from 96 % in 200 ms, ease-out, and leaves in 150 ms, ease-in. The side sheet slides in from beyond its edge in 300 ms, ease-out, and back out in 200 ms, ease-in. On a phone both rise from the bottom edge in 300 ms and go back down in 200 ms. The backdrop fades in and out in 200 ms. Cut under reduced motion: they are there, or not. A form sheet opens on its first field; a dialog on its title.

## Motion

Motion where it explains what changes, never as decoration:

- **Changing month**: bars and amounts move from one value to the next (the digits roll) instead of reloading the page.
- **Approving a line to review**: the line folds away, the "to review" counter goes down, and the bar of the category concerned grows.
- **Opening a detail**: the clicked line is marked and the detail opens beside the list, never over it: its column widens (a width, never a scale, so no text is squashed) as the list makes room, and its content fades in once there is room; closing, the content fades out first, then the column closes. Below 1024 px the detail is a modal sheet over the list instead, behind which nothing is browsed: rising from the bottom edge on a phone, coming from the side on a tablet.
- **Hovering a chart**: a crosshair follows the pointer and the displayed value slides.
- **Import**: the steps advance with the real progress; nothing spins in a void.
- Short durations (150 to 300 ms), easing out at the end.
- Everything is cut when the system asks for reduced motion.

Motion is shared: ui-sdk animates the entry and exit of popups, menus and panels in CSS (`data-starting-style`, `data-ending-style`), and Motion does the rest.

## Brand

The logo files are in [`brand/`](../brand/README.md): a G in one stroke whose bar is a coin, violet `#b49af7` on dark and `#6a44c8` on light. The wordmark is Instrument Sans, drawn as paths; the app's text stays in Geist. The violet is the app's accent (`--primary`, focus ring), checked against the `--money-*` colours so that it is never read as one of them.

## Icons

**Tabler Icons** (`@tabler/icons-react`), outline style, stroke 1.5. It covers every category a budget needs (groceries, fuel, health, travel, pets…), takes `currentColor`, a size and a stroke width, and is tree-shaken.

- **Pages never import Tabler directly.** `packages/ui` exports the icons Gousset uses under its own names (`icons.ts`: `ImportIcon`, `TransferIcon`, `CategoryIcons.groceries`…), through one `Icon` wrapper that sets the size and the stroke. Changing the stroke, a drawing or the whole library touches that file only.
- Category icons are chosen once, in that file, and the user picks among them; no emoji.

## Loading

Skeletons are for blocks whose data is coming ([architecture](architecture.md#data-loading-and-skeletons)). For an action or a job (a button that saves, an import reading its file), one indicator: **`Loader`**.

- **The drawing: a coin falling into a pocket.** A U-shaped pocket (`M5 11v4a7 7 0 0 0 14 0v-4` in a 24 grid, stroke 2.6, round caps) and a coin (radius 3) that falls into it and fades, looping in about 1.3 s.
- **One component, one place.** The SVG and its keyframes live only in `Loader` (CSS animation, no JavaScript, no inline style, so the Content Security Policy and `@shadcn/lint` stay happy). Every loading spot uses `Loader`; changing the animation, or replacing it with another drawing, touches that component only.
- It takes `currentColor` and is sized in `em`, so it follows the text it sits in: 16 px in a button, 14 px in a small one.
- **Reduced motion**: nothing falls; the coin pulses softly.
- **In a button** (`Button`'s `loading` prop): the loader takes the place of the button's icon, the button keeps its width, is disabled and `aria-busy`, and its label may change ("Importing…"). It shows only after about 300 ms and then stays at least 500 ms, so it never flashes.
- At 14 px the pocket is small: its story checks it at that size in both themes, and the stroke or the coin may be thickened for small sizes.

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
| Amounts by direction | `--amount-in` |

## The first screen built

No throwaway HTML prototype. The first development ticket builds the **monthly review** in the real stack, with its motion and made-up data. Once the maintainer has validated it, it is the reference for the other screens.
