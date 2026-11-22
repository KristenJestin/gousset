import type { Meta, StoryObj } from "@storybook/react-vite";

import { DAILY_SPENDING } from "../stories/made-up";
import { SpendingChart, SpendingChartSkeleton } from "./spending-chart";

/** A month already over: every day has its figure (made up from the month before). */
const FULL_MONTH = DAILY_SPENDING.map((day) => ({
  ...day,
  current: day.current ?? day.previous + 9000,
}));

/** No spending yet: the period has started, nothing is in. */
const NOTHING_YET = DAILY_SPENDING.map((day) => ({ ...day, current: null }));

/**
 * This month's cumulative spending, day by day, against the month before drawn dashed
 * (`--chart-1` solid, `--chart-5` dashed, on `--chart-grid`). Amounts come in integer minor
 * units; the chart draws major units and every text formats the minor ones. It stops on the last
 * day this month has: the month before is drawn to the same day.
 *
 * States: loading (`SpendingChartSkeleton`, the same height), nothing spent yet (a message in the
 * chart's frame), a single day (a dot), a month over, a phone.
 *
 * Motion: Bklit's reveal draws the lines from left to right (1.1 s); hovering, a crosshair
 * follows the pointer and the tooltip's amounts roll to the hovered day's (200 ms, ease-out).
 * Under reduced motion the lines are drawn at once and the amounts change without rolling.
 * No keyboard access: Bklit's charts follow the pointer only; the figure is named by `label`.
 *
 * Don't: use it for anything but a running total against the period before; put it inside a
 * block of its own frame (it has none: the page's block is its frame); give it floats.
 */
const meta = {
  title: "Charts/Spending chart",
  component: SpendingChart,
  args: {
    days: DAILY_SPENDING,
    currency: "EUR",
    label: "Spending in October, against September",
    currentLabel: "October",
    previousLabel: "September",
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl rounded-xl border bg-card p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpendingChart>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The month on screen, to the 24th, against the month before. */
export const Default: Story = {};

/** A month already over: both lines run to the end. */
export const MonthOver: Story = { args: { days: FULL_MONTH } };

/** The first day of the month: one point, drawn as a dot. */
export const FirstDay: Story = { args: { days: DAILY_SPENDING.slice(0, 1) } };

/** Nothing spent yet: the chart's frame keeps its size and says so. */
export const Empty: Story = { args: { days: NOTHING_YET } };

/** On its way: the skeleton, shaped like the chart. */
export const Loading: Story = { render: () => <SpendingChartSkeleton /> };

/** The skeleton above the loaded chart: the same height, so nothing jumps when data comes. */
export const LoadingBesideLoaded: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div data-testid="skeleton">
        <SpendingChartSkeleton />
      </div>
      <div data-testid="loaded">
        <SpendingChart {...args} />
      </div>
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
