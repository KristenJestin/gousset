import type { Meta, StoryObj } from "@storybook/react-vite";

import { Grid } from "@gousset/ui/components/charts/grid";
import { Line } from "@gousset/ui/components/charts/line";
import { LineChart } from "@gousset/ui/components/charts/line-chart";
import { XAxis } from "@gousset/ui/components/charts/x-axis";
import { ColorSchemePicker } from "@gousset/ui/components/color-scheme-picker";

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

/** The picker (a ui-sdk part) and a Bklit chart, side by side: both follow one switch. */
export const WithChart: Story = {
  render: (args) => (
    <div className="flex max-w-2xl flex-col gap-6 rounded-lg border bg-card p-6">
      <ColorSchemePicker {...args} />
      <div data-testid="chart">
        <LineChart data={MONTHS}>
          <Grid />
          <Line dataKey="spent" stroke="var(--chart-1)" />
          <Line dataKey="income" stroke="var(--chart-4)" />
          <XAxis />
        </LineChart>
      </div>
    </div>
  ),
};
