import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { cn } from "@gousset/ui/lib/utils";
import { measureTextPairs } from "@gousset/ui/lib/contrast";
import { duration, easeOut } from "@gousset/ui/lib/motion";

import globals from "./globals.css?raw";

function Swatch({ name, swatch, note }: { name: string; swatch: string; note?: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn("size-8 shrink-0 rounded-md border", swatch)} />
      <span className="flex flex-col">
        <code className="text-sm">{name}</code>
        {note === undefined ? null : <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="grid grid-cols-3 gap-3">{children}</ul>
    </section>
  );
}

function ContrastTable() {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1 font-medium">Text</th>
          <th className="py-1 font-medium">On</th>
          <th className="py-1 text-right font-medium">Light</th>
          <th className="py-1 text-right font-medium">Dark</th>
        </tr>
      </thead>
      <tbody>
        {measureTextPairs(globals).map((pair) => (
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
      <Group title="Interface (shadcn's names)">
        <Swatch name="--background" swatch="bg-background" />
        <Swatch name="--foreground" swatch="bg-foreground" />
        <Swatch name="--card" swatch="bg-card" note="blocks, one step above the background" />
        <Swatch name="--popover" swatch="bg-popover" />
        <Swatch name="--primary" swatch="bg-primary" note="the brand violet: the accent" />
        <Swatch name="--primary-foreground" swatch="bg-primary-foreground" />
        <Swatch name="--secondary" swatch="bg-secondary" />
        <Swatch name="--muted" swatch="bg-muted" />
        <Swatch name="--muted-foreground" swatch="bg-muted-foreground" />
        <Swatch name="--accent" swatch="bg-accent" />
        <Swatch name="--destructive" swatch="bg-destructive" />
        <Swatch name="--border" swatch="bg-border" />
        <Swatch name="--input" swatch="bg-input" />
        <Swatch name="--ring" swatch="bg-ring" note="the focus ring: the accent" />
      </Group>

      <Group title="Money (Gousset's own)">
        <Swatch name="--money-spent" swatch="bg-money-spent" note="spent" />
        <Swatch name="--money-saved" swatch="bg-money-saved" note="set aside" />
        <Swatch name="--money-left" swatch="bg-money-left" note="left" />
        <Swatch name="--money-income" swatch="bg-money-income" note="income" />
        <Swatch
          name="--money-restricted"
          swatch="bg-money-restricted"
          note="the stroke of the hatching for money apart"
        />
      </Group>

      <Group title="Charts (Bklit's names)">
        <Swatch name="--chart-1" swatch="bg-chart-1" note="= --money-spent" />
        <Swatch name="--chart-2" swatch="bg-chart-2" note="= --money-saved" />
        <Swatch name="--chart-3" swatch="bg-chart-3" note="= --money-left" />
        <Swatch name="--chart-4" swatch="bg-chart-4" note="= --money-income" />
        <Swatch name="--chart-5" swatch="bg-chart-5" note="= --muted-foreground" />
        <Swatch name="--chart-positive" swatch="bg-chart-positive" />
        <Swatch name="--chart-negative" swatch="bg-chart-negative" />
        <Swatch name="--chart-background" swatch="bg-chart-background" />
        <Swatch name="--chart-label" swatch="bg-chart-label" />
        <Swatch name="--chart-grid" swatch="bg-chart-grid" />
        <Swatch name="--chart-crosshair" swatch="bg-chart-crosshair" />
        <Swatch name="--chart-tooltip-background" swatch="bg-chart-tooltip-background" />
        <Swatch name="--chart-marker-background" swatch="bg-chart-marker-background" />
        <Swatch name="--chart-marker-border" swatch="bg-chart-marker-border" />
        <Swatch name="--chart-scale-01" swatch="bg-chart-scale-01" />
        <Swatch name="--chart-scale-03" swatch="bg-chart-scale-03" />
        <Swatch name="--chart-scale-05" swatch="bg-chart-scale-05" />
        <Swatch name="--chart-indicator-color" swatch="bg-chart-indicator-color" />
      </Group>

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
        <ContrastTable />
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
