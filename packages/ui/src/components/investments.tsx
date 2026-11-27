import { useRef, useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { usePageLanguage } from "../hooks/use-page-language";
import { formatMoney, formatQuantity, formatUnitAmount } from "../lib/money";
import type { Money, UnitAmount } from "../lib/money";
import { staggerDelay } from "../lib/stagger";
import { cn } from "../lib/utils";
import { FigureBox } from "./account-figures";
import { Amount, AmountSkeleton } from "./amount";
import { Button } from "./button";
import { Chip } from "./chip";
import { DatePicker } from "./date-picker";
import { Dialog } from "./dialog";
import { FormMessage } from "./form-message";
import { Icon } from "./icon";
import type { IconName } from "./icon";
import { IconButton } from "./icon-button";
import { MoneyField } from "./money-field";
import { Select } from "./select";
import { Skeleton, SkeletonFrame } from "./skeleton";
import { TextField } from "./text-field";

// An investment account's page (docs/wireframes, screen 4; #250): its figures, its positions by
// ISIN and its operations, at cost until prices come (#251). Value, net contributions, gain and
// annualised return (#252) join the figures' row as boxes of their own; nothing here assumes there
// are three.

/** What an operation is, in the order the form offers them. */
const INVESTMENT_KINDS = ["deposit", "withdrawal", "purchase", "sale", "dividend", "fee"] as const;

export type InvestmentKind = (typeof INVESTMENT_KINDS)[number];

/**
 * Money in or out of the account (a deposit, a withdrawal), told apart from what happens inside it
 * (a trade, a dividend, a fee) by its icon: the wireframe's note 5.
 */
const KIND_ICONS = {
  deposit: "transfer",
  withdrawal: "transfer",
  purchase: "investments",
  sale: "investments",
  dividend: "savings",
  fee: "merchant",
} as const satisfies { [Kind in InvestmentKind]: IconName };

export type InvestmentFiguresProps = {
  /** The account's institution, as a chip ("Northbank"). */
  institution?: string;
  /** Its tax envelope, already worded, as a chip ("PEA"). */
  envelope?: string;
  /** Said as a chip when the account is closed, already worded ("Closed on 3 Feb."). */
  closed?: string;
  /** Its balance today: the money not in a position. */
  cash: Money;
  /** What its open positions cost. */
  positionsCost: Money;
};

/**
 * An investment account's headline figures (docs/wireframes, screen 4, block 1): its institution
 * and envelope as chips, then its cash, its positions at cost and their total with the cash. Each
 * figure is a box of its own in a row that wraps, so that the value, the net contributions, the
 * gain and the annualised return join it later.
 *
 * Motion: when a figure changes (an operation entered), its digits roll to the new value (200 ms,
 * ease-out; `Amount`). Cut under reduced motion.
 */
export function InvestmentFigures({
  institution,
  envelope,
  closed,
  cash,
  positionsCost,
}: InvestmentFiguresProps) {
  const messages = useUiMessages().investments;
  const locale = usePageLanguage();
  const hasChips = institution !== undefined || envelope !== undefined || closed !== undefined;

  return (
    <div data-slot="investment-figures" className="flex flex-col gap-3">
      {hasChips ? (
        <div className="flex flex-wrap gap-2">
          {envelope === undefined ? null : <Chip>{envelope}</Chip>}
          {institution === undefined ? null : <Chip>{institution}</Chip>}
          {closed === undefined ? null : <Chip>{closed}</Chip>}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <FigureBox label={messages.totalAtCost}>
          <Amount
            value={{ ...cash, minor: cash.minor + positionsCost.minor }}
            size="lg"
            locale={locale}
          />
        </FigureBox>
        <FigureBox label={messages.positionsAtCost}>
          <Amount value={positionsCost} size="lg" locale={locale} />
        </FigureBox>
        <FigureBox label={messages.cash}>
          <Amount value={cash} size="lg" locale={locale} />
        </FigureBox>
      </div>
    </div>
  );
}

/** `InvestmentFigures` on its way: the chips' place and three figures, at the same heights. */
export function InvestmentFiguresSkeleton() {
  return (
    <SkeletonFrame>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border p-3 sm:w-36">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  );
}

export type PositionRow = {
  id: string;
  /** The security's name ("World index ETF"). */
  name: string;
  isin: string | null;
  /** Exact, as Gousset holds it (`2.9791`); below zero for an incomplete position. */
  quantity: string;
  /** What one unit held cost; null when nothing is held. */
  averageCost: UnitAmount | null;
  /** What the quantity held cost, fees included. */
  cost: Money;
  /** More was sold than held: some earlier operations are missing. */
  incomplete: boolean;
};

export type PositionsTableProps = {
  /** Open positions, by name, as the account holds them. */
  positions: ReadonlyArray<PositionRow>;
  /** The account's cash, its last row. */
  cash: Money;
  /** The table's caption, for screen readers ("Positions of Northbank PEA, at cost"). */
  label: string;
};

const headClasses = "py-2 pr-3 text-xs font-medium text-muted-foreground";

/**
 * An investment account's positions by ISIN (docs/wireframes, screen 4, block 4), at cost: the
 * security, its ISIN, the units held, their average cost and what they cost; then the cash. An
 * incomplete position says that some earlier operations are missing. On a phone the ISIN goes
 * under the name and the average cost leaves, so that the units and the cost stay side by side.
 *
 * Motion: the rows fade and slide up on first paint (200 ms, staggered); a cost that changes rolls
 * to its new value (200 ms). Cut under reduced motion.
 */
export function PositionsTable({ positions, cash, label }: PositionsTableProps) {
  const messages = useUiMessages().investments;
  const locale = usePageLanguage();

  return (
    <table data-slot="positions" className="w-full text-sm tabular-nums">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="border-b text-left">
          <th scope="col" className={headClasses}>
            {messages.position}
          </th>
          <th scope="col" className={cn(headClasses, "hidden sm:table-cell")}>
            {messages.isin}
          </th>
          <th scope="col" className={cn(headClasses, "text-right")}>
            {messages.units}
          </th>
          <th scope="col" className={cn(headClasses, "hidden text-right md:table-cell")}>
            {messages.averageCost}
          </th>
          <th scope="col" className={cn(headClasses, "pr-0 text-right")}>
            {messages.cost}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {positions.length === 0 ? (
          <tr>
            <td colSpan={5} className="py-3 text-muted-foreground">
              {messages.noPosition}
            </td>
          </tr>
        ) : null}
        {positions.map((position, index) => (
          <tr
            key={position.id}
            className={cn(
              "animate-in duration-200 fade-in fill-mode-both slide-in-from-bottom-1",
              staggerDelay(index),
            )}
          >
            <th scope="row" className="py-3 pr-3 text-left align-top font-medium break-words">
              <span className="flex flex-col gap-0.5">
                <span>{position.name}</span>
                {position.isin === null ? null : (
                  <span className="font-mono text-xs font-normal text-muted-foreground sm:hidden">
                    {position.isin}
                  </span>
                )}
                {position.incomplete ? (
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Icon name="warning" size="sm" />
                    {messages.incomplete}
                  </span>
                ) : null}
              </span>
            </th>
            <td className="hidden py-3 pr-3 align-top font-mono text-xs text-muted-foreground sm:table-cell">
              {position.isin}
            </td>
            <td className="py-3 pr-3 text-right align-top whitespace-nowrap">
              {formatQuantity(position.quantity, locale)}
            </td>
            <td className="hidden py-3 pr-3 text-right align-top whitespace-nowrap md:table-cell">
              {position.averageCost === null
                ? null
                : formatUnitAmount(position.averageCost, locale)}
            </td>
            <td className="py-3 text-right align-top">
              <Amount value={position.cost} size="sm" locale={locale} />
            </td>
          </tr>
        ))}
        <tr>
          <th scope="row" className="py-3 pr-3 text-left font-medium">
            {messages.cash}
          </th>
          <td className="hidden sm:table-cell" />
          <td />
          <td className="hidden md:table-cell" />
          <td className="py-3 text-right">
            <Amount value={cash} size="sm" locale={locale} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** `PositionsTable` on its way: as many rows as it will show, then the cash's, same heights. */
export function PositionsTableSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col divide-y">
        <div className="flex h-9 items-center">
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: rows + 1 }, (_, row) => (
          <div key={row} className="flex h-12 items-center gap-3">
            <Skeleton className="h-3.5 min-w-0 flex-1" />
            <Skeleton className="h-3.5 w-12 shrink-0" />
            <Skeleton className="h-3.5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

export type InvestmentOperationRow = {
  id: string;
  /** Already worded ("14 Oct."). */
  day: string;
  kind: InvestmentKind;
  /** The cash it moved, signed: a purchase's is negative. */
  amount: Money;
  /** A purchase's, a sale's and a dividend's security; a fee's when it names one. */
  security: string | null;
  /** A purchase's and a sale's, exact (`2.9791`). */
  quantity: string | null;
  /** A dividend's withholding tax, said after its security when there is one. */
  fees: Money;
  /** A deposit or a withdrawal paired with the other account's line, as a transfer. */
  paired: boolean;
};

export type InvestmentOperationsProps = {
  /** Newest first, as the page orders them. */
  rows: ReadonlyArray<InvestmentOperationRow>;
  /** What the list is, for screen readers ("Operations of Northbank PEA"). */
  label: string;
  /** The row just entered or corrected: it slides in from the side. */
  justChanged?: string;
  /** Offers to correct each row; left out, the rows are read only. */
  onCorrect?: (id: string) => void;
  /** Offers to delete each row. */
  onDelete?: (id: string) => void;
  /** "Show older operations": left out, every operation is shown. */
  onShowOlder?: () => void;
  loadingOlder?: boolean;
  /** Shown under the button when loading older operations failed. */
  olderError?: string;
  /** The page's own words for an account with no operation; a general sentence otherwise. */
  emptyText?: string;
};

/** What a row says after its kind: its units and security, or what else tells it apart. */
function detailOf(
  row: InvestmentOperationRow,
  messages: ReturnType<typeof useUiMessages>["investments"],
  locale: string,
): string | null {
  switch (row.kind) {
    case "purchase":
    case "sale": {
      return row.quantity === null || row.security === null
        ? row.security
        : messages.unitsOf(
            Number(row.quantity),
            formatQuantity(row.quantity, locale),
            row.security,
          );
    }

    case "dividend": {
      const tax = row.fees.minor > 0 ? messages.tax(formatMoney(row.fees, { locale })) : null;

      return [row.security, tax].filter((part) => part !== null).join(", ") || null;
    }

    case "fee": {
      return row.security;
    }

    case "deposit":
    case "withdrawal": {
      return row.paired ? messages.betweenAccounts : null;
    }
  }
}

/**
 * An investment account's operations (docs/wireframes, screen 4, block 5), newest first: the day,
 * the kind with its icon, what it moved (units of a security, a dividend's tax), and the cash,
 * money in coloured as the operations screen colours it. A deposit and a withdrawal (money coming
 * in or going out of the account) wear the transfer's icon, a trade the investments', so that the
 * two never read alike. `onCorrect` and `onDelete` add a row's buttons; `onShowOlder` a button
 * under the list.
 *
 * Motion: the row just entered or corrected slides in from the side and fades in (200 ms,
 * ease-out), as a newly added account does; a deleted row leaves at once. Cut under reduced
 * motion.
 */
export function InvestmentOperations({
  rows,
  label,
  justChanged,
  onCorrect,
  onDelete,
  onShowOlder,
  loadingOlder,
  olderError,
  emptyText,
}: InvestmentOperationsProps) {
  const messages = useUiMessages().investments;
  const locale = usePageLanguage();

  if (rows.length === 0) {
    return (
      <p
        data-slot="investment-operations"
        className="flex min-h-10 items-center text-sm text-muted-foreground"
      >
        {emptyText ?? messages.noOperation}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={label} data-slot="investment-operations" className="flex flex-col divide-y">
        {rows.map((row) => {
          const detail = detailOf(row, messages, locale);

          return (
            <li
              key={row.id}
              data-kind={row.kind}
              className={cn(
                "flex min-h-12 items-center gap-3 py-2 text-sm",
                row.id === justChanged &&
                  "animate-in duration-200 ease-out fade-in fill-mode-both slide-in-from-left-2",
              )}
            >
              <span className="w-14 shrink-0 text-muted-foreground sm:w-16">{row.day}</span>
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="flex text-muted-foreground">
                    <Icon name={KIND_ICONS[row.kind]} />
                  </span>
                  {messages.kinds[row.kind]}
                </span>
                {detail === null ? null : (
                  <span className="truncate text-muted-foreground">{detail}</span>
                )}
              </span>
              <span className="flex shrink-0 justify-end sm:w-28">
                <Amount
                  value={row.amount}
                  sign="always"
                  tone={row.amount.minor > 0 ? "in" : "neutral"}
                  size="sm"
                  locale={locale}
                  roll={false}
                />
              </span>
              {onCorrect === undefined && onDelete === undefined ? null : (
                <span className="flex shrink-0">
                  {onCorrect === undefined ? null : (
                    <IconButton
                      icon="edit"
                      label={messages.correct}
                      size="sm"
                      onClick={() => onCorrect(row.id)}
                    />
                  )}
                  {onDelete === undefined ? null : (
                    <IconButton
                      icon="delete"
                      label={messages.delete}
                      size="sm"
                      onClick={() => onDelete(row.id)}
                    />
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {onShowOlder === undefined ? null : (
        <div className="flex flex-col items-start gap-2">
          <Button variant="secondary" size="sm" onClick={onShowOlder} loading={loadingOlder}>
            {messages.showOlder}
          </Button>
          <FormMessage message={olderError} />
        </div>
      )}
    </div>
  );
}

/** `InvestmentOperations` on its way: as many rows as the loaded list shows, same height. */
export function InvestmentOperationsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonFrame>
      <div className="flex flex-col divide-y">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex h-12 items-center gap-3">
            <Skeleton className="h-3.5 w-10 shrink-0" />
            <Skeleton className="h-3.5 min-w-0 flex-1" />
            <AmountSkeleton size="sm" />
          </div>
        ))}
      </div>
    </SkeletonFrame>
  );
}

/** What the operation form holds, as typed: the amount without its sign, which the kind gives. */
export type OperationFormValues = {
  kind: InvestmentKind;
  bookedOn: string;
  /** Minor units, as typed (no sign); null while empty or unreadable. */
  amountMinor: number | null;
  isin: string;
  securityName: string;
  /** As typed, with a comma or a point. */
  quantity: string;
  unitPrice: string;
  /** Fees, or a dividend's withholding tax; null while empty (none). */
  feesMinor: number | null;
};

/** Why the server refused the form, under the field at fault, or under the form. */
export type OperationFormErrors = {
  form?: string;
  bookedOn?: string;
  amount?: string;
  isin?: string;
  quantity?: string;
  unitPrice?: string;
  fees?: string;
};

export type OperationFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  /** The account's currency: the amount's and the fees' decimals. */
  currency: string;
  /** What the form starts from; a page that opens it anew changes its `key`. */
  initial: OperationFormValues;
  errors?: OperationFormErrors;
  /** While the form is sent: nothing closes it, its button is busy. */
  sending?: boolean;
  onSubmit: (values: OperationFormValues) => void;
  /** Something was typed: the page takes its refusal away. */
  onInput?: () => void;
  /**
   * What a purchase's or a sale's quantity, unit price and fees give as its amount, in minor units
   * without its sign; null when they give none. Left out, the amount is never prefilled.
   */
  tradeAmount?: (values: OperationFormValues) => number | null;
};

/** What the amount of a kind holds, when it is more than the cash it moved. */
function amountHelpOf(
  kind: InvestmentKind,
  messages: ReturnType<typeof useUiMessages>["investments"],
): string | undefined {
  switch (kind) {
    case "purchase": {
      return messages.fields.amountPaid;
    }

    case "sale": {
      return messages.fields.amountReceived;
    }

    case "dividend": {
      return messages.fields.amountDividend;
    }

    case "deposit":
    case "withdrawal":
    case "fee": {
      return undefined;
    }
  }
}

/** The kinds that trade units of a security. */
const isTrade = (kind: InvestmentKind) => kind === "purchase" || kind === "sale";

/** The kinds that name a security: a fee may, a deposit and a withdrawal never. */
const namesSecurity = (kind: InvestmentKind) => isTrade(kind) || kind === "dividend";

/**
 * What the amount's field says under it: what the amount of its kind holds, then, for a trade whose
 * amount differs from what its quantity, price and fees give, what they give.
 */
function useAmountHelp(
  values: OperationFormValues,
  currency: string,
  tradeAmount: OperationFormProps["tradeAmount"],
): string | undefined {
  const messages = useUiMessages().investments;
  const locale = usePageLanguage();
  const { kind, amountMinor } = values;
  const computed = isTrade(kind) ? (tradeAmount?.(values) ?? null) : null;
  const help = amountHelpOf(kind, messages);

  if (computed === null || amountMinor === null || amountMinor === computed || help === undefined) {
    return help;
  }

  const said = kind === "sale" ? messages.computedSale : messages.computedPurchase;

  return `${help} ${said(formatMoney({ minor: computed, currency }, { locale }))}`;
}

type TradeFieldsProps = {
  values: OperationFormValues;
  errors: OperationFormErrors;
  onChange: (next: Partial<OperationFormValues>) => void;
};

/** A purchase's or a sale's own fields: the security's name, the quantity and the unit price. */
function TradeFields({ values, errors, onChange }: TradeFieldsProps) {
  const messages = useUiMessages().investments;

  return (
    <>
      <TextField
        label={messages.fields.securityName}
        description={messages.fields.securityNameHelp}
        value={values.securityName}
        onChange={(event) => onChange({ securityName: event.target.value })}
        autoComplete="off"
        maxLength={200}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={messages.fields.quantity}
          description={messages.fields.decimalHelp}
          value={values.quantity}
          onChange={(event) => onChange({ quantity: event.target.value })}
          error={errors.quantity}
          inputMode="decimal"
          autoComplete="off"
          required
        />
        <TextField
          label={messages.fields.unitPrice}
          description={messages.fields.decimalHelp}
          value={values.unitPrice}
          onChange={(event) => onChange({ unitPrice: event.target.value })}
          error={errors.unitPrice}
          inputMode="decimal"
          autoComplete="off"
          required
        />
      </div>
    </>
  );
}

/**
 * An operation entered or corrected by hand, in a dialog (docs/design.md, "Actions and forms"):
 * its kind first, and the fields that kind takes. A deposit and a withdrawal take a day and an
 * amount; a purchase and a sale the security's ISIN and name, the quantity, the unit price, the
 * fees and the amount the cash paid or received; a dividend its ISIN, the amount paid in and the
 * tax withheld; a fee a day, an amount and, when charged on one security, its ISIN. Quantities and
 * prices are typed with a comma or a point; the amount without its sign. A refusal shows under its
 * field.
 *
 * A trade's amount follows what its quantity, price and fees give (`tradeAmount`) until one is
 * typed: then it is the user's (a broker rounds its own way) and is kept; emptied, it follows again
 * at the next change. An amount that differs from what they give is said under it, never refused.
 * An operation corrected starts with its own amount, kept.
 *
 * Motion: as `Dialog` (fades and grows in 200 ms, rises from the bottom on a phone in 300 ms); the
 * fields of another kind, the amount prefilled and the difference under it appear at once, with no
 * motion. Cut under reduced motion.
 */
export function OperationForm({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  currency,
  initial,
  errors = {},
  sending = false,
  onSubmit,
  onInput,
  tradeAmount,
}: OperationFormProps) {
  const messages = useUiMessages().investments;
  const [values, setValues] = useState(initial);
  // An amount given (typed, or the operation's own when corrected) is kept; none follows the trade.
  // Read only when a field changes, never drawn: a ref, not a state.
  const amountTyped = useRef(initial.amountMinor !== null);
  // Each prefill writes the amount field anew: its text is its own once mounted (`MoneyField`).
  const [prefills, setPrefills] = useState(0);
  const { kind } = values;

  const change = (next: Partial<OperationFormValues>) => {
    const merged = { ...values, ...next };

    const prefill =
      amountTyped.current || !isTrade(merged.kind) ? undefined : tradeAmount?.(merged);

    if (prefill === undefined || prefill === merged.amountMinor) {
      setValues(merged);
    } else {
      setValues({ ...merged, amountMinor: prefill });
      setPrefills((count) => count + 1);
    }

    onInput?.();
  };

  const typeAmount = (minor: number | null) => {
    amountTyped.current = minor !== null;
    setValues((current) => ({ ...current, amountMinor: minor }));
    onInput?.();
  };

  const amountHelp = useAmountHelp(values, currency, tradeAmount);

  return (
    <Dialog
      title={title}
      description={description}
      open={open}
      onOpenChange={onOpenChange}
      sending={sending}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
      actions={
        <Button type="submit" loading={sending}>
          {submitLabel}
        </Button>
      }
    >
      <Select
        label={messages.fields.kind}
        items={INVESTMENT_KINDS.map((each) => ({ value: each, label: messages.kinds[each] }))}
        value={kind}
        onValueChange={(next) => {
          const chosen = INVESTMENT_KINDS.find((each) => each === next);

          if (chosen !== undefined) {
            change({ kind: chosen });
          }
        }}
        required
      />
      <DatePicker
        label={messages.fields.day}
        value={values.bookedOn}
        onValueChange={(day) => change({ bookedOn: day ?? values.bookedOn })}
        error={errors.bookedOn}
        required
      />
      {kind === "deposit" || kind === "withdrawal" ? null : (
        <TextField
          label={messages.fields.isin}
          description={kind === "fee" ? messages.fields.isinOptional : messages.fields.isinHelp}
          value={values.isin}
          onChange={(event) => change({ isin: event.target.value })}
          error={errors.isin}
          required={namesSecurity(kind)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
        />
      )}
      {isTrade(kind) ? <TradeFields values={values} errors={errors} onChange={change} /> : null}
      <MoneyField
        key={prefills}
        label={messages.fields.amount}
        description={amountHelp}
        currency={currency}
        defaultValue={values.amountMinor}
        onValueChange={typeAmount}
        error={errors.amount}
        required
      />
      {isTrade(kind) || kind === "dividend" ? (
        <MoneyField
          label={kind === "dividend" ? messages.fields.tax : messages.fields.fees}
          currency={currency}
          defaultValue={values.feesMinor}
          onValueChange={(minor) => change({ feesMinor: minor })}
          error={errors.fees}
        />
      ) : null}
      <FormMessage message={errors.form} />
    </Dialog>
  );
}
