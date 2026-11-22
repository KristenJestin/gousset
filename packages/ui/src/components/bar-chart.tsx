import NumberFlow from "@number-flow/react";

import { useUiMessages } from "../hooks/use-ui-messages";
import type { MonthAmount, MonthBar } from "../lib/chart-amounts";
import { monthBars, toChartValue } from "../lib/chart-amounts";
import { formatMoney } from "../lib/money";
import { Bar } from "./charts/bar";
import { BarChart as BklitBarChart } from "./charts/bar-chart";
import { BarXAxis } from "./charts/bar-x-axis";
import { Grid } from "./charts/grid";
import { ChartTooltip } from "./charts/tooltip/chart-tooltip";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type { MonthAmount } from "../lib/chart-amounts";

export type BarChartProps = {
  /** One bar per month, oldest first, each amount in integer minor units with its currency. */
  months: ReadonlyArray<MonthAmount>;
  /** What the chart shows, for assistive technology: "Spending of the last six months". */
  label: string;
  /** What a bar holds, in the tooltip: "Spent". */
  valueLabel: string;
};

const MARGIN = { top: 16, right: 16, bottom: 32, left: 16 };

/** The hovered bar's month and amount; the amount's digits roll from one bar to the next. */
function BarTooltip({
  bar,
  valueLabel,
  locale,
}: {
  bar: MonthBar;
  valueLabel: string;
  locale: string;
}) {
  return (
    <div data-slot="bar-tooltip" className="flex min-w-36 flex-col gap-1 px-3 py-2 text-sm">
      <span className="text-xs text-chart-tooltip-muted">{bar.name}</span>
      <div className="flex items-center justify-between gap-6">
        <span className="text-chart-tooltip-muted">{valueLabel}</span>
        <span className="font-medium text-chart-tooltip-foreground tabular-nums">
          <span className="sr-only">{formatMoney(bar.amount, { locale })}</span>
          {/* Major units for NumberFlow; its digits come from Intl, rounded to the currency's. */}
          <NumberFlow
            aria-hidden="true"
            value={toChartValue(bar.amount)}
            locales={locale}
            format={{ style: "currency", currency: bar.amount.currency }}
            transformTiming={{ duration: 200, easing: "ease-out" }}
          />
        </span>
      </div>
    </div>
  );
}

/** The chart's frame when there is nothing to draw: the same size, a short message. */
function EmptyBars({ message }: { message: string }) {
  return (
    <div className="flex aspect-2/1 w-full items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/**
 * One bar per month (spending of the last six months, say): Bklit's bar chart, its bars growing
 * in on arrival, a crosshair on the hovered bar and a sober tooltip whose amount rolls.
 */
export function BarChart({ months, label, valueLabel }: BarChartProps) {
  const messages = useUiMessages();
  const locale = messages.charts.locale;
  const bars = monthBars(months, locale);

  return (
    <figure aria-label={label} data-slot="bar-chart" className="w-full">
      {bars.length === 0 ? (
        <EmptyBars message={messages.charts.empty} />
      ) : (
        <BklitBarChart data={bars} margin={MARGIN} barGap={0.3}>
          <Grid />
          <Bar dataKey="value" fill="var(--chart-1)" lineCap={4} />
          <BarXAxis />
          <ChartTooltip
            showCrosshair
            showDatePill={false}
            content={({ index }) => {
              const bar = bars[index];

              return bar === undefined ? null : (
                <BarTooltip bar={bar} valueLabel={valueLabel} locale={locale} />
              );
            }}
          />
        </BklitBarChart>
      )}
    </figure>
  );
}

/** The bar chart on its way: the chart's place, at the same height. */
export function BarChartSkeleton() {
  return (
    <SkeletonFrame>
      <div data-slot="bar-chart-skeleton" className="w-full">
        <Skeleton className="aspect-2/1 w-full" />
      </div>
    </SkeletonFrame>
  );
}
