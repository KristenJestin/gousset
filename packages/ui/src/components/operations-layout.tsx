import { isValidElement, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { formatCount } from "../lib/count";
import { DetailCameWithPage, DetailClosing, DetailSheetClose } from "../lib/detail-closing";
import type { DetailClose } from "../lib/detail-closing";
import { SheetFrame } from "./sheet";
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
  /**
   * The open line's `LineDetail` (or `LineDetailSkeleton`), which draws the sheet's head and body;
   * left out when none is open.
   */
  detail?: ReactNode;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * How long a closing detail stays drawn: its sheet slides back out (or goes back down on a phone)
 * in 200 ms, its backdrop fading as long; a little more, so that their last frame is drawn.
 */
const CLOSING_MS = 300;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const shows = (detail: ReactNode) => detail !== undefined && detail !== null;

/** A detail's key (the page keys it by its line's id), `null` for none. */
const keyOf = (detail: ReactNode) => (isValidElement(detail) ? detail.key : null);

/**
 * The detail's sheet, on every screen (#182): one for every line opened in a row, so that the next
 * line's content takes the last one's place in it, still, while the sheet stays open and stays
 * where it is among the page's dialogs (#164). The open line's `LineDetail` draws its head and
 * body, and says what closing it does.
 */
function DetailSheet({
  close,
  closing,
  still,
  onClose,
  children,
}: {
  close: DetailClose | undefined;
  closing: boolean;
  /** It came with the page: there at once, never sliding in on its own. */
  still: boolean;
  onClose: (close: DetailClose) => void;
  children: ReactNode;
}) {
  return (
    <SheetFrame
      open={!closing}
      onOpenChange={(open) => {
        if (!open) {
          close?.onClose();
        }
      }}
      appear={!still}
    >
      <DetailSheetClose value={onClose}>{children}</DetailSheetClose>
    </SheetFrame>
  );
}

/**
 * The operations screen's places (docs/wireframes, screen 2): the filters, the count of lines
 * that match, the list in a block that takes the height left in the screen, with its own
 * scroller, and the open line's detail. The detail is the shared side `Sheet` over the list, on
 * every screen (#182): from the right edge from Tailwind's `md` on, from the bottom on a phone. The
 * list keeps its width, place and scroll under it. One sheet holds the lines opened one after the
 * other (the review's next line): it stays open while the next line's content takes the last one's
 * place, so that it never comes up again over a dialog opened since (#164). The whole takes the
 * screen's height (at least 480 px), so that the list scrolls in itself.
 *
 * Motion (#182): the sheet slides in from its edge in 300 ms (ease-out) and back out in 200 ms
 * (ease-in), its backdrop fading in and out in 200 ms; the closed detail stays drawn meanwhile, and
 * `DetailClosing` tells it so. From one line to the next it stays still, its content changed at
 * once. A detail that came with the page (its address) is there at once. A new count is said to
 * screen readers. Cut under reduced motion: the detail is there, or not.
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

  // The detail drawn: the open one, or the last one while it leaves.
  const [kept, setKept] = useState(detail);

  if (shows(detail) && detail !== kept) {
    setKept(detail);
  }

  const closing = !shows(detail) && shows(kept);

  // The line whose detail came with the page (its address), until it is closed: its sheet shows
  // at once rather than slide in on its own once the page runs.
  const [withPage, setWithPage] = useState(() => keyOf(detail));
  const cameWithPage = withPage !== null && keyOf(kept) === withPage;

  // What closing the sheet does: the open line's close.
  const [close, setClose] = useState<DetailClose>();

  useEffect(() => {
    if (!closing) {
      return;
    }

    const wait = window.matchMedia(REDUCED_MOTION).matches ? 0 : CLOSING_MS;

    const timer = window.setTimeout(() => {
      setKept(undefined);
      setWithPage(null);
      setClose(undefined);
    }, wait);

    return () => window.clearTimeout(timer);
  }, [closing]);

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
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">{list}</div>
      </div>
      {shows(kept) ? (
        <DetailClosing value={closing}>
          <DetailCameWithPage value={cameWithPage}>
            <DetailSheet close={close} closing={closing} still={cameWithPage} onClose={setClose}>
              {kept}
            </DetailSheet>
          </DetailCameWithPage>
        </DetailClosing>
      ) : null}
    </div>
  );
}
