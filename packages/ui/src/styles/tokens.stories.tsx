import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { cn } from "@gousset/ui/lib/utils";
import { measureEdgePairs, measureTextPairs } from "@gousset/ui/lib/contrast";
import type { MeasuredPair } from "@gousset/ui/lib/contrast";
import { duration, easeOut } from "@gousset/ui/lib/motion";
import { themeTokens } from "@gousset/ui/lib/tokens";
import type { ThemeToken } from "@gousset/ui/lib/tokens";

import globals from "./globals.css?raw";

// The Tailwind class that paints each colour token. A token missing here still shows, with its
// value and no swatch; the browser test checks that every token of globals.css is on the page.
const SWATCHES = new Map(
  Object.entries({
    "--background": "bg-background",
    "--foreground": "bg-foreground",
    "--card": "bg-card",
    "--card-foreground": "bg-card-foreground",
    "--popover": "bg-popover",
    "--popover-foreground": "bg-popover-foreground",
    "--popover-border": "bg-popover-border",
    "--overlay": "bg-overlay",
    "--primary": "bg-primary",
    "--primary-foreground": "bg-primary-foreground",
    "--secondary": "bg-secondary",
    "--secondary-foreground": "bg-secondary-foreground",
    "--muted": "bg-muted",
    "--muted-foreground": "bg-muted-foreground",
    "--accent": "bg-accent",
    "--accent-foreground": "bg-accent-foreground",
    "--destructive": "bg-destructive",
    "--border": "bg-border",
    "--input": "bg-input",
    "--ring": "bg-ring",
    "--sidebar": "bg-sidebar",
    "--sidebar-foreground": "bg-sidebar-foreground",
    "--sidebar-primary": "bg-sidebar-primary",
    "--sidebar-primary-foreground": "bg-sidebar-primary-foreground",
    "--sidebar-accent": "bg-sidebar-accent",
    "--sidebar-accent-foreground": "bg-sidebar-accent-foreground",
    "--sidebar-border": "bg-sidebar-border",
    "--sidebar-ring": "bg-sidebar-ring",
    "--money-spent": "bg-money-spent",
    "--money-saved": "bg-money-saved",
    "--money-left": "bg-money-left",
    "--money-income": "bg-money-income",
    "--money-restricted": "bg-money-restricted",
    "--chart-1": "bg-chart-1",
    "--chart-2": "bg-chart-2",
    "--chart-3": "bg-chart-3",
    "--chart-4": "bg-chart-4",
    "--chart-5": "bg-chart-5",
    "--chart-positive": "bg-chart-positive",
    "--chart-negative": "bg-chart-negative",
    "--chart-background": "bg-chart-background",
    "--chart-foreground": "bg-chart-foreground",
    "--chart-foreground-muted": "bg-chart-foreground-muted",
    "--chart-label": "bg-chart-label",
    "--chart-line-primary": "bg-chart-line-primary",
    "--chart-line-secondary": "bg-chart-line-secondary",
    "--chart-crosshair": "bg-chart-crosshair",
    "--chart-grid": "bg-chart-grid",
    "--chart-brush-border": "bg-chart-brush-border",
    "--chart-tooltip-background": "bg-chart-tooltip-background",
    "--chart-tooltip-foreground": "bg-chart-tooltip-foreground",
    "--chart-tooltip-muted": "bg-chart-tooltip-muted",
    "--chart-marker-background": "bg-chart-marker-background",
    "--chart-marker-border": "bg-chart-marker-border",
    "--chart-marker-foreground": "bg-chart-marker-foreground",
    "--chart-marker-badge-background": "bg-chart-marker-badge-background",
    "--chart-marker-badge-foreground": "bg-chart-marker-badge-foreground",
    "--chart-indicator-color": "bg-chart-indicator-color",
    "--chart-indicator-secondary-color": "bg-chart-indicator-secondary-color",
    "--chart-segment-background": "bg-chart-segment-background",
    "--chart-segment-line": "bg-chart-segment-line",
    "--chart-scale-mix": "bg-chart-scale-mix",
    "--chart-scale-01": "bg-chart-scale-01",
    "--chart-scale-02": "bg-chart-scale-02",
    "--chart-scale-03": "bg-chart-scale-03",
    "--chart-scale-04": "bg-chart-scale-04",
    "--chart-scale-05": "bg-chart-scale-05",
    "--chart-scale-pattern-color": "bg-chart-scale-pattern-color",
  }),
);

const NOTES = new Map(
  Object.entries({
    "--brand-light": "the violet on light: --primary in light",
    "--brand-dark": "the violet on dark: --primary in dark",
    "--card": "blocks, one step above the background",
    "--popover": "floating surfaces: menus, popovers, lists, tooltips, toasts, dialogs",
    "--popover-border": "the edge of a floating surface, 1.7:1 or more around it",
    "--popover-shadow": "the shadow of a floating surface, deeper in dark",
    "--overlay": "the scrim that dims the page behind a sheet or a dialog",
    "--primary": "the brand violet: the accent",
    "--ring": "the focus ring: the accent",
    "--radius": "rounded-lg: 12 px corners on blocks",
    "--money-spent": "spent",
    "--money-saved": "set aside",
    "--money-left": "left",
    "--money-income": "income",
    "--money-restricted": "the stroke of the hatching for money apart",
    "--icon-size": "Tabler icons, unless a size class says otherwise",
    "--icon-stroke": "Tabler icons, outline",
  }),
);

const GROUPS = [
  { title: "Brand", holds: (name: string) => name.startsWith("--brand-") },
  { title: "Money (Gousset's own)", holds: (name: string) => name.startsWith("--money-") },
  { title: "Charts (Bklit's names)", holds: (name: string) => name.startsWith("--chart-") },
  { title: "Sidebar (shadcn's names)", holds: (name: string) => name.startsWith("--sidebar") },
  {
    title: "Sizes",
    holds: (name: string) => name === "--radius" || name.startsWith("--icon-"),
  },
] as const;

const TOKENS = themeTokens(globals);

function isInterface(name: string) {
  return !GROUPS.some((group) => group.holds(name));
}

function TokenRow({ token }: { token: ThemeToken }) {
  const swatch = SWATCHES.get(token.name);
  const note = NOTES.get(token.name);

  return (
    <li className="flex items-center gap-3">
      {swatch === undefined ? (
        <span className="size-8 shrink-0" />
      ) : (
        <span className={cn("size-8 shrink-0 rounded-md border", swatch)} />
      )}
      <span className="flex min-w-0 flex-col">
        <code className="text-sm">{token.name}</code>
        <span className="truncate text-xs text-muted-foreground">
          {note === undefined ? token.value : `${note} · ${token.value}`}
        </span>
      </span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
    </section>
  );
}

function TokenGroup({ title, holds }: { title: string; holds: (name: string) => boolean }) {
  return (
    <Group title={title}>
      {TOKENS.flatMap((token) =>
        holds(token.name) ? [<TokenRow key={token.name} token={token} />] : [],
      )}
    </Group>
  );
}

function ContrastTable({ label, pairs }: { label: string; pairs: ReadonlyArray<MeasuredPair> }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 font-medium">{label}</th>
          <th className="py-1 font-medium">On</th>
          <th className="py-1 text-right font-medium">Light</th>
          <th className="py-1 text-right font-medium">Dark</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map((pair) => (
          <tr key={`${pair.text} ${pair.surface}`} className="border-t">
            <td className="py-1">
              <code>{pair.text}</code>
            </td>
            <td className="py-1">
              <code>{pair.surface}</code>
            </td>
            <td className="py-1 text-right">{pair.light.toFixed(2)}:1</td>
            <td className="py-1 text-right">{pair.dark.toFixed(2)}:1</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TokenSheet() {
  return (
    <div className="flex flex-col gap-8 bg-background p-8 text-foreground">
      <TokenGroup title="Interface (shadcn's names)" holds={isInterface} />
      {GROUPS.map((group) => (
        <TokenGroup key={group.title} title={group.title} holds={group.holds} />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Text</h2>
        <p className="text-2xl font-semibold">Where did my money go?</p>
        <p>Geist sets every text of the app, headings included.</p>
        <p className="text-money-spent tabular-nums">
          −1 111.11 € · −987.65 € · −20.00 € (tabular numerals)
        </p>
        <p className="text-primary">The accent, for links and focus.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Motion</h2>
        <p className="text-sm tabular-nums">
          {`fast ${duration.fast * 1000} ms · base ${duration.base * 1000} ms · slow ${duration.slow * 1000} ms · ease-out cubic-bezier(${easeOut.join(", ")}) · all cut under reduced motion`}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Contrast of every text pair (WCAG, computed from globals.css)
        </h2>
        <ContrastTable label="Text" pairs={measureTextPairs(globals)} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Contrast of the edge of a floating surface (1.7:1 or more, computed from globals.css)
        </h2>
        <ContrastTable label="Edge" pairs={measureEdgePairs(globals)} />
      </section>
    </div>
  );
}

/**
 * Every token of the theme, in the scheme shown, with the contrast of every text pair in both.
 *
 * The accent is the brand violet as it is, `#6a44c8` in light and `#b49af7` in dark: it passes
 * 4.5:1 as text and under its own foreground in both schemes, and its hue sits 56° or more from
 * every money colour (the nearest is `--money-saved`, blue), so it is never read as one of them.
 * Nothing was adjusted.
 *
 * Don't: set a colour that is not a token (`@shadcn/lint` refuses `bg-pink-500` and
 * `p-[13px]`); give the accent to data, which keeps the money colours.
 */
const meta = {
  title: "Theme/Tokens",
  component: TokenSheet,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TokenSheet>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The scheme the system or the picker chose. */
export const Tokens: Story = {};
