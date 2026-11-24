import { domMax, LazyMotion, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import type { Money } from "../lib/money";
import { transition } from "../lib/motion";
import { operationLayoutId } from "../lib/operations";
import { cn } from "../lib/utils";
import { Amount, AmountSkeleton } from "./amount";
import { IconButton } from "./icon-button";
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
  /** The line's id: the same as its row's in `OperationsList`, which the detail grows out of. */
  id: string;
  /** The line's label, the panel's title. */
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
 * `OperationsLayout` sets it beside the list on a wide screen and over it on a phone.
 *
 * Motion: it grows out of its row of `OperationsList` (a shared layout on `operationLayoutId`,
 * 300 ms, ease-out) and its content fades in after 100 ms; closing, it folds back into the row,
 * which needs it to leave inside an `AnimatePresence` (`OperationsLayout` has one). A detail the
 * server drew (a line opened from the address) shows as it is, with no `style` attribute. Cut
 * under reduced motion.
 */
export function LineDetail({
  id,
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
  category,
  merchant,
  transfer,
  expense,
  onClose,
  locale,
}: LineDetailProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const panel = useRef<HTMLElement>(null);
  // Opened by the user once the page runs: it moves. Drawn by the server: it stays still, so that
  // its markup carries no `style` attribute (the Content Security Policy forbids them).
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

  const header = (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-base font-semibold break-words">{label}</h2>
        <Amount value={amount} size="lg" roll={false} locale={writtenIn} />
      </div>
      <IconButton icon="close" label={messages.overlays.close} size="sm" onClick={onClose} />
    </div>
  );

  // The panel carries its own block: it is what moves, out of its row and back.
  const classes =
    "flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-4 outline-none";

  if (!moves) {
    return (
      <section
        ref={panel}
        tabIndex={-1}
        aria-label={label}
        data-slot="line-detail"
        className={cn(classes)}
        onKeyDown={onKeyDown}
      >
        {header}
        <div className="flex flex-col gap-4">{content}</div>
      </section>
    );
  }

  return (
    <LazyMotion features={domMax}>
      <m.section
        ref={panel}
        layoutId={operationLayoutId(id)}
        transition={transition.slow}
        tabIndex={-1}
        aria-label={label}
        data-slot="line-detail"
        className={cn(classes)}
        onKeyDown={onKeyDown}
      >
        {header}
        <m.div
          className="flex flex-col gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transition.base, delay: 0.1 }}
        >
          {content}
        </m.div>
      </m.section>
    </LazyMotion>
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
