import { motion } from "motion/react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import { breakdownBars, formatMoney } from "../lib/money";
import type { BreakdownBar, Money } from "../lib/money";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Icon } from "./icon";
import type { IconName } from "./icons";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type BreakdownRow = {
  id: string;
  /** The user's name for it: a category, a merchant, a subject. */
  name: string;
  icon?: IconName;
  amount: Money;
  /** The 6-month average this month is held against: its mark on the bar, ⚠ once passed. */
  benchmark?: Money;
};

export type BreakdownProps = {
  rows: ReadonlyArray<BreakdownRow>;
  /** Show this many rows, then "+ N more". All of them when left out. */
  limit?: number;
  /** A row was chosen (click, or Enter / Space on it). Rows are buttons only with it. */
  onSelect?: (id: string) => void;
  /** "+ N more" was chosen: show the rest. A button only with it. */
  onMore?: () => void;
  /** What an empty list says, in the page's words; a general sentence when left out. */
  emptyText?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

function RowBar({ bar }: { bar: BreakdownBar }) {
  return (
    <svg
      className="h-3 min-w-0 flex-1 overflow-visible"
      aria-hidden="true"
      data-slot="breakdown-bar"
    >
      <rect width="100%" y="2" height="8" rx="4" className="fill-muted" />
      <motion.rect
        data-slot="breakdown-fill"
        y="2"
        height="8"
        rx="4"
        initial={false}
        animate={{ width: `${String(bar.width)}%` }}
        transition={transition.base}
        className="fill-money-spent"
      />
      {bar.mark === null ? null : (
        <motion.rect
          data-slot="breakdown-benchmark"
          y="0"
          width="2"
          height="12"
          initial={false}
          animate={{ attrX: `${String(bar.mark)}%` }}
          transition={transition.base}
          className="fill-foreground"
        />
      )}
    </svg>
  );
}

function RowContent({
  row,
  bar,
  locale,
}: {
  row: BreakdownRow;
  bar: BreakdownBar;
  locale: string;
}) {
  const messages = useUiMessages().money;

  return (
    <>
      <span className="flex size-4 shrink-0 text-muted-foreground">
        {row.icon === undefined ? null : <Icon name={row.icon} />}
      </span>
      <span className="flex w-28 shrink-0 items-center gap-1 text-sm">
        <span className="truncate">{row.name}</span>
        {bar.over ? (
          <span className="flex shrink-0 text-destructive" data-slot="breakdown-over">
            <Icon name="warning" size="sm" label={messages.overBenchmark} />
          </span>
        ) : null}
      </span>
      <RowBar bar={bar} />
      <span className="flex w-20 shrink-0 justify-end">
        <Amount value={row.amount} whole size="sm" locale={locale} />
      </span>
      {row.benchmark === undefined ? null : (
        <span className="sr-only">
          {messages.benchmark(formatMoney(row.benchmark, { locale, whole: true }))}
        </span>
      )}
    </>
  );
}

const ROW_CLASSES = "flex h-full w-full items-center gap-3 text-left";

function More({ count, onMore }: { count: number; onMore: (() => void) | undefined }) {
  const messages = useUiMessages().money;

  return (
    <li className="flex h-10 items-center text-sm text-muted-foreground">
      {onMore === undefined ? (
        messages.moreRows(count)
      ) : (
        <button
          type="button"
          className="-mx-2 cursor-pointer rounded-md px-2 transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onMore}
        >
          {messages.moreRows(count)}
        </button>
      )}
    </li>
  );
}

/**
 * Where the money goes (docs/wireframes, screen 1, block 2): one row per category, merchant or
 * subject, each with its icon, its name, a bar on a scale shared by every row, and its amount.
 * A dark mark on the bar is its benchmark (the 6-month average); ⚠ once it is passed. Cut after
 * `limit` rows with "+ N more"; a sentence when there is nothing.
 *
 * Motion: when the month changes, each bar grows or shrinks to its new length and its benchmark
 * mark slides, in 200 ms (ease-out), and the amounts roll; a row's background fades in 150 ms on
 * hover. Cut under reduced motion.
 */
export function Breakdown({ rows, limit, onSelect, onMore, emptyText, locale }: BreakdownProps) {
  const messages = useUiMessages().money;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  if (rows.length === 0) {
    return (
      <p data-slot="breakdown" className="flex h-10 items-center text-sm text-muted-foreground">
        {emptyText ?? messages.empty}
      </p>
    );
  }

  const bars = breakdownBars(rows);
  const shown = limit === undefined ? rows.length : Math.max(0, limit);
  const hidden = rows.length - Math.min(shown, rows.length);

  return (
    <ul data-slot="breakdown" className="flex flex-col divide-y">
      {rows.slice(0, shown).map((row, index) => {
        const bar = bars[index] ?? { width: 0, mark: null, over: false };

        return (
          <li key={row.id} className="h-10">
            {onSelect === undefined ? (
              <div className={ROW_CLASSES}>
                <RowContent row={row} bar={bar} locale={writtenIn} />
              </div>
            ) : (
              <button
                type="button"
                className={cn(
                  ROW_CLASSES,
                  "-mx-2 cursor-pointer rounded-md px-2 transition-colors duration-150 hover:bg-muted",
                )}
                onClick={() => onSelect(row.id)}
              >
                <RowContent row={row} bar={bar} locale={writtenIn} />
              </button>
            )}
          </li>
        );
      })}
      {hidden > 0 ? <More count={hidden} onMore={onMore} /> : null}
    </ul>
  );
}

function RowSkeleton() {
  return (
    <li className="flex h-10 items-center gap-3">
      <Skeleton className="size-4 shrink-0" />
      <span className="flex w-28 shrink-0">
        <Skeleton className="h-4 w-20" />
      </span>
      <Skeleton className="h-2 min-w-0 flex-1" />
      <span className="flex w-20 shrink-0 justify-end">
        <Skeleton className="h-4 w-14" />
      </span>
    </li>
  );
}

/**
 * `Breakdown` on its way: as many rows as the block will show (five by default) and, with
 * `more`, the "+ N more" line, at the same heights.
 */
export function BreakdownSkeleton({ rows = 5, more = false }: { rows?: number; more?: boolean }) {
  return (
    <SkeletonFrame>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <RowSkeleton key={index} />
        ))}
        {more ? (
          <li className="flex h-10 items-center">
            <Skeleton className="h-4 w-24" />
          </li>
        ) : null}
      </ul>
    </SkeletonFrame>
  );
}
