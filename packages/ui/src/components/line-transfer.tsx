import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useId, useState } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Button } from "./button";
import { Chip } from "./chip";
import { AlertDialog, Dialog, DialogClose } from "./dialog";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";

/** The other side of a transfer, or a line that may be it, already worded. */
export type TransferSideView = {
  id: string;
  /** "Oct 10". */
  day: string;
  label: string;
  /** Its account's name, already worded. */
  account: string;
  amount: Money;
};

export type LineTransferProps = {
  /** `out`: the money left by this line; `in`: it came in by it. */
  direction: "out" | "in";
  other: TransferSideView;
  /** Money moved to savings or investments: the month sets it aside. */
  setAside: boolean;
  /**
   * One side was made by the app, this line or the other: the account it is on, whose statement
   * does not show it. Unpairing deletes it.
   */
  madeOn?: string;
  /** Goes to the other side's detail. */
  onOpenOther: (id: string) => void;
  /** Runs once "Not a transfer" is confirmed; the dialog stays open, busy, until it settles. */
  onUnpair: () => Promise<void>;
  /** A refusal of the last unpairing, worded by the page. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

export type LineTransferCandidatesProps = {
  /** The lines that may be the other side, nearest first; at least one. */
  candidates: ReadonlyArray<TransferSideView>;
  /** Pairs the line with the chosen one: true once paired, which closes the dialog. */
  onPair: (otherId: string) => Promise<boolean>;
  /** A refusal of the last pairing, worded by the page, shown in the dialog. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/** An account kept by its balance that a line can be paired with, already worded. */
export type BalanceAccountView = {
  id: string;
  /** Its name, as the page writes it (with its institution when another account has its name). */
  name: string;
};

export type LineTransferToAccountProps = {
  /** The open accounts kept by their balance, in the line's currency, but its own; at least one. */
  accounts: ReadonlyArray<BalanceAccountView>;
  /** Pairs the line with the chosen account: true once paired, which closes the dialog. */
  onPair: (accountId: string) => Promise<boolean>;
  /** A refusal of the last pairing, worded by the page, shown in the dialog. */
  error?: string;
};

/** A line's label, day, account and amount, on one row: a transfer's side, an expense's part. */
export function Side({ side, locale }: { side: TransferSideView; locale: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium break-words text-foreground">{side.label}</span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{side.day}</span>
          <span>{side.account}</span>
        </span>
      </span>
      <Amount value={side.amount} size="sm" roll={false} locale={locale} />
    </span>
  );
}

const groupClasses = "flex flex-col gap-3 border-t pt-4";

const radioClasses = cn(
  "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-card",
  "transition-colors duration-150 ease-out data-checked:border-primary motion-reduce:transition-none",
  focusRing,
);

const headingClasses = "flex items-center gap-2 text-sm font-medium text-foreground";

/**
 * A line's transfer, in its detail (`LineDetail`'s `transfer`): "Transfer to <account>" (or
 * "from"), with "Set aside" when the money went to savings or investments, and the other side as
 * one button that opens its detail; "Made by Gousset: …" when the app made that side; "Not a
 * transfer" asks in an `AlertDialog`, then unpairs. A line that may be a transfer shows
 * `LineTransferCandidates` instead; a line that is neither shows nothing.
 *
 * Motion: none of its own. The dialog is `AlertDialog`'s (200 ms in and out), and going to the
 * other side is the detail's own close and open; all cut under reduced motion.
 */
export function LineTransfer({
  direction,
  other,
  setAside,
  madeOn,
  onOpenOther,
  onUnpair,
  error,
  locale,
}: LineTransferProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="line-transfer" className={groupClasses}>
      <div className="flex flex-wrap items-center gap-2">
        <p className={headingClasses}>
          <Icon name="transfer" size="sm" />
          {direction === "out"
            ? words.transferTo(other.account)
            : words.transferFrom(other.account)}
        </p>
        {setAside ? <Chip>{words.setAside}</Chip> : null}
      </div>
      <button
        type="button"
        onClick={() => onOpenOther(other.id)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left",
          "transition-colors duration-150 ease-out hover:bg-muted motion-reduce:transition-none",
          focusRing,
        )}
      >
        <Side side={other} locale={writtenIn} />
        <Icon name="next" size="sm" />
      </button>
      {madeOn === undefined ? null : (
        <p className="text-xs text-muted-foreground">{words.madeByApp(madeOn)}</p>
      )}
      <div className="flex">
        <AlertDialog
          trigger={
            <Button variant="secondary" size="sm">
              {words.notATransfer}
            </Button>
          }
          title={words.unpairTitle}
          description={
            madeOn === undefined ? words.unpairDescription : words.unpairDescriptionMade(madeOn)
          }
          confirmLabel={words.unpair}
          onConfirm={onUnpair}
        />
      </div>
      <FormMessage message={error} />
    </div>
  );
}

/**
 * The lines that may be a line's other side, in its detail (`LineDetail`'s `transfer`): "Maybe a
 * transfer" with each candidate (day, account, label, amount), and "Pair as a transfer", which
 * opens a `Dialog` where the user chooses one (a radio group, the nearest checked; one candidate
 * shows alone, checked), then pairs. A refusal shows in the dialog, which stays open.
 *
 * Motion: none of its own. The dialog is `Dialog`'s (200 ms in and out); cut under reduced motion.
 */
export function LineTransferCandidates({
  candidates,
  onPair,
  error,
  locale,
}: LineTransferCandidatesProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const pair = async () => {
    setBusy(true);

    try {
      if (await onPair(chosen)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-slot="line-transfer" className={groupClasses}>
      <p className={headingClasses}>
        <Icon name="transfer" size="sm" />
        {words.maybeTransfer}
      </p>
      <ul className="flex flex-col gap-2">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="flex rounded-md border px-3 py-2">
            <Side side={candidate} locale={writtenIn} />
          </li>
        ))}
      </ul>
      <div className="flex">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // Each opening starts from the nearest candidate.
            setChosen(candidates[0]?.id ?? "");
            setOpen(true);
          }}
        >
          {words.pairAsTransfer}
        </Button>
      </div>
      <Dialog
        title={words.pairAsTransfer}
        description={words.pairDescription}
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <DialogClose>
              <Button type="button" variant="secondary">
                {messages.overlays.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" form={formId} loading={busy}>
              {words.pair}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void pair();
          }}
        >
          <RadioGroup
            aria-label={words.otherSide}
            value={chosen}
            onValueChange={(next) => {
              if (next !== null) {
                setChosen(next);
              }
            }}
            className="flex flex-col gap-2"
          >
            {candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2"
              >
                <Radio value={candidate.id} className={radioClasses}>
                  <RadioIndicator className="size-2 rounded-full bg-primary" />
                </Radio>
                <Side side={candidate} locale={writtenIn} />
              </label>
            ))}
          </RadioGroup>
          <FormMessage message={error} />
        </form>
      </Dialog>
    </div>
  );
}

/**
 * A line whose other side is on an account kept by its balance, which has no line of its own to pair
 * with, in its detail (`LineDetail`'s `transfer`, after `LineTransferCandidates` when it has some):
 * "Pair with an account" opens a `Dialog` where the user chooses the account (a radio group, the
 * first checked), then pairs; Gousset makes that account's side. A refusal shows in the dialog,
 * which stays open.
 *
 * Motion: none of its own. The dialog is `Dialog`'s (200 ms in and out); cut under reduced motion.
 */
export function LineTransferToAccount({ accounts, onPair, error }: LineTransferToAccountProps) {
  const messages = useUiMessages();
  const words = messages.operations;
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const pair = async () => {
    setBusy(true);

    try {
      if (await onPair(chosen)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-slot="line-transfer-account" className={groupClasses}>
      <p className={headingClasses}>
        <Icon name="transfer" size="sm" />
        {words.withBalanceAccount}
      </p>
      <div className="flex">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // Each opening starts from the first account.
            setChosen(accounts[0]?.id ?? "");
            setOpen(true);
          }}
        >
          {words.pairWithAccount}
        </Button>
      </div>
      <Dialog
        title={words.pairWithAccount}
        description={words.pairWithAccountDescription}
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <DialogClose>
              <Button type="button" variant="secondary">
                {messages.overlays.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" form={formId} loading={busy}>
              {words.pair}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void pair();
          }}
        >
          <RadioGroup
            aria-label={words.balanceAccount}
            value={chosen}
            onValueChange={(next) => {
              if (next !== null) {
                setChosen(next);
              }
            }}
            className="flex flex-col gap-2"
          >
            {accounts.map((account) => (
              <label
                key={account.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium text-foreground"
              >
                <Radio value={account.id} className={radioClasses}>
                  <RadioIndicator className="size-2 rounded-full bg-primary" />
                </Radio>
                <span className="min-w-0 break-words">{account.name}</span>
              </label>
            ))}
          </RadioGroup>
          <FormMessage message={error} />
        </form>
      </Dialog>
    </div>
  );
}
