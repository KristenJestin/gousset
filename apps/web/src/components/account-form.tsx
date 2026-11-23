import type { BalanceCategory, CategoryTree, EntryKind } from "@gousset/core";
import type { AccountChoice, AccountMode, CreditOrder } from "@gousset/core/account-values";
import { ACCOUNT_CHOICES } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Combobox } from "@gousset/ui/components/combobox";
import { DatePicker } from "@gousset/ui/components/date-picker";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { Select } from "@gousset/ui/components/select";
import type { ChoiceItem } from "@gousset/ui/components/select";
import { TextField } from "@gousset/ui/components/text-field";
import { useUiMessages } from "@gousset/ui/hooks/use-ui-messages";
import { CURRENCY_CODES } from "@gousset/ui/lib/money";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { accountRefusalMessage } from "@/i18n/messages";
import { accountChoiceLabel } from "@/lib/account-labels";
import { creditOrderLabel } from "@/lib/benefit-credits";
import { categoryPath, choicesOf, shownPath } from "@/lib/categories";
import { whileBusy } from "@/lib/while-busy";
import { categoryQueries } from "@/queries/categories";

/** What the create and edit forms send: `AccountInput`'s shape, with `institution` never `undefined`. */
export type AccountFormValues = {
  name: string;
  choice: AccountChoice;
  institution: string;
  currency: string;
  mode: AccountMode;
  openingBalanceMinor: number;
  openedOn: string | null;
  settlesIntoAccountId: string | null;
  /**
   * A benefit account's order of use; `null` when it is not known (a benefit account kept by its
   * balance), which leaves it as it is.
   */
  creditOrder: CreditOrder | null;
  /**
   * An account kept by its balance: the category its movements go to (#31); `null` for none, each
   * movement then going to its kind's fallback. Not sent for an account kept by its lines, which
   * keeps it.
   */
  balanceCategoryId: string | null;
};

/** What a submit answers: the id of the account written (new, or the one edited), or a refusal. */
export type AccountFormResult = { ok: true; id?: string } | { ok: false; code: string };

const CHOICE_SET: ReadonlySet<string> = new Set(ACCOUNT_CHOICES);

function isAccountChoice(value: string): value is AccountChoice {
  return CHOICE_SET.has(value);
}

const MODE_SET: ReadonlySet<string> = new Set([
  "lines",
  "balance",
] satisfies ReadonlyArray<AccountMode>);

function isAccountMode(value: string): value is AccountMode {
  return MODE_SET.has(value);
}

const CREDIT_ORDERS = [
  "oldest_first",
  "expiring_first",
] as const satisfies ReadonlyArray<CreditOrder>;

const CREDIT_ORDER_SET: ReadonlySet<string> = new Set(CREDIT_ORDERS);

function isCreditOrder(value: string): value is CreditOrder {
  return CREDIT_ORDER_SET.has(value);
}

/** Every currency an account can be opened in, by its ISO 4217 code alone. */
const CURRENCY_ITEMS: ReadonlyArray<ChoiceItem> = CURRENCY_CODES.map((code) => ({
  value: code,
  label: code,
}));

/** `AccountFormValues` as `createAccount` and `editAccount` take them (`AccountInput`'s shape). */
export function accountFormInput(values: AccountFormValues) {
  return {
    name: values.name,
    choice: values.choice,
    institution: values.institution.trim() === "" ? undefined : values.institution,
    currency: values.currency,
    mode: values.mode,
    openingBalanceMinor: values.openingBalanceMinor,
    openedOn: values.openedOn ?? undefined,
    settlesIntoAccountId: values.settlesIntoAccountId ?? undefined,
    creditOrder: values.choice === "benefit" ? (values.creditOrder ?? undefined) : undefined,
    // None is sent as `null`, which clears it; left out, an edit keeps the account's own.
    balanceCategoryId: values.mode === "balance" ? values.balanceCategoryId : undefined,
  };
}

/** The category field's value for none: a category's id is a UUID, never this word. */
const NO_CATEGORY = "none";

/** A category's path with its kind, so that two of the same name stay apart: "Other (income)". */
function withKind(kind: EntryKind, path: string): string {
  return kind === "expense"
    ? m.accountFormCategoryExpense({ name: path })
    : m.accountFormCategoryIncome({ name: path });
}

/**
 * The categories an account kept by its balance can send its movements to: none, then the user's
 * expense and income categories in use, each top-level one before its children; and the account's
 * own when it is archived, which it keeps.
 */
function balanceCategoryItems(
  tree: CategoryTree | undefined,
  current: BalanceCategory | null,
): ReadonlyArray<ChoiceItem> {
  const inUse = (["expense", "income"] as const).flatMap((kind) =>
    (tree === undefined ? [] : choicesOf(tree, kind)).flatMap((top) => [
      { value: top.id, label: withKind(kind, top.name) },
      ...top.children.map((child) => ({
        value: child.id,
        label: withKind(kind, categoryPath({ name: child.name, parentName: top.name })),
      })),
    ]),
  );

  const kept =
    current === null || inUse.some((item) => item.value === current.id)
      ? []
      : [
          {
            value: current.id,
            label: withKind(
              current.kind,
              current.archived
                ? m.accountBalanceCategoryArchived({ name: shownPath(current.name) })
                : shownPath(current.name),
            ),
          },
        ];

  return [{ value: NO_CATEGORY, label: m.accountBalanceCategoryNone() }, ...inUse, ...kept];
}

export type AccountFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: AccountFormValues;
  /** The user's open current accounts, for a card's "settles into"; by id and name. */
  settlesIntoChoices: ReadonlyArray<{ id: string; name: string }>;
  /**
   * The account's category as it is, for an account kept by its balance: still offered when it is
   * archived, which no other account may choose.
   */
  balanceCategory?: BalanceCategory | null;
  onSubmit: (values: AccountFormValues) => Promise<AccountFormResult>;
  /** Called once a write succeeds, before the dialog closes, with the account's id when given. */
  onSaved?: (accountId: string | undefined) => void;
};

/**
 * The account create and edit form, a `Dialog` composed of `packages/ui` fields: name, kind,
 * institution, currency, tracking, opening balance, opened on and, for a card, the current account
 * it settles into; for a benefit account, the order its credits are used in; for an account kept by
 * its balance, the category its movements go to, among the categories it reads itself (the page's
 * loader reads them first). `key`d by the account's id (or "new") at the call site so that editing
 * another account starts from its own values.
 */
export function AccountForm({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  settlesIntoChoices,
  balanceCategory = null,
  onSubmit,
  onSaved,
}: AccountFormProps) {
  const messages = useUiMessages();
  const { data: categories } = useQuery(categoryQueries.list());
  const formId = useId();
  const [name, setName] = useState(initial.name);
  const [choice, setChoice] = useState<AccountChoice>(initial.choice);
  const [institution, setInstitution] = useState(initial.institution);
  const [currency, setCurrency] = useState(initial.currency);
  const [openingBalanceInvalid, setOpeningBalanceInvalid] = useState(false);
  const [mode, setMode] = useState<AccountMode>(initial.mode);
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState(initial.openingBalanceMinor);
  const [openedOn, setOpenedOn] = useState<string | null>(initial.openedOn);

  const [settlesIntoAccountId, setSettlesIntoAccountId] = useState<string | null>(
    initial.settlesIntoAccountId,
  );

  const [creditOrder, setCreditOrder] = useState<CreditOrder | null>(initial.creditOrder);

  const [balanceCategoryId, setBalanceCategoryId] = useState<string | null>(
    initial.balanceCategoryId,
  );

  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const choiceItems: ReadonlyArray<ChoiceItem> = ACCOUNT_CHOICES.map((value) => ({
    value,
    label: accountChoiceLabel(value),
  }));

  const modeItems: ReadonlyArray<ChoiceItem> = [
    { value: "lines", label: messages.accounts.trackingLines },
    { value: "balance", label: messages.accounts.trackingBalance },
  ];

  const creditOrderItems: ReadonlyArray<ChoiceItem> = CREDIT_ORDERS.map((value) => ({
    value,
    label: creditOrderLabel(value),
  }));

  const settlesItems: ReadonlyArray<ChoiceItem> = settlesIntoChoices.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  function onChoiceChange(value: string | null) {
    if (value !== null && isAccountChoice(value)) {
      setChoice(value);
    }
  }

  function onModeChange(value: string | null) {
    if (value !== null && isAccountMode(value)) {
      setMode(value);
    }
  }

  function onCreditOrderChange(value: string | null) {
    if (value !== null && isCreditOrder(value)) {
      setCreditOrder(value);
    }
  }

  async function submit() {
    if (openingBalanceInvalid) {
      return;
    }

    const result = await whileBusy(setBusy, () =>
      onSubmit({
        name,
        choice,
        institution,
        currency,
        mode,
        openingBalanceMinor,
        openedOn,
        settlesIntoAccountId: choice === "card" ? settlesIntoAccountId : null,
        creditOrder: choice === "benefit" ? creditOrder : null,
        balanceCategoryId: mode === "balance" ? balanceCategoryId : null,
      }),
    );

    if (!result.ok) {
      setError(accountRefusalMessage(result.code));

      return;
    }

    setError(undefined);
    onSaved?.(result.id);
    onOpenChange(false);
  }

  return (
    <Dialog
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <DialogClose>
            <Button type="button" variant="secondary">
              {m.uiCancel()}
            </Button>
          </DialogClose>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        <TextField
          label={m.fieldName()}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          required
        />
        <Select
          label={m.fieldKind()}
          items={choiceItems}
          value={choice}
          onValueChange={onChoiceChange}
          required
        />
        <TextField
          label={m.fieldInstitution()}
          value={institution}
          onChange={(event) => setInstitution(event.target.value)}
          autoComplete="off"
        />
        <Combobox
          label={m.fieldCurrency()}
          placeholder={m.fieldCurrencyPlaceholder()}
          items={CURRENCY_ITEMS}
          value={currency}
          onValueChange={(value) => setCurrency(value ?? currency)}
          required
        />
        <Select
          label={m.fieldMode()}
          items={modeItems}
          value={mode}
          onValueChange={onModeChange}
          required
        />
        {mode === "balance" ? (
          <Combobox
            label={m.fieldBalanceCategory()}
            description={m.fieldBalanceCategoryDescription()}
            placeholder={m.categoriesSearch()}
            items={balanceCategoryItems(categories, balanceCategory)}
            value={balanceCategoryId ?? NO_CATEGORY}
            onValueChange={(value) =>
              setBalanceCategoryId(value === null || value === NO_CATEGORY ? null : value)
            }
          />
        ) : null}
        <MoneyField
          label={m.fieldOpeningBalance()}
          currency={currency}
          value={openingBalanceMinor}
          error={openingBalanceInvalid ? m.fieldOpeningBalanceInvalid() : undefined}
          onValueChange={(minor) => {
            setOpeningBalanceInvalid(minor === null);

            if (minor !== null) {
              setOpeningBalanceMinor(minor);
            }
          }}
        />
        <DatePicker label={m.fieldOpenedOn()} value={openedOn} onValueChange={setOpenedOn} />
        {choice === "card" ? (
          <Select
            label={m.fieldSettlesInto()}
            items={settlesItems}
            value={settlesIntoAccountId}
            onValueChange={setSettlesIntoAccountId}
            required
          />
        ) : null}
        {choice === "benefit" ? (
          <Select
            label={m.fieldCreditOrder()}
            items={creditOrderItems}
            value={creditOrder}
            onValueChange={onCreditOrderChange}
          />
        ) : null}
        <FormMessage message={error} />
      </form>
    </Dialog>
  );
}
