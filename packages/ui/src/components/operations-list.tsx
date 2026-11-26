import { createVirtualizer } from "@ui-sdk/core";
import type { VirtualItem } from "@ui-sdk/core";
import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import type { Variants } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { transition } from "../lib/motion";
import { asksNextPage, rowsMark } from "../lib/next-page";
import { paletteText } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { cn } from "../lib/utils";
import { Amount, AmountSkeleton } from "./amount";
import { Chip } from "./chip";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import type { CategoryIconName } from "./icons";
import { Loader } from "./loader";
import { Skeleton, SkeletonFrame } from "./skeleton";

export type OperationRow = {
  id: string;
  /** Already worded ("21 Oct."). */
  day: string;
  /** The statement line's raw label, as imported. */
  label: string;
  /** The account's name, already worded. */
  account: string;
  amount: Money;
  /** Held for review: a "To review" chip beside the label. */
  toReview?: boolean;
  /** Its category's name, already worded ("Food › Groceries"); shown with `withCategory`. */
  category?: string;
  /** Its category's icon (none: `other`'s), shown before its name in its colour (#205). */
  categoryIcon?: CategoryIconName | null;
  /** The colour its category is shown in; none: the muted text's. */
  categoryColor?: PaletteColor | null;
  /**
   * Maybe a refund (#208), no income until the user answers: a "Maybe a refund" chip beside the
   * label, and no category, which would read as an income of it.
   */
  maybeRefund?: boolean;
};

export type OperationsListProps = {
  /** The lines loaded so far, newest first, as the page orders them. */
  rows: ReadonlyArray<OperationRow>;
  /** How many lines match in all, loaded or not: each row's `aria-setsize`. */
  total: number;
  /** Runs once the rows shown come near the last loaded one: load the next page. */
  onEnd?: () => void;
  /** While the next page loads: a line under the rows says so. */
  loadingMore?: boolean;
  /** The line whose detail is open: its row is marked, kept rendered and scrolled into view. */
  openId?: string;
  onOpen: (id: string) => void;
  /** What the list is, for screen readers ("Operations"). */
  label: string;
  /** The page's words when nothing matches; a general sentence otherwise. */
  emptyText?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
  /** A "Category" column, on a wide screen, with each row's `category`. */
  withCategory?: boolean;
  /**
   * The line that leaves the rows because it was just reviewed (#35): as it goes, it folds away
   * (its height to 0) rather than fade. Give it before, or with, the rows without it.
   */
  foldingId?: string;
};

/** Every row's height, in pixels: `h-12`. The virtualiser places rows by it. */
const ROW_HEIGHT = 48;

/**
 * How many rows the server writes, in the flow, before the list takes over in the browser: enough
 * for a tall screen (24 × 48 px), few enough that the first paint stays light.
 */
const FIRST_PAINT_ROWS = 24;

/** How a row leaves: with a change of the rows or not, and the row reviewed, which folds. */
type Leaving = { fading: boolean; foldingId: string | undefined };

// A row that comes with a change of the rows fades in, one that goes fades out; a row that enters
// or leaves the window by scrolling comes and goes at once (`custom` says which). The row just
// reviewed folds away: its height to 0, in 200 ms, ease-out. Each row's own, to know it is that one.
const rowMotion = (id: string) =>
  ({
    hidden: { opacity: 0 },
    shown: { opacity: 1 },
    gone: ({ fading, foldingId }: Leaving) =>
      foldingId === id
        ? { height: 0, opacity: 0, transition: transition.base }
        : fading
          ? { opacity: 0 }
          : { opacity: 0, transition: { duration: 0 } },
  }) satisfies Variants;

type Followed = Pick<OperationsListProps, "rows" | "total" | "openId" | "onEnd">;

/**
 * The virtualiser and what it reads when it runs, outside React's render: the latest rows, the
 * open line and the focused one. Made once per list; `follow` gives it each render's props.
 */
function rowWindow(first: Followed) {
  let props = first;
  let focusedId: string | null = null;
  // The rows the list last asked the next page for (`rowsMark`).
  let askedFor: string | null = null;
  const none: Array<VirtualItem> = [];

  const indexOf = (id: string | null | undefined) =>
    id === null || id === undefined ? -1 : props.rows.findIndex((row) => row.id === id);

  // The open line and the focused one stay in the page wherever the list is scrolled: the detail
  // gives the focus back to its row, and the focus never falls to the page.
  const kept = () => [indexOf(props.openId), indexOf(focusedId)].filter((index) => index >= 0);

  // Not the virtualiser's `onEnd`, which asks once per row count for good: the list's rows are
  // replaced, not only lengthened, and a new search with as many rows must ask again
  // (`asksNextPage`). The list stays mounted across searches so that its rows slide.
  const virtual = createVirtualizer({
    count: () => props.rows.length,
    estimate: () => ROW_HEIGHT,
    key: (index) => props.rows[index]?.id ?? String(index),
    keep: kept,
  });

  const askIfNearEnd = () => {
    const keep = new Set(kept());
    const lastShown = virtual.items().findLast((item) => !keep.has(item.index))?.index ?? -1;
    const mark = rowsMark(props.rows, props.total);

    if (asksNextPage(lastShown, props.rows.length, mark, askedFor)) {
      askedFor = mark;
      // Out of the virtualiser's update and React's commit, as the virtualiser's own does.
      queueMicrotask(() => props.onEnd?.());
    }
  };

  virtual.subscribe(askIfNearEnd);

  return {
    virtual,
    subscribe: (listener: () => void) => virtual.subscribe(listener),
    items: () => virtual.items(),
    /** On the server and while hydrating: the list is drawn in the flow, not by the window. */
    none: () => none,
    connect: (scroller: HTMLElement) => {
      const disconnect = virtual.connect(scroller);

      askIfNearEnd();

      return disconnect;
    },
    follow: (next: Followed) => {
      props = next;
      virtual.refresh();
      askIfNearEnd();
    },
    focus: (id: string | null) => {
      focusedId = id;
    },
  };
}

const COLUMN = {
  day: "w-16 shrink-0",
  line: "flex min-w-0 flex-1 items-center gap-2",
  // Shown while the list has room for them: a narrow list (a phone, a small window) gives them up,
  // the category first, never the amounts.
  account: "hidden w-40 shrink-0 truncate @xl:block",
  category: "hidden w-40 shrink-0 truncate @3xl:flex",
  amount: "flex w-28 shrink-0 justify-end",
};

/**
 * The operations (docs/wireframes, screen 2, block 2): every statement line, newest first, one row
 * each: its day, its raw label (with a "To review" chip on a held line, a "Maybe a refund" one on a
 * line that may be a refund, whose category it leaves out), its category
 * (`withCategory`), its account and its amount, coloured by its direction: money in in `--amount-in` with a plus, money out in the text's
 * colour with a minus. A row opens the line (`onOpen`), by press or keyboard. Virtualised with ui-sdk's
 * `createVirtualizer`: only the rows in view (and a few around) are in the page, each 48 px, in a
 * scroller of its own that fills its parent's height; `onEnd` asks for the next page.
 *
 * Server rendering: the first paint carries its data, and the Content Security Policy forbids
 * `style` attributes in the server's markup. So the server (and the hydration) writes the first
 * rows in the flow, with no position of their own; once hydrated, the same rows are placed by the
 * virtualiser, their `top` set from script (which the policy allows), where they already stood.
 *
 * Motion: when the rows change (a new search, a filter), the rows that stay slide to their new
 * place (a layout move, by transform), new ones fade in and gone ones fade out, in 200 ms
 * (ease-out). Rows that enter or leave the view by scrolling neither fade nor slide. The line just
 * reviewed (`foldingId`) folds away instead: its height to 0 in 200 ms, ease-out, as the rows
 * under it slide up. Cut under reduced motion. When nothing matches, the rows that were there fade
 * out over the empty state. A row's chips have no motion of their own: they come and go with it.
 * A line answered (#208) loses its "Maybe a refund" chip at once, when the list is read again.
 *
 * The account column shows while the list is at least 576 px wide, the category column while it
 * is at least 768 px wide (container queries): a narrower list gives them up, never the amounts.
 * An open line's detail is a sheet over the list (#182), which keeps its width.
 */
export function OperationsList({
  rows,
  total,
  onEnd,
  loadingMore,
  openId,
  onOpen,
  label,
  emptyText,
  locale,
  withCategory = false,
  foldingId,
}: OperationsListProps) {
  const messages = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const hydrated = useHydrated();
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLUListElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const lastOpen = useRef<string | undefined>(undefined);
  const [shown] = useState(() => rowWindow({ rows, total, openId, onEnd }));
  const virtual = shown.virtual;
  const items = useSyncExternalStore(shown.subscribe, shown.items, shown.none);

  // The rows before the last change, until the list is scrolled: a row missing from them fades in
  // when it mounts. A row mounted by scrolling never does.
  const [change, setChange] = useState<{
    rows: ReadonlyArray<OperationRow>;
    before: ReadonlySet<string> | null;
  }>({ rows, before: null });

  if (change.rows !== rows) {
    setChange({ rows, before: new Set(change.rows.map((row) => row.id)) });
  }

  const fading = change.before !== null;
  const leaving: Leaving = { fading, foldingId };

  useLayoutEffect(() => {
    shown.follow({ rows, total, openId, onEnd });

    if (box.current !== null) {
      box.current.style.height = `${virtual.size()}px`;
    }
  });

  useLayoutEffect(() => {
    if (!hydrated || scroller.current === null) {
      return;
    }

    return shown.connect(scroller.current);
  }, [hydrated, shown]);

  // Opening a line brings its row into view (once: a page loaded later leaves the scroll alone);
  // closing gives the focus back to it.
  useEffect(() => {
    if (openId !== undefined && openId !== lastOpen.current) {
      virtual.scrollToIndex(rows.findIndex((row) => row.id === openId));
    } else if (openId === undefined && lastOpen.current !== undefined) {
      buttons.current.get(lastOpen.current)?.focus();
    }

    lastOpen.current = openId;
  }, [openId, rows, virtual]);

  const rowButton = (row: OperationRow) => (
    <RowButton
      row={row}
      open={row.id === openId}
      withCategory={withCategory}
      locale={writtenIn}
      onOpen={onOpen}
      onFocusChange={(focused) => shown.focus(focused ? row.id : null)}
      register={(button) => {
        if (button === null) {
          buttons.current.delete(row.id);
        } else {
          buttons.current.set(row.id, button);
        }
      }}
    />
  );

  return (
    <LazyMotion features={domMax}>
      <div data-slot="operations-list" className="@container flex h-full min-h-0 flex-col">
        <ColumnTitles withCategory={withCategory} />
        <m.div
          ref={scroller}
          layoutScroll
          data-slot="operations-scroller"
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onScroll={() => {
            if (change.before !== null) {
              setChange({ rows, before: null });
            }
          }}
        >
          {/* One list and one `AnimatePresence` from the server's first paint on, so that a row that
              goes always fades out, even the last one. */}
          <ul ref={box} aria-label={label} className="relative">
            <AnimatePresence initial={false} custom={leaving}>
              {hydrated
                ? items.map((item) => {
                    const row = rows[item.index];

                    return row === undefined ? null : (
                      <PlacedRow
                        key={row.id}
                        id={row.id}
                        start={item.start}
                        leaving={leaving}
                        fadesIn={change.before !== null && !change.before.has(row.id)}
                        total={total}
                        position={item.index + 1}
                      >
                        {rowButton(row)}
                      </PlacedRow>
                    );
                  })
                : // The server's rows, in the flow, with no `style` attribute (see above).
                  rows.slice(0, FIRST_PAINT_ROWS).map((row, index) => (
                    <li
                      key={row.id}
                      aria-setsize={total}
                      aria-posinset={index + 1}
                      data-slot="operation-row"
                      className="h-12 border-b bg-card"
                    >
                      {rowButton(row)}
                    </li>
                  ))}
            </AnimatePresence>
          </ul>
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState title={emptyText ?? messages.empty} />
            </div>
          ) : null}
          {loadingMore === true ? (
            <p
              role="status"
              className="flex h-12 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader size="md" />
              {messages.loadingMore}
            </p>
          ) : null}
        </m.div>
      </div>
    </LazyMotion>
  );
}

/**
 * A row of the hydrated list, placed at `start` from script, never by a `style` attribute (see
 * `OperationsList`). A layout effect rather than a ref callback: Motion calls an `m.li`'s ref once,
 * at mount, so a row that stays through a change of the rows would keep its old place. Set in the
 * commit, the new place is what Motion measures after it, against the one it read before: the row
 * slides from there (`layout="position"`, by transform).
 */
function PlacedRow({
  id,
  start,
  leaving,
  fadesIn,
  total,
  position,
  children,
}: {
  id: string;
  start: number;
  leaving: Leaving;
  /** Came with a change of the rows, not by scrolling. */
  fadesIn: boolean;
  total: number;
  position: number;
  children: ReactNode;
}) {
  const element = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    if (element.current !== null) {
      element.current.style.top = `${start}px`;
    }
  }, [start]);

  return (
    <m.li
      ref={element}
      layout="position"
      variants={rowMotion(id)}
      custom={leaving}
      initial={fadesIn ? "hidden" : false}
      animate="shown"
      exit="gone"
      transition={transition.base}
      aria-setsize={total}
      aria-posinset={position}
      data-slot="operation-row"
      // Hidden overflow: a row folding away takes its content with it.
      className="absolute inset-x-0 h-12 overflow-hidden border-b bg-card"
    >
      {children}
    </m.li>
  );
}

/** The columns' names over the rows; the rows say their own text, so it is only drawn. */
function ColumnTitles({ withCategory }: { withCategory: boolean }) {
  const columns = useUiMessages().operations.columns;

  return (
    <div
      aria-hidden="true"
      className="flex h-9 shrink-0 items-center gap-3 border-b px-3 text-xs font-medium text-muted-foreground"
    >
      <span className={COLUMN.day}>{columns.day}</span>
      <span className={COLUMN.line}>{columns.label}</span>
      {withCategory ? <span className={COLUMN.category}>{columns.category}</span> : null}
      <span className={COLUMN.account}>{columns.account}</span>
      <span className={COLUMN.amount}>{columns.amount}</span>
    </div>
  );
}

function RowButton({
  row,
  open,
  withCategory,
  locale,
  onOpen,
  onFocusChange,
  register,
}: {
  row: OperationRow;
  open: boolean;
  withCategory: boolean;
  locale: string;
  onOpen: (id: string) => void;
  onFocusChange: (focused: boolean) => void;
  register: (button: HTMLButtonElement | null) => void;
}) {
  const messages = useUiMessages().operations;

  return (
    <button
      ref={register}
      type="button"
      aria-current={open ? "true" : undefined}
      data-open={open ? "" : undefined}
      className={cn(
        "relative flex h-full w-full cursor-pointer items-center gap-3 px-3 text-left text-sm outline-none",
        "transition-colors duration-150 ease-out hover:bg-muted data-open:bg-muted",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
      )}
      onClick={() => onOpen(row.id)}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
    >
      <span className={cn(COLUMN.day, "text-muted-foreground tabular-nums")}>{row.day}</span>
      <span className={COLUMN.line}>
        <span className="truncate">{row.label}</span>
        {row.toReview === true ? (
          // The label gives way, never the chip: a narrow row truncates the label alone.
          <span className="flex shrink-0">
            <Chip>{messages.toReview}</Chip>
          </span>
        ) : null}
        {row.maybeRefund === true ? (
          <span data-slot="maybe-refund" className="flex shrink-0">
            <Chip>{messages.maybeRefund}</Chip>
          </span>
        ) : null}
      </span>
      {withCategory ? (
        <span className={cn(COLUMN.category, "items-center gap-1.5 text-muted-foreground")}>
          {row.category === undefined || row.maybeRefund === true ? null : (
            <span
              data-slot="operation-category-icon"
              data-icon={row.categoryIcon ?? "other"}
              data-color={row.categoryColor ?? undefined}
              className={cn(
                "flex shrink-0",
                row.categoryColor === undefined || row.categoryColor === null
                  ? undefined
                  : paletteText[row.categoryColor],
              )}
            >
              <Icon name={row.categoryIcon ?? "other"} size="sm" />
            </span>
          )}
          <span className="truncate">{row.maybeRefund === true ? null : row.category}</span>
        </span>
      ) : null}
      <span className={cn(COLUMN.account, "text-muted-foreground")}>{row.account}</span>
      <span className={COLUMN.amount}>
        {/* Money in is green with its plus, money out keeps the text's colour with its minus: the
            sign is always written, so the direction reads without the colour. */}
        <Amount
          value={row.amount}
          size="sm"
          roll={false}
          locale={locale}
          sign={row.amount.minor > 0 ? "always" : "auto"}
          tone={row.amount.minor > 0 ? "in" : "neutral"}
        />
      </span>
    </button>
  );
}

/** `OperationsList` on its way: its column titles and `rows` rows, at the same heights. */
export function OperationsListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="@container flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3">
          <Skeleton className="h-3 w-10" />
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
            <span className={COLUMN.day}>
              <Skeleton className="h-3.5 w-12" />
            </span>
            <span className={COLUMN.line}>
              <Skeleton className="h-3.5 w-48 max-w-full" />
            </span>
            <span className={COLUMN.account}>
              <Skeleton className="h-3.5 w-24" />
            </span>
            <span className={COLUMN.amount}>
              <AmountSkeleton size="sm" />
            </span>
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
