import { AnimatePresence } from "motion/react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { Skeleton } from "./skeleton";

export type OperationsLayoutProps = {
  /** `OperationsFilters`. */
  filters: ReactNode;
  /** How many lines match, written "1,234 lines" under the filters; left out while it loads. */
  count?: number;
  /** At the end of the count's line: `ClearFilters`, once a filter is set. */
  countAction?: ReactNode;
  /** `OperationsList`, or `OperationsListSkeleton` while it loads. */
  list: ReactNode;
  /** The open line's `LineDetail` (or `LineDetailSkeleton`); left out when none is open. */
  detail?: ReactNode;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * The operations screen's places (docs/wireframes, screen 2): the filters, the count of lines
 * that match, the list in a block that takes the height left in the screen, with its own
 * scroller, and the open line's detail in a 340 px column at its right; on a narrower screen the
 * detail covers the list, which keeps its place and scroll under it. The whole takes the screen's
 * height (at least 480 px), so that the list scrolls in itself.
 *
 * Motion: the detail leaves inside an `AnimatePresence`, so that it folds back into its row (see
 * `LineDetail`); a new count is said to screen readers. Cut under reduced motion.
 */
export function OperationsLayout({
  filters,
  count,
  countAction,
  list,
  detail,
  locale,
}: OperationsLayoutProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="operations-layout" className="flex h-svh min-h-120 flex-col gap-3">
      {filters}
      <div className="flex h-5 items-center justify-between gap-3">
        <p
          data-slot="operations-count"
          aria-live="polite"
          // The line's own box, whatever it holds (a skeleton, the count): loading moves nothing.
          className="flex h-5 min-w-0 flex-1 items-center text-sm text-muted-foreground"
        >
          {count === undefined ? (
            <Skeleton className="h-3.5 w-20" />
          ) : (
            words.lines(count, formatCount(count, writtenIn))
          )}
        </p>
        {/* A small button on a 20 px line: it overflows the line rather than push the list down. */}
        <div className="-my-1.5 flex shrink-0">{countAction}</div>
      </div>
      <div className="relative flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">{list}</div>
        <AnimatePresence initial={false}>
          {detail === undefined || detail === null ? null : (
            <div
              key="detail"
              data-slot="operations-detail"
              className="flex min-h-0 max-lg:absolute max-lg:inset-0 max-lg:z-10 lg:w-85 lg:shrink-0"
            >
              {detail}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
