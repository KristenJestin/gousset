import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { DetailCameWithPage, DetailClosing, DetailSheetClose } from "../lib/detail-closing";
import type { Money } from "../lib/money";
import { Amount, AmountSkeleton } from "./amount";
import { Sheet, SheetBody, SheetFrame, SheetHeader } from "./sheet";
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
  /** The line's label, the sheet's title. */
  label: string;
  amount: Money;
  /** The account's name, already worded. */
  account: string;
  /** Already worded ("21 October 2026"), as every date below. */
  bookedOn: string;
  valueOn?: string;
  /**
   * The bank's raw label, as imported, shown in a fixed-width font; empty for a line the app made
   * (a balance's movement), which has none: the row is left out.
   */
  rawLabel: string;
  memo?: string;
  counterparty?: string;
  /** The amount in its own currency, when the line was in another one than the account's. */
  originalAmount?: Money;
  /** When the money expires (a meal card's credit). */
  expiresOn?: string;
  /** A line held for review: the line it looks like, worded ("21 Oct., CB GREENMARKET, €52.00"). */
  looksLike?: string;
  /** The import it came from; left out, the line was entered by hand, unless `origin` says. */
  importedFrom?: LineImport;
  /**
   * Where a line no import read comes from, already worded ("Made from a noted balance"); left
   * out, "Entered by hand".
   */
  origin?: string;
  /**
   * In review mode (#35), what Gousset proposes for the line (`ReviewProposal`), at the very top;
   * the focus goes to it rather than to the sheet when the line opens.
   */
  review?: ReactNode;
  /** Its category, to see and change: a `CategoryPicker`; left out for a line with none. */
  category?: ReactNode;
  /** Who the line paid (`LineMerchant`), under its category; left out for a line with none. */
  merchant?: ReactNode;
  /** The line's transfer or its candidates (`LineTransfer`), after its account and days. */
  transfer?: ReactNode;
  /**
   * The line's expense (`LineExpense`): the expense of several lines it is part of, its split, the
   * refunds proposed, and the actions to link or split it; after its transfer.
   */
  expense?: ReactNode;
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

/** The bank's words: its raw label, memo and counterparty; nothing for a line the app made. */
function BankWords({
  rawLabel,
  memo,
  counterparty,
}: Pick<LineDetailProps, "rawLabel" | "memo" | "counterparty">) {
  const words = useUiMessages().operations;

  if (rawLabel === "" && memo === undefined && counterparty === undefined) {
    return null;
  }

  return (
    <DetailGroup>
      {rawLabel === "" ? null : (
        <div className="flex flex-col gap-1 text-sm">
          <dt className="text-muted-foreground">{words.rawLabel}</dt>
          <dd className="font-mono text-xs break-all text-foreground">{rawLabel}</dd>
        </div>
      )}
      {memo === undefined ? null : <DetailRow label={words.memo}>{memo}</DetailRow>}
      {counterparty === undefined ? null : (
        <DetailRow label={words.counterparty}>{counterparty}</DetailRow>
      )}
    </DetailGroup>
  );
}

/**
 * One line's detail (docs/wireframes, screen 2, block 3): its label and amount, its account, the
 * day it was booked and its value date, the bank's raw label (fixed-width) with its memo and
 * counterparty, the original amount when it was in another currency, its expiry, "To review:
 * looks like …" on a held line, its transfer (`transfer`, a `LineTransfer`), its expense
 * (`expense`, a `LineExpense`), and the import it came from, "Entered by hand" or where the app
 * made it from (`origin`); first, its category, through the control the page gives (`category`),
 * and who it paid (`merchant`, a `LineMerchant`). Every text comes worded from the page. The close
 * button or Escape closes it; the focus goes into it when it opens.
 * On every screen (#182) it is the shared modal side `Sheet` over the list (from the right edge
 * from Tailwind's `md` on, from the bottom on a phone), its label and amount at its top:
 * `OperationsLayout`'s own, kept open from one line to the next (it draws that sheet's head and
 * body, and the focus goes back to the sheet), or one of its own elsewhere.
 *
 * Motion: the sheet slides in from its edge in 300 ms and back out in 200 ms. A detail that came
 * with the page (a line opened from the address) shows at once. Cut under reduced motion.
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
  origin,
  review,
  category,
  merchant,
  transfer,
  expense,
  onClose,
  locale,
}: LineDetailProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const proposal = useRef<HTMLDivElement>(null);
  const closing = use(DetailClosing);
  const cameWithPage = use(DetailCameWithPage);
  // Opened by the user once the page runs: it moves. Drawn by the server: it stays still.
  const hydrated = useHydrated();
  const [moves] = useState(hydrated);
  // In the layout's sheet, which stays open from one line to the next: what closing it does.
  const sheetClose = use(DetailSheetClose);
  const body = useRef<HTMLDivElement>(null);

  // Before the sheet can be closed: closing it closes this line.
  useLayoutEffect(() => {
    sheetClose?.({ onClose });
  }, [sheetClose, onClose]);

  // The focus goes into the sheet when the user opens a line, so that Escape and Tab start there
  // (the last line's content may have held it); in review mode, onto the proposal, so that the
  // next line's is read and acted on at once. Never from a dialog opened over it meanwhile (#164:
  // the list of shortcuts asked for as the next line opens).
  useEffect(() => {
    const target = proposal.current ?? dialogOf(body.current);

    if (moves && target !== null && target !== undefined && !dialogAbove(target)) {
      target.focus();
    }
  }, [moves]);

  const content = (
    <>
      {review === undefined ? null : (
        <div
          ref={proposal}
          tabIndex={-1}
          // Where its sheet starts when it opens on this line.
          data-autofocus=""
          data-slot="line-review"
          className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {review}
        </div>
      )}
      {category === undefined ? null : <div data-slot="line-category">{category}</div>}
      {merchant}
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
      {transfer}
      {expense}
      <BankWords rawLabel={rawLabel} memo={memo} counterparty={counterparty} />
      <DetailGroup>
        {importedFrom === undefined ? (
          <DetailRow label={words.source}>{origin ?? words.enteredByHand}</DetailRow>
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

  const shown = (
    <div ref={body} data-slot="line-detail" className="flex flex-col gap-4">
      {content}
    </div>
  );

  const amountShown = <Amount value={amount} size="lg" roll={false} locale={writtenIn} />;

  if (sheetClose !== undefined) {
    // The layout's sheet holds it: its head and body are this line's, on the server too.
    return (
      <>
        <SheetHeader title={label} description={amountShown} />
        <SheetBody>{shown}</SheetBody>
      </>
    );
  }

  // A sheet of its own over the page, which leaves before it is taken away.
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
      // Opened from the address: there at once, never sliding in on its own.
      appear={moves && !cameWithPage}
    >
      {shown}
    </Sheet>
  );
}

/** Whether a dialog is open over the page that does not hold `own`: one over the detail. */
function dialogAbove(own: Element) {
  return [
    ...document.querySelectorAll('[role="dialog"][data-open], [role="alertdialog"][data-open]'),
  ].some((dialog) => !dialog.contains(own));
}

/** The dialog an element sits in: a sheet's, to give it the focus. */
function dialogOf(element: HTMLElement | null) {
  return element?.closest<HTMLElement>('[role="dialog"]');
}

function RowSkeleton() {
  return (
    <div className="flex h-5 items-center justify-between gap-4">
      <Skeleton className="h-3.5 w-20" />
      <Skeleton className="h-3.5 w-28" />
    </div>
  );
}

/**
 * `LineDetail` on its way, in its sheet: its title and amount in the sheet's head, and three groups
 * of rows, at the same heights. In `OperationsLayout`'s sheet, or in one of its own elsewhere.
 * `onClose`: what the close button, Escape or a press on the backdrop does, as `LineDetail`'s.
 */
export function LineDetailSkeleton({ onClose }: { onClose: () => void }) {
  const sheetClose = use(DetailSheetClose);
  const inLayout = sheetClose !== undefined;

  // Before the sheet can be closed: closing it closes the line on its way.
  useLayoutEffect(() => {
    sheetClose?.({ onClose });
  }, [sheetClose, onClose]);

  const drawn = (
    <>
      <SheetHeader
        title=""
        description={
          <span className="flex flex-col gap-1">
            <span className="flex h-6 items-center">
              <Skeleton className="h-4 w-40" />
            </span>
            <AmountSkeleton size="lg" />
          </span>
        }
      />
      <SheetBody>
        <SkeletonFrame>
          <div className="flex flex-col gap-4">
            {[3, 2, 3].map((rows, group) => (
              <div key={group} className="flex flex-col gap-2 border-t pt-4">
                {Array.from({ length: rows }, (_, row) => (
                  <RowSkeleton key={row} />
                ))}
              </div>
            ))}
          </div>
        </SkeletonFrame>
      </SheetBody>
    </>
  );

  return inLayout ? (
    drawn
  ) : (
    <SheetFrame
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {drawn}
    </SheetFrame>
  );
}
