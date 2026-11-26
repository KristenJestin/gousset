import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { usePageLanguage } from "../hooks/use-page-language";
import { useUiMessages } from "../hooks/use-ui-messages";
import { focusRing } from "../lib/form-classes";
import { formatMoney } from "../lib/money";
import type { Money } from "../lib/money";
import { cn } from "../lib/utils";
import { Amount } from "./amount";
import { Button } from "./button";
import { CategoryPicker } from "./category-picker";
import type { CategoryChoice } from "./category-picker";
import { AlertDialog, Dialog } from "./dialog";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { Side } from "./line-transfer";
import { MoneyField } from "./money-field";
import { Sheet } from "./sheet";
import { TextField } from "./text-field";

/** A line of an expense, or a line that may be part of one, already worded. */
export type ExpenseLineView = {
  id: string;
  /** "Oct 12". */
  day: string;
  label: string;
  /** Its account's name, already worded. */
  account: string;
  /** What it pays or refunds, positive. */
  amount: Money;
};

/** An expense this line may cancel, all or part: the line that paid it, its category and cost. */
export type RefundProposalView = ExpenseLineView & {
  /** Its category, already worded ("Eating out › Restaurants"). */
  category: string;
  /** What the expense costs now. */
  net: Money;
};

/** A split line's share: its own id, its category, already worded, and its amount. */
export type ExpenseShareView = { id: string; category: string; amount: Money };

export type LineExpenseProps = {
  /** The open line: its own part shows, but is no button. */
  lineId: string;
  /**
   * The expense made of several lines this line is part of: its payments, its refunds, and what it
   * costs once (or brings, for an income). Left out when the line is its expense alone.
   */
  expense?: {
    kind: "expense" | "income";
    payments: ReadonlyArray<ExpenseLineView>;
    refunds: ReadonlyArray<ExpenseLineView>;
    net: Money;
  };
  /** A line split across categories: each share. Left out when it is not split. */
  shares?: ReadonlyArray<ExpenseShareView>;
  /** The expenses this line coming back may cancel, the likeliest first; none by default. */
  proposals?: ReadonlyArray<RefundProposalView>;
  /**
   * Maybe a refund (#208): the line, with `proposals`, counts as no income until the user answers;
   * the section says so. False for a line a rule classified, which keeps its proposals.
   */
  maybeRefund?: boolean;
  /** Goes to another line's detail. */
  onOpenLine: (id: string) => void;
  /** Takes this line out of its expense, once asked; given with `expense`. */
  onUnlink?: () => Promise<void>;
  /** Links this line as a refund of the expense the line `id` paid, once asked. */
  onConfirmRefund?: (id: string) => Promise<void>;
  /**
   * "Not a refund", under the proposals: the line is an ordinary income, never proposed again.
   * Asks nothing: the money stays an income, and linking the line by hand still makes it a refund.
   */
  onRefuseRefund?: () => Promise<void>;
  /** The actions under it: `LinkLine` and `SplitLine`, as the page allows them. */
  actions?: ReactNode;
  /** A refusal of the last change, worded by the page. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

const groupClasses = "flex flex-col gap-3 border-t pt-4";

const headingClasses = "flex items-center gap-2 text-sm font-medium text-foreground";

const subheadingClasses = "text-xs font-medium text-muted-foreground";

/** A part of the expense: a button to its line, or the open line itself, marked. */
function Part({
  line,
  current,
  onOpen,
  locale,
}: {
  line: ExpenseLineView;
  current: boolean;
  onOpen: (id: string) => void;
  locale: string;
}) {
  const words = useUiMessages().operations;

  if (current) {
    return (
      <li
        data-slot="expense-part"
        data-current=""
        aria-label={words.thisLine(line.label)}
        className="flex items-center gap-3 rounded-md border border-primary/40 bg-muted px-3 py-2"
      >
        <Side side={line} locale={locale} />
      </li>
    );
  }

  return (
    <li data-slot="expense-part" className="flex">
      <button
        type="button"
        onClick={() => onOpen(line.id)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left",
          "transition-colors duration-150 ease-out hover:bg-muted motion-reduce:transition-none",
          focusRing,
        )}
      >
        <Side side={line} locale={locale} />
        <Icon name="next" size="sm" />
      </button>
    </li>
  );
}

/**
 * A line's expense, in its detail (`LineDetail`'s `expense`), as docs/wireframes' screen 2 draws it:
 * an expense made of several lines shows its payments and its refunds, each one click from its
 * line, and its net cost, counted once; "Separate this line" asks, then takes the line out. A line
 * split across categories shows its shares. A line coming back that may cancel a purchase shows
 * "Maybe a refund" with that purchase, and "Link as a refund" asks before linking: nothing is
 * applied unasked. "Not a refund" answers at once (#208): the line is an income, which changes no
 * money, and linking it by hand still makes it a refund. The page puts `LinkLine` and `SplitLine` under it (`actions`). Every value comes
 * worded from the page.
 *
 * Motion: none of its own. The dialogs are `Dialog`'s and `AlertDialog`'s (200 ms in and out), the
 * split's sheet slides in as `Sheet` does (about 300 ms), going to another line is the detail's own
 * close and open, a part's hover colour moves in 150 ms; all cut under reduced motion. Answered,
 * "Maybe a refund" goes at once, with no fade: the page reads the line again and draws it without.
 */
export function LineExpense({
  lineId,
  expense,
  shares,
  proposals = [],
  maybeRefund = false,
  onOpenLine,
  onUnlink,
  onConfirmRefund,
  onRefuseRefund,
  actions,
  error,
  locale,
}: LineExpenseProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;

  return (
    <div data-slot="line-expense" className={groupClasses}>
      {expense === undefined ? null : (
        <section aria-label={expense.kind === "expense" ? words.oneExpense : words.oneIncome}>
          <p className={headingClasses}>
            <Icon name="merchant" size="sm" />
            {expense.kind === "expense" ? words.oneExpense : words.oneIncome}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <p className={subheadingClasses}>{words.payments}</p>
            <ul className="flex flex-col gap-2">
              {expense.payments.map((part) => (
                <Part
                  key={part.id}
                  line={part}
                  current={part.id === lineId}
                  onOpen={onOpenLine}
                  locale={writtenIn}
                />
              ))}
            </ul>
            {expense.refunds.length === 0 ? null : (
              <>
                <p className={subheadingClasses}>{words.refunds}</p>
                <ul className="flex flex-col gap-2">
                  {expense.refunds.map((part) => (
                    <Part
                      key={part.id}
                      line={part}
                      current={part.id === lineId}
                      onOpen={onOpenLine}
                      locale={writtenIn}
                    />
                  ))}
                </ul>
              </>
            )}
            <div
              data-slot="expense-net"
              className="flex items-baseline justify-between gap-4 border-t pt-2 text-sm"
            >
              <span className="font-medium text-foreground">
                {expense.kind === "expense" ? words.netCost : words.netReceived}
              </span>
              <Amount value={expense.net} size="sm" roll={false} locale={writtenIn} />
            </div>
          </div>
          {onUnlink === undefined ? null : (
            <div className="mt-3 flex">
              <AlertDialog
                trigger={
                  <Button variant="secondary" size="sm">
                    {words.separate}
                  </Button>
                }
                title={words.separateTitle}
                description={words.separateDescription}
                confirmLabel={words.separateConfirm}
                onConfirm={onUnlink}
              />
            </div>
          )}
        </section>
      )}
      {shares === undefined ? null : (
        <section aria-label={words.splitAcross(shares.length)}>
          <p className={headingClasses}>
            <Icon name="subjects" size="sm" />
            {words.splitAcross(shares.length)}
          </p>
          <dl className="mt-3 flex flex-col gap-2">
            {shares.map((share) => (
              <div
                key={share.id}
                data-slot="expense-share"
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <dt className="text-foreground">{share.category}</dt>
                <dd>
                  <Amount value={share.amount} size="sm" roll={false} locale={writtenIn} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {proposals.length === 0 ? null : (
        <section aria-label={words.maybeRefund}>
          <p className={headingClasses}>
            <Icon name="undo" size="sm" />
            {words.maybeRefund}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {maybeRefund
              ? `${words.maybeRefundDescription} ${words.maybeRefundWaiting}`
              : words.maybeRefundDescription}
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                data-slot="refund-proposal"
                className="flex flex-col gap-2 rounded-md border px-3 py-2"
              >
                <Side side={proposal} locale={writtenIn} />
                <p className="text-xs text-muted-foreground">
                  {words.proposalCosts(
                    proposal.category,
                    formatMoney(proposal.net, { locale: writtenIn }),
                  )}
                </p>
                {onConfirmRefund === undefined ? null : (
                  <div className="flex">
                    <AlertDialog
                      trigger={
                        <Button variant="secondary" size="sm">
                          {words.linkAsRefund}
                        </Button>
                      }
                      title={words.linkAsRefundTitle}
                      description={words.linkAsRefundDescription(proposal.label)}
                      confirmLabel={words.link}
                      onConfirm={() => onConfirmRefund(proposal.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {onRefuseRefund === undefined ? null : (
            <div className="mt-3 flex">
              <Button variant="ghost" size="sm" onClick={onRefuseRefund}>
                {words.notARefund}
              </Button>
            </div>
          )}
        </section>
      )}
      {actions === undefined ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
      <FormMessage message={error} />
    </div>
  );
}

export type LinkLineProps = {
  /** The lines the search found, nearest first; the open line is not among them. */
  candidates: ReadonlyArray<ExpenseLineView>;
  /** What the search field holds. */
  search: string;
  /** The search field changed: the page searches again and gives new `candidates`. */
  onSearchChange: (search: string) => void;
  /** The dialog opens: the page may start searching only then. */
  onOpen?: () => void;
  /** Links the open line to the expense of the line chosen: true once linked, which closes it. */
  onLink: (id: string) => Promise<boolean>;
  /** A refusal of the last link, worded by the page, shown in the dialog. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * "Link to an expense", in a line's detail: a `Dialog` where the user finds a line of the expense
 * the open line belongs to (a search field and the lines it finds, as radios), then links it. The
 * open line becomes one of its payments, or a refund when its money goes the other way: the server
 * decides by the signs, and says why when it refuses.
 *
 * Motion: none of its own: the dialog is `Dialog`'s (200 ms in and out). Cut under reduced motion.
 */
export function LinkLine({
  candidates,
  search,
  onSearchChange,
  onOpen,
  onLink,
  error,
  locale,
}: LinkLineProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offered = chosen !== null && candidates.some((candidate) => candidate.id === chosen);

  const link = async () => {
    if (chosen === null) {
      return;
    }

    setBusy(true);

    try {
      if (await onLink(chosen)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setChosen(null);
          setOpen(true);
          onOpen?.();
        }}
      >
        {words.linkToExpense}
      </Button>
      <Dialog
        title={words.linkToExpense}
        description={words.linkDescription}
        open={open}
        onOpenChange={setOpen}
        onSubmit={(event) => {
          event.preventDefault();
          void link();
        }}
        actions={
          <Button type="submit" loading={busy} disabled={!offered}>
            {words.link}
          </Button>
        }
      >
        <TextField
          label={words.linkSearch}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{words.linkNone}</p>
        ) : (
          <RadioGroup
            aria-label={words.expenseLine}
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
                <Radio
                  value={candidate.id}
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-card",
                    "transition-colors duration-150 ease-out data-checked:border-primary motion-reduce:transition-none",
                    focusRing,
                  )}
                >
                  <RadioIndicator className="size-2 rounded-full bg-primary" />
                </Radio>
                <Side side={candidate} locale={writtenIn} />
              </label>
            ))}
          </RadioGroup>
        )}
        <FormMessage message={error} />
      </Dialog>
    </>
  );
}

/** A share as the sheet holds it: what is typed so far. */
type ShareDraft = { key: number; categoryId: string | null; minor: number | null };

export type SplitLineProps = {
  /** The line's whole amount, positive: what the shares add up to. */
  total: Money;
  /** The categories of the line's kind, to choose each share's among. */
  categories: ReadonlyArray<CategoryChoice>;
  /** The shares it starts from: the line's split, or its one category with the whole amount. */
  initial: ReadonlyArray<{ categoryId: string | null; minor: number | null }>;
  /** How many shares at most. */
  max: number;
  /** Saves the shares, each a category and an amount in minor units: true once saved. */
  onSplit: (shares: ReadonlyArray<{ categoryId: string; minor: number }>) => Promise<boolean>;
  /** A refusal of the last save, worded by the page, shown in the sheet. */
  error?: string;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
};

/**
 * "Split", in a line's detail: a side `Sheet` (a long form) where each share is a category and an
 * amount, a share added or removed, and what is left to place said as it is typed; "Save the
 * split" waits until the shares make the whole line, each in a category. One share puts the whole
 * line back in one category.
 *
 * Motion: none of its own: the sheet slides in as `Sheet` does (about 300 ms), a field's border as
 * the fields' (150 ms). Cut under reduced motion.
 */
export function SplitLine({
  total,
  categories,
  initial,
  max,
  onSplit,
  error,
  locale,
}: SplitLineProps) {
  const words = useUiMessages().operations;
  const pageLocale = usePageLanguage();
  const writtenIn = locale ?? pageLocale;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The next share's key: read in handlers only, never drawn.
  const next = useRef(0);
  const [drafts, setDrafts] = useState<ReadonlyArray<ShareDraft>>([]);

  const start = () => {
    const first = initial.map((share, index) => ({ key: index, ...share }));

    setDrafts(first);
    next.current = first.length;
    setOpen(true);
  };

  const placed = drafts.reduce((sum, draft) => sum + (draft.minor ?? 0), 0);
  const left = total.minor - placed;

  const ready =
    drafts.length > 0 &&
    left === 0 &&
    drafts.every((draft) => draft.categoryId !== null && (draft.minor ?? 0) > 0);

  const change = (key: number, patch: Partial<ShareDraft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );

  const save = async () => {
    const shares = drafts.flatMap((draft) =>
      draft.categoryId === null || draft.minor === null
        ? []
        : [{ categoryId: draft.categoryId, minor: draft.minor }],
    );

    setBusy(true);

    try {
      if (await onSplit(shares)) {
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const leftText =
    left === 0
      ? words.splitBalanced
      : left > 0
        ? words.splitLeft(formatMoney({ ...total, minor: left }, { locale: writtenIn }))
        : words.splitOver(formatMoney({ ...total, minor: -left }, { locale: writtenIn }));

  return (
    <>
      <Button variant="secondary" size="sm" onClick={start}>
        {words.split}
      </Button>
      <Sheet
        title={words.splitTitle}
        description={words.splitDescription(formatMoney(total, { locale: writtenIn }))}
        open={open}
        onOpenChange={setOpen}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        actions={
          <Button type="submit" loading={busy} disabled={!ready}>
            {words.splitSave}
          </Button>
        }
      >
        <ol className="flex flex-col gap-3">
          {drafts.map((draft, index) => (
            <li
              key={draft.key}
              data-slot="split-share"
              className="flex items-end gap-2 rounded-md border p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <CategoryPicker
                  label={words.shareCategory(index + 1)}
                  size="sm"
                  categories={categories}
                  value={draft.categoryId}
                  onValueChange={(categoryId) => change(draft.key, { categoryId })}
                />
                <MoneyField
                  label={words.shareAmount(index + 1)}
                  size="sm"
                  currency={total.currency}
                  defaultValue={draft.minor}
                  onValueChange={(minor) => change(draft.key, { minor })}
                  locale={writtenIn}
                />
              </div>
              {drafts.length > 1 ? (
                <IconButton
                  icon="delete"
                  size="sm"
                  label={words.shareRemove(index + 1)}
                  onClick={() =>
                    setDrafts((current) => current.filter((each) => each.key !== draft.key))
                  }
                />
              ) : null}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={drafts.length >= max}
            onClick={() => {
              setDrafts((current) => [
                ...current,
                { key: next.current, categoryId: null, minor: left > 0 ? left : null },
              ]);
              next.current += 1;
            }}
          >
            {words.splitAdd}
          </Button>
          <p
            data-slot="split-left"
            aria-live="polite"
            className={cn("text-sm", left === 0 ? "text-muted-foreground" : "text-foreground")}
          >
            {leftText}
          </p>
        </div>
        <FormMessage message={error} />
      </Sheet>
    </>
  );
}
