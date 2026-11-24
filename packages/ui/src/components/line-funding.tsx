import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useId, useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Button } from "./button";
import { Dialog, DialogClose } from "./dialog";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";
import { Side } from "./line-transfer";
import type { TransferSideView } from "./line-transfer";

/** An expense a refund funds or may fund, already worded. */
export type FundedExpenseView = {
  /** Its first payment's line: the line its button opens, and the one funding names. */
  id: string;
  /** The day it happened: "Oct 2". */
  day: string;
  /** Its category, already worded ("Leisure › Sport"). */
  category: string;
  /** Its first payment's label. */
  label: string;
  /** What it costs, which the funding leaves as it is. */
  net: Money;
};

export type LineFundsProps = {
  /** The expense this side of a works council refund funds; left out when it funds none. */
  funds?: FundedExpenseView;
  /** The expenses it may fund, the nearest day first: what the dialog offers. */
  candidates: ReadonlyArray<FundedExpenseView>;
  /** Goes to the funded expense's line. */
  onOpenExpense: (id: string) => void;
  /** Funds the expense of the line chosen: true once funded, which closes the dialog. */
  onFund: (id: string) => Promise<boolean>;
  /** The refund funds nothing any more; the button stays busy until it settles. */
  onUnfund: () => Promise<void>;
  /** A refusal of the last change, worded by the page. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

export type LineFundedByProps = {
  /** Each transfer funding the expense, by its side out on the benefit account, oldest first. */
  fundings: ReadonlyArray<TransferSideView>;
  /** What they fund together. */
  funded: Money;
  /** What the expense costs, which they leave as it is. */
  net: Money;
  /** Goes to a funding's line. */
  onOpenLine: (id: string) => void;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

const groupClasses = "flex flex-col gap-3 border-t pt-4";

const headingClasses = "flex items-center gap-2 text-sm font-medium text-foreground";

const rowButtonClasses = cn(
  "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left",
  "transition-colors duration-150 ease-out hover:bg-muted motion-reduce:transition-none",
  focusRing,
);

const radioClasses = cn(
  "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-card",
  "transition-colors duration-150 ease-out data-checked:border-primary motion-reduce:transition-none",
  focusRing,
);

/** An expense on one row, as `Side` draws a line: its category, day, first payment and cost. */
const sideOf = (expense: FundedExpenseView): TransferSideView => ({
  id: expense.id,
  day: expense.day,
  label: expense.category,
  account: expense.label,
  amount: expense.net,
});

/**
 * A works council refund, in a side's detail (`LineDetail`'s `transfer`, under `LineTransfer`): a
 * transfer from a benefit account may fund one of the user's expenses (#29), which keeps its cost.
 * Funding one, it shows that expense as a button to its line, and "Unfund". Funding none, "Fund an
 * expense" opens a `Dialog` where the user chooses among the expenses offered (a radio group, the
 * nearest checked), then funds it; nothing is funded unasked. A refusal shows in the dialog, which
 * stays open, or under the block.
 *
 * Motion: none of its own. The dialog is `Dialog`'s (it fades and grows in 200 ms; on a phone it
 * rises in 300 ms), a row's hover colour moves in 150 ms, and going to the expense is the detail's
 * own close and open; all cut under reduced motion.
 */
export function LineFunds({
  funds,
  candidates,
  onOpenExpense,
  onFund,
  onUnfund,
  error,
  locale,
}: LineFundsProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const offered = candidates.some((candidate) => candidate.id === chosen);

  const fund = async () => {
    if (!offered) {
      return;
    }

    setBusy(true);

    try {
      if (await onFund(chosen)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const unfund = async () => {
    setBusy(true);

    try {
      await onUnfund();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-slot="line-funds" aria-label={words.fundsExpense} className={groupClasses}>
      <p className={headingClasses}>
        <Icon name="undo" size="sm" />
        {words.fundsExpense}
      </p>
      {funds === undefined ? (
        <>
          <p className="text-xs text-muted-foreground">{words.fundsNone}</p>
          <div className="flex">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Each opening starts from the nearest expense.
                setChosen(candidates[0]?.id ?? "");
                setOpen(true);
              }}
            >
              {words.fundExpense}
            </Button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            data-slot="funded-expense"
            onClick={() => onOpenExpense(funds.id)}
            className={rowButtonClasses}
          >
            <Side side={sideOf(funds)} locale={writtenIn} />
            <Icon name="next" size="sm" />
          </button>
          <p className="text-xs text-muted-foreground">{words.fundsKept}</p>
          <div className="flex">
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void unfund()}>
              {words.unfund}
            </Button>
          </div>
        </>
      )}
      <FormMessage message={open ? undefined : error} />
      <Dialog
        title={words.fundExpense}
        description={words.fundDescription}
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <DialogClose>
              <Button type="button" variant="secondary">
                {messages.overlays.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" form={formId} loading={busy} disabled={!offered}>
              {words.fund}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void fund();
          }}
        >
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{words.fundNoCandidate}</p>
          ) : (
            <RadioGroup
              aria-label={words.fundChoice}
              value={offered ? chosen : null}
              onValueChange={(next) => {
                if (next !== null) {
                  setChosen(next);
                }
              }}
              className="flex max-h-72 flex-col gap-2 overflow-y-auto"
            >
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2"
                >
                  <Radio value={candidate.id} className={radioClasses}>
                    <RadioIndicator className="size-2 rounded-full bg-primary" />
                  </Radio>
                  <Side side={sideOf(candidate)} locale={writtenIn} />
                </label>
              ))}
            </RadioGroup>
          )}
          <FormMessage message={error} />
        </form>
      </Dialog>
    </section>
  );
}

/**
 * The transfers from a benefit account funding an expense (#29), in its line's detail
 * (`LineDetail`'s `expense`, after `LineExpense`): "Funded by", each one's side out (day, benefit
 * account, amount) as a button to its line, what they fund in all, and that the expense keeps its
 * cost. Unfunding is done from a funding's own line.
 *
 * Motion: none of its own: a row's hover colour moves in 150 ms, and going to a funding's line is
 * the detail's own close and open; cut under reduced motion.
 */
export function LineFundedBy({ fundings, funded, net, onOpenLine, locale }: LineFundedByProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <section data-slot="line-funded-by" aria-label={words.fundedBy} className={groupClasses}>
      <p className={headingClasses}>
        <Icon name="undo" size="sm" />
        {words.fundedBy}
      </p>
      <ul className="flex flex-col gap-2">
        {fundings.map((funding) => (
          <li key={funding.id} data-slot="funding" className="flex">
            <button
              type="button"
              onClick={() => onOpenLine(funding.id)}
              className={rowButtonClasses}
            >
              <Side side={funding} locale={writtenIn} />
              <Icon name="next" size="sm" />
            </button>
          </li>
        ))}
      </ul>
      <div
        data-slot="funded-total"
        className="flex items-baseline justify-between gap-4 border-t pt-2 text-sm"
      >
        <span className="font-medium text-foreground">{words.fundedInAll}</span>
        <Amount value={funded} size="sm" roll={false} locale={writtenIn} />
      </div>
      <p data-slot="funded-cost" className="text-xs text-muted-foreground">
        {words.fundedCost(formatMoney(net, { locale: writtenIn }))}
      </p>
    </section>
  );
}
