import type { Meta, StoryObj } from "@storybook/react-vite";

import { MONTHLY_SPENDING } from "../stories/made-up";
import { BarChart, BarChartSkeleton } from "./bar-chart";

const SIX_MONTHS = MONTHLY_SPENDING.map((month) => ({ date: month.date, amount: month.spent }));

/**
 * One bar per month, in `--chart-1` on `--chart-grid`: the spending of the last six months, say.
 * Amounts come in integer minor units with their currency; the bars are drawn in major units and
 * every text formats the minor ones. Months are named in the page's language.
 *
 * States: loading (`BarChartSkeleton`, the same height), no month yet (a message in the chart's
 * frame), a single month, a phone.
 *
 * Motion: Bklit's bars grow in one after the other on arrival (about 1.1 s); hovering, a
 * crosshair marks the bar under the pointer and the tooltip's amount rolls to its value (200 ms,
 * ease-out). Under reduced motion the bars stand at once and the amount changes without rolling.
 * No keyboard access: Bklit's charts follow the pointer only; the figure is named by `label`.
 *
 * Don't: mix currencies in one chart; use it for a breakdown by category (that is a list with
 * bars, not a chart); give it floats.
 */
const meta = {
  title: "Charts/Bar chart",
  component: BarChart,
  args: {
    months: SIX_MONTHS,
    label: "Spending of the last six months",
    valueLabel: "Spent",
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl rounded-xl border bg-card p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BarChart>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Six months, oldest first. */
export const Default: Story = {};

/** A single month: one bar. */
export const SingleMonth: Story = { args: { months: SIX_MONTHS.slice(-1) } };

/** No month yet: the chart's frame keeps its size and says so. */
export const Empty: Story = { args: { months: [] } };

/** On its way: the skeleton, shaped like the chart. */
export const Loading: Story = { render: () => <BarChartSkeleton /> };

/** The skeleton above the loaded chart: the same height, so nothing jumps when data comes. */
export const LoadingBesideLoaded: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div data-testid="skeleton">
        <BarChartSkeleton />
      </div>
      <div data-testid="loaded">
        <BarChart {...args} />
      </div>
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
