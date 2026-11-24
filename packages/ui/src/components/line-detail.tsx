import { use, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { useLargeScreen } from "../hooks/use-large-screen";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { DetailCameWithPage, DetailClosing } from "../lib/detail-closing";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount, AmountSkeleton } from "./amount";
import { IconButton } from "./icon-button";
import { Sheet } from "./sheet";
import { Skeleton, SkeletonFrame } from "./skeleton";

/** The import a line came from, already worded. */
export type LineImport = {
  /** The statement's file name: "statement-2026-10.csv". */
  fileName: string;
  /** "24 Oct. 2026". */
  importedOn: string;
  /** The statement's period: "1–31 Oct. 2026". */
  period: string;
};

export type LineDetailProps = {
  /** The line's label, the panel's title. */
  label: string;
  amount: Money;
  /** The account's name, already worded. */
  account: string;
  /** Already worded ("21 October 2026"), as every date below. */
  bookedOn: string;
  valueOn?: string;
  /** The bank's raw label, as imported, shown in a fixed-width font. */
  rawLabel: string;
  memo?: string;
  counterparty?: string;
  /** The amount in its own currency, when the line was in another one than the account's. */
  originalAmount?: Money;
  /** When the money expires (a meal card's credit). */
  expiresOn?: string;
  /** A line held for review: the line it looks like, worded ("21 Oct., CB GREENMARKET, €52.00"). */
  looksLike?: string;
  /** The import it came from; left out, the line was entered by hand. */
  importedFrom?: LineImport;
  onClose: () => void;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

function DetailGroup({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-2 border-t pt-4">{children}</dl>;
}

/**
 * One line's detail (docs/wireframes, screen 2, block 3): its label and amount, its account, the
 * day it was booked and its value date, the bank's raw label (fixed-width) with its memo and
 * counterparty, the original amount when it was in another currency, its expiry, "To review:
 * looks like …" on a held line, and the import it came from or "Entered by hand". Every text comes
 * worded from the page. The close button or Escape closes it; the focus goes into it when it opens.
 * From Tailwind's `lg` on it is a panel, which `OperationsLayout` sets in a column beside the list;
 * below, a modal `Sheet` over the list (from the bottom on a phone, from the side on a tablet),
 * its label and amount at its top.
 *
 * Motion (#128): the panel's content, laid out at its full width from the start, fades in and
 * slides 8 px from the right (180 ms, ease-out) once its column has room for it (after 120 ms);
 * closing, it fades out (150 ms, ease-in) before the column closes (`DetailClosing`). Nothing in
 * it ever scales, so no text is squashed. The sheet rises from its edge in 300 ms and goes back
 * down in 200 ms. A detail the server drew (a line opened from the address) shows as it is. Cut
 * under reduced motion.
 */
export function LineDetail({
  label,
  amount,
  account,
  bookedOn,
  valueOn,
  rawLabel,
  memo,
  counterparty,
  originalAmount,
  expiresOn,
  looksLike,
  importedFrom,
  onClose,
  locale,
}: LineDetailProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const panel = useRef<HTMLElement>(null);
  const large = useLargeScreen();
  const closing = use(DetailClosing);
  const cameWithPage = use(DetailCameWithPage);
  // Opened by the user once the page runs: it moves. Drawn by the server: it stays still.
  const hydrated = useHydrated();
  const [moves] = useState(hydrated);

  // The focus goes into the panel when the user opens it, so that Escape and Tab start there.
  useEffect(() => {
    if (moves) {
      panel.current?.focus();
    }
  }, [moves]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const content = (
    <>
      {looksLike === undefined ? null : (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          {words.looksLike(looksLike)}
        </p>
      )}
      <DetailGroup>
        <DetailRow label={words.account}>{account}</DetailRow>
        <DetailRow label={words.bookedOn}>{bookedOn}</DetailRow>
        {valueOn === undefined ? null : <DetailRow label={words.valueOn}>{valueOn}</DetailRow>}
        {originalAmount === undefined ? null : (
          <DetailRow label={words.originalAmount}>
            <Amount value={originalAmount} size="sm" roll={false} locale={writtenIn} />
          </DetailRow>
        )}
        {expiresOn === undefined ? null : (
          <DetailRow label={words.expiresOn}>{expiresOn}</DetailRow>
        )}
      </DetailGroup>
      <DetailGroup>
        <div className="flex flex-col gap-1 text-sm">
          <dt className="text-muted-foreground">{words.rawLabel}</dt>
          <dd className="font-mono text-xs break-all text-foreground">{rawLabel}</dd>
        </div>
        {memo === undefined ? null : <DetailRow label={words.memo}>{memo}</DetailRow>}
        {counterparty === undefined ? null : (
          <DetailRow label={words.counterparty}>{counterparty}</DetailRow>
        )}
      </DetailGroup>
      <DetailGroup>
        {importedFrom === undefined ? (
          <DetailRow label={words.source}>{words.enteredByHand}</DetailRow>
        ) : (
          <>
            <DetailRow label={words.importedFrom}>{importedFrom.fileName}</DetailRow>
            <DetailRow label={words.importedOn}>{importedFrom.importedOn}</DetailRow>
            <DetailRow label={words.period}>{importedFrom.period}</DetailRow>
          </>
        )}
      </DetailGroup>
    </>
  );

  const amountShown = <Amount value={amount} size="lg" roll={false} locale={writtenIn} />;

  if (!large) {
    // A phone, a tablet: a sheet over the list, which goes back down before it is taken away.
    return (
      <Sheet
        open={!closing}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        title={label}
        description={amountShown}
        // Opened from the address: there at once, never rising on its own.
        appear={moves && !cameWithPage}
      >
        <div data-slot="line-detail" className="flex flex-col gap-4">
          {content}
        </div>
      </Sheet>
    );
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={label}
      data-slot="line-detail"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border bg-card outline-none"
      onKeyDown={onKeyDown}
    >
      {/* What fades: the panel's block stays, revealed by its column's width. */}
      <div
        data-slot="line-detail-content"
        data-closing={closing ? "" : undefined}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4",
          "transition delay-120 duration-180 ease-out",
          moves && "starting:translate-x-2 starting:opacity-0",
          "data-closing:opacity-0 data-closing:delay-0 data-closing:duration-150 data-closing:ease-in",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-base font-semibold break-words">{label}</h2>
            {amountShown}
          </div>
          <IconButton icon="close" label={messages.overlays.close} size="sm" onClick={onClose} />
        </div>
        {content}
      </div>
    </section>
  );
}

function RowSkeleton() {
  return (
    <div className="flex h-5 items-center justify-between gap-4">
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-3.5 w-28" />
    </div>
  );
}

/** `LineDetail` on its way: its title, amount and three groups of rows, at the same heights. */
export function LineDetailSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex h-full min-h-0 w-full flex-col gap-4 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <span className="flex h-6 items-center">
              <Skeleton className="h-4 w-40" />
            </span>
            <AmountSkeleton size="lg" />
          </div>
          <Skeleton className="size-8" />
        </div>
        {[3, 2, 3].map((rows, group) => (
          <div key={group} className="flex flex-col gap-2 border-t pt-4">
            {Array.from({ length: rows }, (_, row) => (
              <RowSkeleton key={row} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}
