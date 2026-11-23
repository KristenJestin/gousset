import { useHydrated } from "../hooks/use-hydrated";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { BalanceDay, BalanceRow } from "../lib/chart-amounts";
import { balanceRows, formatChartDay } from "../lib/chart-amounts";
import { formatMoney } from "../lib/money";
import { duration } from "../lib/motion";
import { Grid } from "./charts/grid";
import { Line } from "./charts/line";
import { LineChart } from "./charts/line-chart";
import { ChartTooltip } from "./charts/tooltip/chart-tooltip";
import { XAxis } from "./charts/x-axis";
import { Amount } from "./amount";
import { ChartFigures, ChartFiguresSkeleton } from "./chart-figures";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type { BalanceDay } from "../lib/chart-amounts";

export type BalanceChartProps = {
  /** One point per day, in integer minor units; negative for a loan. */
  days: ReadonlyArray<BalanceDay>;
  currency: string;
  /** What the chart shows, for assistive technology: "The current account's balance over time". */
  label: string;
  /** What the line holds, in the tooltip: "Balance". */
  valueLabel: string;
};

const MARGIN = { top: 16, right: 16, bottom: 32, left: 16 };

function BalanceTooltip({
  row,
  currency,
  locale,
  valueLabel,
}: {
  row: BalanceRow;
  currency: string;
  locale: string;
  valueLabel: string;
}) {
  const money = { minor: row.minor, currency };

  return (
    <div data-slot="balance-tooltip" className="flex min-w-40 flex-col gap-1 px-3 py-2 text-sm">
      <span className="text-xs text-chart-tooltip-muted">
        {formatChartDay(row.date, locale, "UTC")}
      </span>
      <div className="flex items-center justify-between gap-6">
        <span className="text-chart-tooltip-muted">{valueLabel}</span>
        <span className="font-medium text-chart-tooltip-foreground tabular-nums">
          <span className="sr-only">{formatMoney(money, { locale })}</span>
          {/* `Amount` rolls its digits without injecting a style (NumberFlow does, which the CSP forbids). */}
          <span aria-hidden="true">
            <Amount value={money} locale={locale} size="sm" />
          </span>
        </span>
      </div>
    </div>
  );
}

/** The chart's frame when there is nothing to draw: the same size, a short message. */
function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex aspect-2/1 w-full items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/**
 * An account's balance day by day (docs/wireframes, screen 7, block 3): Bklit's line chart, a
 * crosshair on hover and a sober tooltip whose amount rolls. A loan's balance, negative, draws
 * below zero (Bklit's y-domain pads a negative minimum, no special casing needed here).
 *
 * Drawn once the page has hydrated: Bklit sizes its frame with `style` attributes, which the
 * Content Security Policy drops from the server's markup. Until then, a blank frame of the same
 * size holds its place.
 */
export function BalanceChart({ days, currency, label, valueLabel }: BalanceChartProps) {
  const messages = useUiMessages();
  const locale = messages.charts.locale;
  const rows = balanceRows(days, currency);
  const hydrated = useHydrated();

  return (
    <figure aria-label={label} data-slot="balance-chart" className="flex w-full flex-col gap-3">
      {rows.length === 0 ? (
        <EmptyChart message={messages.charts.empty} />
      ) : !hydrated ? (
        <div className="aspect-2/1 w-full" />
      ) : (
        <LineChart
          data={rows}
          margin={MARGIN}
          // The design's longest motion (300 ms), not Bklit's 1.1 s; reduced motion skips it
          // (`followReducedMotion`).
          animationDuration={duration.slow * 1000}
        >
          <Grid />
          <Line
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fadeEdges={false}
            showMarkers={rows.length === 1}
          />
          <XAxis labels={rows.map((row) => formatChartDay(row.date, locale, "UTC"))} />
          <ChartTooltip
            showCrosshair
            showDatePill={false}
            content={({ index }) => {
              const row = rows[index];

              return row === undefined ? null : (
                <BalanceTooltip
                  row={row}
                  currency={currency}
                  locale={locale}
                  valueLabel={valueLabel}
                />
              );
            }}
          />
        </LineChart>
      )}
      {rows.length === 0 ? null : (
        <ChartFigures
          caption={label}
          columns={[messages.charts.day, valueLabel]}
          rows={rows.map((row) => ({
            key: row.date.toISOString(),
            cells: [
              formatChartDay(row.date, locale, "UTC"),
              formatMoney({ minor: row.minor, currency }, { locale }),
            ],
          }))}
        />
      )}
    </figure>
  );
}

/** The balance chart on its way: the legend's place and the chart's, at the same height. */
export function BalanceChartSkeleton() {
  return (
    <SkeletonFrame>
      <div data-slot="balance-chart-skeleton" className="flex w-full flex-col gap-3">
        <Skeleton className="aspect-2/1 w-full" />
        <ChartFiguresSkeleton />
      </div>
    </SkeletonFrame>
  );
}
