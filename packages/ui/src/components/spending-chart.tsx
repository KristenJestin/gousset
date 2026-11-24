import { curveMonotoneX } from "d3-shape";

import { useHydrated } from "../hooks/use-hydrated";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { SpendingDay, SpendingRow } from "../lib/chart-amounts";
import { formatChartDay, spendingRows } from "../lib/chart-amounts";
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

export type { SpendingDay } from "../lib/chart-amounts";

export type SpendingChartProps = {
  /**
   * Cumulative spending day by day, in integer minor units of `currency`: `current` for the
   * period on screen (`null` after today), `previous` for the one before.
   */
  days: ReadonlyArray<SpendingDay>;
  currency: string;
  /** What the chart shows, for assistive technology: "Spending in October, against September". */
  label: string;
  /** The period on screen, in the legend and the tooltip: "October". */
  currentLabel: string;
  /** The period before, drawn dashed: "September". */
  previousLabel: string;
};

const MARGIN = { top: 16, right: 16, bottom: 32, left: 16 };

function LegendItem({ label, dashed }: { label: string; dashed: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" width="16" height="2" className="overflow-visible">
        <line
          x1="0"
          x2="16"
          y1="1"
          y2="1"
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
          className={dashed ? "stroke-chart-5" : "stroke-chart-1"}
        />
      </svg>
      {label}
    </li>
  );
}

function Legend({ currentLabel, previousLabel }: { currentLabel: string; previousLabel: string }) {
  return (
    <ul className="flex h-5 items-center gap-4 text-xs text-muted-foreground">
      <LegendItem label={currentLabel} dashed={false} />
      <LegendItem label={previousLabel} dashed />
    </ul>
  );
}

/** One line of the tooltip: the period's name and its amount, whose digits roll as it changes. */
function TooltipAmount({
  label,
  minor,
  currency,
  locale,
}: {
  label: string;
  minor: number;
  currency: string;
  locale: string;
}) {
  const money = { minor, currency };

  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-chart-tooltip-muted">{label}</span>
      <span className="font-medium text-chart-tooltip-foreground tabular-nums">
        <span className="sr-only">{formatMoney(money, { locale })}</span>
        {/* `Amount` rolls its digits without injecting a style (NumberFlow does, which the CSP forbids). */}
        <span aria-hidden="true">
          <Amount value={money} locale={locale} size="sm" />
        </span>
      </span>
    </div>
  );
}

function SpendingTooltip({
  row,
  currency,
  locale,
  currentLabel,
  previousLabel,
}: {
  row: SpendingRow;
  currency: string;
  locale: string;
  currentLabel: string;
  previousLabel: string;
}) {
  return (
    <div data-slot="spending-tooltip" className="flex min-w-44 flex-col gap-1 px-3 py-2 text-sm">
      <span className="text-xs text-chart-tooltip-muted">{formatChartDay(row.date, locale)}</span>
      <TooltipAmount
        label={currentLabel}
        minor={row.currentMinor}
        currency={currency}
        locale={locale}
      />
      <TooltipAmount
        label={previousLabel}
        minor={row.previousMinor}
        currency={currency}
        locale={locale}
      />
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
 * This period's cumulative spending day by day, against the period before, dashed: Bklit's line
 * chart with a crosshair that follows the pointer and a sober tooltip whose amounts roll.
 *
 * Drawn once the page has hydrated: Bklit sizes its frame with `style` attributes, which the
 * Content Security Policy drops from the server's markup. Until then, a blank frame of the same
 * size holds its place.
 */
export function SpendingChart({
  days,
  currency,
  label,
  currentLabel,
  previousLabel,
}: SpendingChartProps) {
  const messages = useUiMessages();
  const locale = messages.charts.locale;
  const rows = spendingRows(days, currency);
  const hydrated = useHydrated();

  return (
    <figure aria-label={label} data-slot="spending-chart" className="flex w-full flex-col gap-3">
      <Legend currentLabel={currentLabel} previousLabel={previousLabel} />
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
          {/* A running total never goes down: a monotone curve cannot dip between two days, where
              Bklit's default (natural) overshoots. */}
          <Line
            dataKey="previous"
            curve={curveMonotoneX}
            stroke="var(--chart-5)"
            strokeWidth={1.5}
            dashFromIndex={0}
            dashArray="5,4"
            fadeEdges={false}
            showHighlight={false}
          />
          <Line
            dataKey="current"
            curve={curveMonotoneX}
            stroke="var(--chart-1)"
            strokeWidth={2}
            fadeEdges={false}
            showMarkers={rows.length === 1}
          />
          <XAxis labels={rows.map((row) => formatChartDay(row.date, locale))} />
          <ChartTooltip
            showDatePill={false}
            content={({ index }) => {
              const row = rows[index];

              return row === undefined ? null : (
                <SpendingTooltip
                  row={row}
                  currency={currency}
                  locale={locale}
                  currentLabel={currentLabel}
                  previousLabel={previousLabel}
                />
              );
            }}
          />
        </LineChart>
      )}
      {rows.length === 0 ? null : (
        <ChartFigures
          caption={label}
          columns={[messages.charts.day, currentLabel, previousLabel]}
          rows={rows.map((row) => ({
            key: row.date.toISOString(),
            cells: [
              formatChartDay(row.date, locale),
              formatMoney({ minor: row.currentMinor, currency }, { locale }),
              formatMoney({ minor: row.previousMinor, currency }, { locale }),
            ],
          }))}
        />
      )}
    </figure>
  );
}

/** The spending chart on its way: the legend's place and the chart's, at the same height. */
export function SpendingChartSkeleton() {
  return (
    <SkeletonFrame>
      <div data-slot="spending-chart-skeleton" className="flex w-full flex-col gap-3">
        <div className="flex h-5 items-center gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="aspect-2/1 w-full" />
        <ChartFiguresSkeleton />
      </div>
    </SkeletonFrame>
  );
}
