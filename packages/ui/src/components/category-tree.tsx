import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { staggerDelay } from "../lib/stagger";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { IconButton } from "./icon-button";
import { Menu } from "./menu";
import { Skeleton, SkeletonFrame } from "./skeleton";

// The categories of the settings (docs/wireframes, screen 10, block 1): two levels, each row with
// its six-month average, its benchmark, its lines and its menu. Rows are flex rows, as the other
// lists of packages/ui; the column titles are only drawn, each row saying its own text.

export type CategoryTreeRow = {
  id: string;
  /** Its name; in a flat list (archived ones), its path, "Food › Groceries". */
  name: string;
  /** A child: indented under its parent, which comes just before it. */
  child?: boolean;
  /** Its monthly average over six months, one figure per currency; none when it had no line. */
  average: ReadonlyArray<Money>;
  /** Its benchmark, worded by the page: "automatic · €690", "set · €130", "none". */
  benchmark: string;
  /** A benchmark the user set: it stands out. */
  benchmarkSet?: boolean;
  /** How many lines it holds, whenever they happened. */
  entries: number;
  /** The `MenuItem`s of its ⋮ menu. */
  actions: ReactNode;
  /** Slides in from the side instead of fading in with the rest: a category just added. */
  justCreated?: boolean;
};

export type CategoryTreeProps = {
  /** What the list is, for screen readers ("Expense categories"). */
  label: string;
  rows: ReadonlyArray<CategoryTreeRow>;
  /** The page's words when there is no row. */
  emptyText: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/** One number format per language, built once. */
const counts = new Map<string, Intl.NumberFormat>();

function countFormat(locale: string): Intl.NumberFormat {
  const known = counts.get(locale);

  if (known !== undefined) {
    return known;
  }

  const made = new Intl.NumberFormat(locale);

  counts.set(locale, made);

  return made;
}

const COLUMN = {
  name: "flex min-w-0 flex-1 items-center",
  average: "flex w-28 shrink-0 flex-col items-end",
  benchmark: "hidden w-40 shrink-0 truncate md:block",
  lines: "w-14 shrink-0 text-right tabular-nums",
  menu: "flex w-8 shrink-0 justify-end",
};

/**
 * A kind's categories on two levels (`child` rows indented under their parent), each with its
 * six-month average (one figure per currency, never converted), its benchmark (one set by the user
 * in bold), its lines and a ⋮ menu of the page's actions ("Actions on Groceries").
 *
 * Motion: rows fade and slide up on first paint (200 ms, ease-out, staggered); a row
 * `justCreated` slides in from the side instead (200 ms). Its menu opens as `Menu` (150 ms). Cut
 * under reduced motion (the page's global rule).
 */
export function CategoryTree({ label, rows, emptyText, locale }: CategoryTreeProps) {
  const messages = useUiMessages().categories;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const count = countFormat(writtenIn);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div data-slot="category-tree" className="flex flex-col">
      <div
        aria-hidden="true"
        className="flex h-9 items-center gap-3 border-b text-xs font-medium text-muted-foreground"
      >
        <span className={COLUMN.name}>{messages.columns.category}</span>
        <span className={COLUMN.average}>{messages.columns.average}</span>
        <span className={COLUMN.benchmark}>{messages.columns.benchmark}</span>
        <span className={COLUMN.lines}>{messages.columns.lines}</span>
        <span className={COLUMN.menu} />
      </div>
      <ul aria-label={label} className="flex flex-col divide-y">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-slot="category-row"
            data-child={row.child === true ? "" : undefined}
            className={cn(
              "flex h-12 items-center gap-3 fill-mode-both duration-200",
              row.justCreated === true
                ? "animate-in slide-in-from-left-2 fade-in"
                : cn("animate-in slide-in-from-bottom-1 fade-in", staggerDelay(index)),
            )}
          >
            <span className={cn(COLUMN.name, row.child === true && "ps-6")}>
              <span
                className={cn(
                  "truncate text-sm",
                  row.child === true ? "text-foreground" : "font-semibold",
                )}
              >
                {row.name}
              </span>
            </span>
            <span className={COLUMN.average}>
              {row.average.length === 0 ? (
                <span className="text-sm text-muted-foreground">{messages.noAverage}</span>
              ) : (
                row.average.map((amount) => (
                  <Amount
                    key={amount.currency}
                    value={amount}
                    whole
                    size="sm"
                    roll={false}
                    locale={writtenIn}
                  />
                ))
              )}
            </span>
            <span
              className={cn(
                COLUMN.benchmark,
                "text-sm",
                row.benchmarkSet === true ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {row.benchmark}
            </span>
            <span className={cn(COLUMN.lines, "text-sm text-muted-foreground")}>
              {count.format(row.entries)}
            </span>
            <span className={COLUMN.menu}>
              <Menu
                trigger={<IconButton icon="more" label={messages.actionsOf(row.name)} size="sm" />}
                align="end"
              >
                {row.actions}
              </Menu>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** `CategoryTree` on its way: its column titles and `rows` rows, at the same heights. */
export function CategoryTreeSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col">
        <div className="flex h-9 items-center border-b">
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex flex-col divide-y">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex h-12 items-center gap-3">
              <span className={cn(COLUMN.name, row % 3 !== 0 && "ps-6")}>
                <Skeleton className="h-3.5 w-32" />
              </span>
              <span className={COLUMN.average}>
                <Skeleton className="h-3.5 w-16" />
              </span>
              <span className={COLUMN.benchmark}>
                <Skeleton className="h-3.5 w-24" />
              </span>
              <span className={COLUMN.lines}>
                <Skeleton className="ms-auto h-3.5 w-8" />
              </span>
              <span className={COLUMN.menu} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  );
}
