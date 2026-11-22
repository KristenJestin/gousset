import { useReducedMotion } from "motion/react";

import { useHydrated } from "../hooks/use-hydrated";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { MonthAmount, MonthBar } from "../lib/chart-amounts";
import { monthBars } from "../lib/chart-amounts";
import { formatMoney } from "../lib/money";
import { duration } from "../lib/motion";
import { Bar } from "./charts/bar";
import { BarChart as BklitBarChart } from "./charts/bar-chart";
import { BarXAxis } from "./charts/bar-x-axis";
import { Grid } from "./charts/grid";
import { ChartTooltip } from "./charts/tooltip/chart-tooltip";
import { Amount } from "./amount";
import { ChartFigures, ChartFiguresSkeleton } from "./chart-figures";
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
          {/* `Amount` rolls its digits without injecting a style (NumberFlow does, which the CSP forbids). */}
          <span aria-hidden="true">
            <Amount value={bar.amount} locale={locale} size="sm" />
          </span>
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
 *
 * Drawn once the page has hydrated: Bklit sizes its frame with `style` attributes, which the
 * Content Security Policy drops from the server's markup. Until then, a blank frame of the same
 * size holds its place.
 */
export function BarChart({ months, label, valueLabel }: BarChartProps) {
  const messages = useUiMessages();
  const locale = messages.charts.locale;
  const bars = monthBars(months, locale);
  const hydrated = useHydrated();
  // The design's longest motion (300 ms), not Bklit's 1.1 s; none under reduced motion, where the
  // bars also answer hover at once (Bklit waits for its grow-in to end).
  const reduced = useReducedMotion() === true;

  return (
    <figure aria-label={label} data-slot="bar-chart" className="flex w-full flex-col gap-3">
      {bars.length === 0 ? (
        <EmptyBars message={messages.charts.empty} />
      ) : !hydrated ? (
        <div className="aspect-2/1 w-full" />
      ) : (
        <BklitBarChart
          data={bars}
          margin={MARGIN}
          barGap={0.3}
          animationDuration={reduced ? 0 : duration.slow * 1000}
        >
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
      {bars.length === 0 ? null : (
        <ChartFigures
          caption={label}
          columns={[messages.charts.month, valueLabel]}
          rows={bars.map((bar) => ({
            key: bar.name,
            cells: [bar.name, formatMoney(bar.amount, { locale })],
          }))}
        />
      )}
    </figure>
  );
}

/** The bar chart on its way: the chart's place, at the same height. */
export function BarChartSkeleton() {
  return (
    <SkeletonFrame>
      <div data-slot="bar-chart-skeleton" className="flex w-full flex-col gap-3">
        <Skeleton className="aspect-2/1 w-full" />
        <ChartFiguresSkeleton />
      </div>
    </SkeletonFrame>
  );
}
