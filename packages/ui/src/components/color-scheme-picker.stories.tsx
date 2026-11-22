import type { Meta, StoryObj } from "@storybook/react-vite";

import { Grid } from "@gousset/ui/components/charts/grid";
import { Line } from "@gousset/ui/components/charts/line";
import { LineChart } from "@gousset/ui/components/charts/line-chart";
import { XAxis } from "@gousset/ui/components/charts/x-axis";
import type { ColorSchemePickerProps } from "@gousset/ui/components/color-scheme-picker";
import { ColorSchemePicker } from "@gousset/ui/components/color-scheme-picker";
import { useHydrated } from "@gousset/ui/hooks/use-hydrated";

// Made-up figures for six months (packages/fixture has no generator yet).
const MONTHS = [
  { date: new Date(2026, 0, 1), spent: 1840, income: 2450 },
  { date: new Date(2026, 1, 1), spent: 1620, income: 2450 },
  { date: new Date(2026, 2, 1), spent: 2110, income: 2520 },
  { date: new Date(2026, 3, 1), spent: 1790, income: 2450 },
  { date: new Date(2026, 4, 1), spent: 1930, income: 2610 },
  { date: new Date(2026, 5, 1), spent: 1700, income: 2450 },
];

const CHOICES = { system: "System", light: "Light", dark: "Dark" };

function PickerWithChart(props: ColorSchemePickerProps) {
  // Bklit's chart is drawn in the browser only: its frame's `style` attributes have no place in
  // the server's markup (see `SpendingChart`).
  const hydrated = useHydrated();

  return (
    <div className="flex max-w-2xl flex-col gap-6 rounded-lg border bg-card p-6">
      <ColorSchemePicker {...props} />
      <div data-testid="chart">
        {hydrated ? (
          <LineChart data={MONTHS}>
            <Grid />
            <Line dataKey="spent" stroke="var(--chart-1)" />
            <Line dataKey="income" stroke="var(--chart-4)" />
            <XAxis />
          </LineChart>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The colour scheme: the system's by default, light or dark by choice, kept in this browser.
 * One choice drives ui-sdk's parts (through `color-scheme`) and Bklit's charts (through the same
 * variables and `.dark`) together, without a reload.
 *
 * Motion: the colours change at once; only the picker's own items fade their colours (200 ms,
 * ease-out), and that is cut under reduced motion.
 *
 * Don't: read the scheme to choose a colour in a component. Use the theme's tokens; they follow
 * the scheme by themselves.
 */
const meta = {
  title: "Theme/Colour scheme",
  component: ColorSchemePicker,
  args: { label: "Colour scheme", choices: CHOICES },
} satisfies Meta<typeof ColorSchemePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Picker: Story = {};

/** Disabled: the current choice shows, nothing can be picked (half opacity, no hover). */
export const Disabled: Story = { args: { disabled: true } };

/** Disabled, on dark whatever the page's scheme: the faint items stay readable on `--muted`. */
export const DisabledOnDark: Story = {
  args: { disabled: true },
  render: (args) => (
    <div data-color-scheme="dark" className="w-fit rounded-lg bg-background p-6">
      <ColorSchemePicker {...args} />
    </div>
  ),
};

/** On a phone: the picker keeps its own width; the chart fills the screen. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => <PickerWithChart {...args} />,
};

/** The picker (a ui-sdk part) and a Bklit chart, side by side: both follow one switch. */
export const WithChart: Story = {
  render: (args) => <PickerWithChart {...args} />,
};
