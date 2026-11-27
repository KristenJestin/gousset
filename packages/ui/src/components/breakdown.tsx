import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useAnimatedPercent } from "../hooks/use-animated-percent";
import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import { breakdownBars, formatMoney } from "../lib/money";
import type { BreakdownBar, Money } from "../lib/money";
import { transition } from "../lib/motion";
import { paletteFill, paletteText } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Avatar } from "./avatar";
import type { AvatarFace } from "./avatar";
import { Delta } from "./delta";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import type { IconName } from "./icons";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type BreakdownRow = {
  id: string;
  /** The user's name for it: a category, a merchant, a subject. */
  name: string;
  icon?: IconName;
  /**
   * Who it is, by logo or initials (a merchant's, #204), 24 px in place of the icon; a list where a
   * row has one gives every row's icon that room.
   */
  avatar?: AvatarFace;
  /**
   * Its colour (a category's, #205): its icon and its bar are drawn in it. Without one, the icon
   * is muted and the bar is spent's colour.
   */
  color?: PaletteColor | null;
  amount: Money;
  /**
   * The benchmark this month is held against (its 6-month average, or an amount the user set):
   * its mark on the bar, ⚠ once passed by any amount. None, no mark.
   */
  benchmark?: Money;
  /** The benchmark is an amount the user set, not the average: it is read so. */
  benchmarkSet?: boolean;
  /** Its place in a tree (a subject's, #37): 0 at the top; a child's name is indented. */
  depth?: number;
};

/** How far a row's name is indented, by its depth; deeper ones stay at the last step. */
const INDENT = ["", "ps-3", "ps-6", "ps-9"] as const;

export type BreakdownProps = {
  rows: ReadonlyArray<BreakdownRow>;
  /** Show this many rows, then "+ N more". All of them when left out. */
  limit?: number;
  /** A row was chosen (click, or Enter / Space on it). Rows are buttons only with it. */
  onSelect?: (id: string) => void;
  /**
   * Show the rest. With it, "+ N more" becomes a button, "Show the other N": no "more" in its
   * name, which the frame's menu has.
   */
  onMore?: () => void;
  /** What an empty list says, in the page's words; a general sentence when left out. */
  emptyText?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
  /**
   * The row whose detail is open: it becomes the panel, in the list's place, with `detail` under
   * its figures. `null` or left out: the list.
   */
  selectedId?: string | null;
  /** The open row's detail: its chart, say. */
  detail?: ReactNode;
  /** The panel was closed (its button, or Escape): the row goes back to its place. */
  onClose?: () => void;
  /** What the benchmark is, in the panel's comparison: "your 6-month average". */
  benchmarkLabel?: string;
  /** A last grey line under the rows: what the list leaves out ("€86 more waits in the review"). */
  footnote?: string;
};

/** A row's icon, in its colour when it has one; `wide`, the room of an avatar. */
function RowIcon({ row, wide }: { row: BreakdownRow; wide: boolean }) {
  return (
    <span
      data-slot="breakdown-icon"
      data-color={row.color ?? undefined}
      className={cn(
        "flex shrink-0",
        wide ? "size-6 items-center justify-center" : "size-4",
        row.color === undefined || row.color === null
          ? "text-muted-foreground"
          : paletteText[row.color],
      )}
    >
      {row.icon === undefined ? null : <Icon name={row.icon} />}
    </span>
  );
}

function RowBar({ bar, color }: { bar: BreakdownBar; color: PaletteColor | null }) {
  const width = useAnimatedPercent(bar.width);

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
        width={width}
        data-color={color ?? undefined}
        className={color === null ? "fill-money-spent" : paletteFill[color]}
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

/** A row's icon, or its avatar; `wide`, the room of an avatar, which a list with one gives all. */
function RowMark({ row, wide }: { row: BreakdownRow; wide: boolean }) {
  if (row.avatar !== undefined) {
    return (
      <Avatar name={row.avatar.name} src={row.avatar.src} color={row.avatar.color} size="sm" />
    );
  }

  return <RowIcon row={row} wide={wide} />;
}

function RowContent({
  row,
  bar,
  wide,
  locale,
}: {
  row: BreakdownRow;
  bar: BreakdownBar;
  wide: boolean;
  locale: string;
}) {
  const messages = useUiMessages().money;

  return (
    <>
      <RowMark row={row} wide={wide} />
      <span
        className={cn(
          "flex w-28 shrink-0 items-center gap-1 text-sm",
          INDENT[Math.min(row.depth ?? 0, INDENT.length - 1)],
        )}
      >
        <span className="truncate">{row.name}</span>
        {bar.over ? (
          <span className="flex shrink-0 text-destructive" data-slot="breakdown-over">
            <Icon name="warning" size="sm" label={messages.overBenchmark} />
          </span>
        ) : null}
      </span>
      <RowBar bar={bar} color={row.color ?? null} />
      <span className="flex w-20 shrink-0 justify-end">
        <Amount value={row.amount} whole size="sm" locale={locale} />
      </span>
      {row.benchmark === undefined ? null : (
        <span className="sr-only" data-slot="breakdown-benchmark-text">
          {(row.benchmarkSet === true ? messages.benchmarkSet : messages.benchmark)(
            formatMoney(row.benchmark, { locale, whole: true }),
          )}
        </span>
      )}
    </>
  );
}

const ROW_CLASSES = "flex h-full w-full items-center gap-3 text-left";

/** The panel a row becomes (docs/design.md, "Opening a detail"). */
function DetailPanel({
  row,
  layoutId,
  detail,
  onClose,
  benchmarkLabel,
  locale,
}: {
  row: BreakdownRow;
  layoutId: string;
  detail: ReactNode;
  onClose: () => void;
  benchmarkLabel: string | undefined;
  locale: string;
}) {
  const messages = useUiMessages();
  const panel = useRef<HTMLDivElement>(null);

  // The focus goes into the panel when it opens, so that Escape and Tab start there.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <motion.div
      ref={panel}
      layoutId={layoutId}
      transition={transition.slow}
      tabIndex={-1}
      role="group"
      aria-label={row.name}
      data-slot="breakdown-detail"
      className="flex flex-col gap-3 rounded-lg border bg-card p-3 outline-none"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-8 items-center gap-3">
        <RowMark row={row} wide={row.avatar !== undefined} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.name}</span>
        {row.benchmark === undefined || benchmarkLabel === undefined ? null : (
          <Delta
            value={row.amount}
            reference={row.benchmark}
            referenceLabel={benchmarkLabel}
            locale={locale}
          />
        )}
        <Amount value={row.amount} whole size="sm" locale={locale} />
        <IconButton icon="close" label={messages.overlays.close} size="sm" onClick={onClose} />
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...transition.base, delay: 0.1 }}
      >
        {detail}
      </motion.div>
    </motion.div>
  );
}

function More({ count, onMore }: { count: number; onMore: (() => void) | undefined }) {
  const messages = useUiMessages().money;

  return (
    <li className="flex h-10 items-center text-sm text-muted-foreground">
      {onMore === undefined ? (
        messages.moreRows(count)
      ) : (
        <button
          type="button"
          className="-mx-2 flex h-8 cursor-pointer items-center rounded-md px-2 transition-colors duration-150 hover:bg-muted hover:text-foreground"
          onClick={onMore}
        >
          {messages.showOtherRows(count)}
        </button>
      )}
    </li>
  );
}

/**
 * Where the money goes (docs/wireframes, screen 1, block 2): one row per category, merchant or
 * subject, each with its icon (a merchant's logo or initials, `avatar`), its name, a bar on a scale
 * shared by every row, and its amount; a row of a tree (`depth`, the subjects') has its name
 * indented under its parent's. A row with a colour (a category's, #205) draws its icon and its bar
 * in it; spent's colour else.
 * A dark mark on the bar is its benchmark (the 6-month average, or an amount the user set, read as
 * such); ⚠ once it is passed by any amount; no mark without one. Cut after
 * `limit` rows with "+ N more"; a sentence when there is nothing.
 *
 * With `selectedId`, the chosen row becomes a panel in the list's place: its name, its amount
 * against its benchmark, a close button and `detail`. Escape or the button closes it, and the
 * focus goes back to the row.
 *
 * Motion: when the month changes, each bar grows or shrinks to its new length and its benchmark
 * mark slides, in 200 ms (ease-out), and the amounts roll; a row's background fades in 150 ms on
 * hover. Opening a detail, the row grows into the panel (a shared layout, 300 ms, ease-out) while
 * the other rows fade out, and the detail fades in after it; closing, the panel shrinks back into
 * its row. Cut under reduced motion.
 */
export function Breakdown({
  rows,
  limit,
  onSelect,
  onMore,
  emptyText,
  locale,
  selectedId = null,
  detail,
  onClose,
  benchmarkLabel,
  footnote,
}: BreakdownProps) {
  const messages = useUiMessages().money;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const group = useId();
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastOpen = useRef<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId);
  const layoutIdOf = (id: string) => `${group}-${id}`;

  // Closing gives the focus back to the row the panel came from.
  useEffect(() => {
    if (selectedId === null && lastOpen.current !== null) {
      rowButtons.current.get(lastOpen.current)?.focus();
    }

    lastOpen.current = selectedId;
  }, [selectedId]);

  if (rows.length === 0) {
    return (
      <p data-slot="breakdown" className="flex h-10 items-center text-sm text-muted-foreground">
        {emptyText ?? messages.empty}
      </p>
    );
  }

  const bars = breakdownBars(rows);
  const wide = rows.some((row) => row.avatar !== undefined);
  // An open row stays in the list, even past the limit, so that it has a place to go back to.
  const selectedIndex = selected === undefined ? -1 : rows.indexOf(selected);
  const limited = limit === undefined ? rows.length : Math.max(0, limit);
  const shown = Math.max(limited, selectedIndex + 1);
  const hidden = rows.length - Math.min(shown, rows.length);

  const list = (
    <motion.ul
      key="list"
      data-slot="breakdown"
      className="flex flex-col divide-y"
      exit={{ opacity: 0 }}
      transition={transition.fast}
    >
      {rows.slice(0, shown).map((row, index) => {
        const bar = bars[index] ?? { width: 0, mark: null, over: false };

        return (
          <li key={row.id} data-slot="breakdown-row" data-depth={row.depth ?? 0} className="h-10">
            {onSelect === undefined ? (
              <div className={ROW_CLASSES}>
                <RowContent row={row} bar={bar} wide={wide} locale={writtenIn} />
              </div>
            ) : (
              <motion.div
                layoutId={layoutIdOf(row.id)}
                transition={transition.slow}
                className="h-full"
              >
                <button
                  ref={(button) => {
                    if (button === null) {
                      rowButtons.current.delete(row.id);
                    } else {
                      rowButtons.current.set(row.id, button);
                    }
                  }}
                  type="button"
                  aria-expanded={false}
                  className={cn(
                    ROW_CLASSES,
                    "-mx-2 cursor-pointer rounded-md px-2 transition-colors duration-150 hover:bg-muted",
                  )}
                  onClick={() => onSelect(row.id)}
                >
                  <RowContent row={row} bar={bar} wide={wide} locale={writtenIn} />
                </button>
              </motion.div>
            )}
          </li>
        );
      })}
      {hidden > 0 ? <More count={hidden} onMore={onMore} /> : null}
      {footnote === undefined ? null : (
        <li className="flex h-10 items-center text-xs text-muted-foreground">{footnote}</li>
      )}
    </motion.ul>
  );

  return (
    <LayoutGroup id={group}>
      <AnimatePresence initial={false} mode="popLayout">
        {selected === undefined ? (
          list
        ) : (
          <DetailPanel
            key="detail"
            row={selected}
            layoutId={layoutIdOf(selected.id)}
            detail={detail}
            onClose={() => onClose?.()}
            benchmarkLabel={benchmarkLabel}
            locale={writtenIn}
          />
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}

/** What an open row's amount is held against: the average, the month before. */
export type BreakdownComparison = {
  id: string;
  /** What it is, short and seen: "Average", "September". */
  label: string;
  /** Its amount. */
  reference: Money;
  /** What it is in the change's sentence, for screen readers: "your average", "September". */
  referenceLabel: string;
};

export type BreakdownFiguresProps = {
  /** The open row's amount. */
  value: Money;
  comparisons: ReadonlyArray<BreakdownComparison>;
  /** What the figures are, for screen readers: "Groceries against". */
  label: string;
  /** Under the figures: the row's chart. */
  children?: ReactNode;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * The figures of an open row, for the `detail` of a `Breakdown`: one line per reference it is held
 * against (its average, the month before), the reference's amount and the change, its amounts
 * aligned in tabular figures; then `children`, its chart.
 *
 * Motion: none of its own; it fades in with the panel's detail, and its amounts roll when the
 * month changes (`Amount`). Cut under reduced motion.
 */
export function BreakdownFigures({
  value,
  comparisons,
  label,
  children,
  locale,
}: BreakdownFiguresProps) {
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="breakdown-figures" className="flex flex-col gap-3">
      <ul aria-label={label} className="flex flex-col divide-y">
        {comparisons.map((comparison) => (
          <li key={comparison.id} className="flex h-9 items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {comparison.label}
            </span>
            <Amount value={comparison.reference} whole size="sm" locale={writtenIn} />
            <span className="flex w-16 shrink-0 justify-end">
              <Delta
                value={value}
                reference={comparison.reference}
                referenceLabel={comparison.referenceLabel}
                locale={writtenIn}
              />
            </span>
          </li>
        ))}
      </ul>
      {children}
    </div>
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
 * `more`, the "+ N more" line, and with `footnote` the grey last line, at the same heights.
 */
export function BreakdownSkeleton({
  rows = 5,
  more = false,
  footnote = false,
}: {
  rows?: number;
  more?: boolean;
  footnote?: boolean;
}) {
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
        {footnote ? (
          <li className="flex h-10 items-center">
            <Skeleton className="h-3 w-48" />
          </li>
        ) : null}
      </ul>
    </SkeletonFrame>
  );
}
