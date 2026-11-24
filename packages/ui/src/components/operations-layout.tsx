import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { useLargeScreen } from "../hooks/use-large-screen";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { DetailClosing } from "../lib/detail-closing";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";

export type OperationsLayoutProps = {
  /** `OperationsFilters`. */
  filters: ReactNode;
  /** How many lines match, written "1,234 lines" under the filters; left out while it loads. */
  count?: number;
  /** `OperationsList`, or `OperationsListSkeleton` while it loads. */
  list: ReactNode;
  /** The open line's `LineDetail` (or `LineDetailSkeleton`); left out when none is open. */
  detail?: ReactNode;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * How long a closing detail stays drawn: its content fades out (150 ms), then its column closes
 * (150 ms, from 150 ms on); a phone's sheet goes back down in 200 ms.
 */
const CLOSING_MS = 300;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const shows = (detail: ReactNode) => detail !== undefined && detail !== null;

/**
 * The detail's column beside the list: it widens from nothing to 376 px (a 16 px gap and the
 * 360 px panel, laid out at its full width from the start) and the list narrows with it; closing,
 * it waits for the content to fade, then narrows back to nothing. Its width moves, never a scale.
 * A column the server drew is there from the first paint, still. Below `lg` it never shows: the
 * first paint keeps the list whole (CSS hides it), and once the page knows the screen is narrow
 * (`beside` false) the same elements stand back (`display: contents`) for the detail's sheet.
 * The elements stay the same either way, so that the detail inside keeps its state: a sheet the
 * server meant to show stays still.
 */
function DetailColumn({
  closing,
  beside,
  children,
}: {
  closing: boolean;
  beside: boolean;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  // Opened once the page runs: it widens. Drawn by the server (or while hydrating): it stays.
  const [widens] = useState(hydrated);

  return (
    <div
      data-slot="operations-detail"
      data-closing={closing ? "" : undefined}
      inert={closing}
      className={
        beside
          ? cn(
              "flex min-h-0 w-94 shrink-0 overflow-hidden transition-width duration-300 ease-out",
              "max-lg:hidden",
              widens && "starting:w-0",
              "data-closing:w-0 data-closing:delay-150 data-closing:duration-150 data-closing:ease-in",
            )
          : "contents"
      }
    >
      <div className={beside ? "ml-4 flex min-h-0 w-90 shrink-0" : "contents"}>{children}</div>
    </div>
  );
}

/**
 * The operations screen's places (docs/wireframes, screen 2): the filters, the count of lines
 * that match, the list in a block that takes the height left in the screen, with its own
 * scroller, and the open line's detail. From Tailwind's `lg` on, the detail sits in a 360 px
 * column at the list's right, never over it: the list makes room, its amounts stay whole. Below,
 * the detail is a sheet (`LineDetail` draws it) over the list, which keeps its place and scroll
 * under it. The whole takes the screen's height (at least 480 px), so that the list scrolls in
 * itself.
 *
 * Motion (#128): the detail's column widens from 0 in 300 ms (ease-out) as the list narrows; the
 * detail's content fades in once there is room. Closing, the content fades out first (150 ms),
 * then the column closes (150 ms, ease-in): the closed detail stays drawn meanwhile, and
 * `DetailClosing` tells it so. Below `lg` the sheet rises from its edge and goes back down. A new
 * count is said to screen readers. Cut under reduced motion: the detail is there, or not.
 */
export function OperationsLayout({ filters, count, list, detail, locale }: OperationsLayoutProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const large = useLargeScreen();

  // The detail drawn: the open one, or the last one while it leaves.
  const [kept, setKept] = useState(detail);

  if (shows(detail) && detail !== kept) {
    setKept(detail);
  }

  const closing = !shows(detail) && shows(kept);

  useEffect(() => {
    if (!closing) {
      return;
    }

    const wait = window.matchMedia(REDUCED_MOTION).matches ? 0 : CLOSING_MS;
    const timer = window.setTimeout(() => setKept(undefined), wait);

    return () => window.clearTimeout(timer);
  }, [closing]);

  return (
    <div data-slot="operations-layout" className="flex h-svh min-h-120 flex-col gap-3">
      {filters}
      <p
        data-slot="operations-count"
        aria-live="polite"
        className="flex h-5 items-center text-sm text-muted-foreground"
      >
        {count === undefined ? (
          <Skeleton className="h-3.5 w-20" />
        ) : (
          words.lines(count, formatCount(count, writtenIn))
        )}
      </p>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">{list}</div>
        {shows(kept) ? (
          <DetailClosing value={closing}>
            {/* On every screen, so that the detail keeps its place in the tree when the page
                learns the screen's width: below `lg` the column stands back for the detail's
                sheet, and the server's still sheet stays still. */}
            <DetailColumn closing={closing} beside={large}>
              {kept}
            </DetailColumn>
          </DetailClosing>
        ) : null}
      </div>
    </div>
  );
}
