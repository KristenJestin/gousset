import type { AccountChoice, AccountMode, CreditOrder } from "@gousset/core/account-values";
import { ACCOUNT_CHOICES } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Combobox } from "@gousset/ui/components/combobox";
import { DatePicker } from "@gousset/ui/components/date-picker";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { Select } from "@gousset/ui/components/select";
import type { ChoiceItem } from "@gousset/ui/components/select";
import { Sheet } from "@gousset/ui/components/sheet";
import { TextField } from "@gousset/ui/components/text-field";
import { useUiMessages } from "@gousset/ui/hooks/use-ui-messages";
import { CURRENCY_CODES } from "@gousset/ui/lib/money";
import { useState } from "react";

import { accountRefusalMessage } from "@/i18n/messages";
import { accountChoiceLabel } from "@/lib/account-labels";
import { creditOrderLabel } from "@/lib/benefit-credits";
import { whileBusy } from "@/lib/while-busy";

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
  };
}

export type AccountFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: AccountFormValues;
  /** The user's open current accounts, for a card's "settles into"; by id and name. */
  settlesIntoChoices: ReadonlyArray<{ id: string; name: string }>;
  onSubmit: (values: AccountFormValues) => Promise<AccountFormResult>;
  /** Called once a write succeeds, before the sheet closes, with the account's id when given. */
  onSaved?: (accountId: string | undefined) => void;
};

/**
 * The account create and edit form, a long form in a side `Sheet` (docs/design.md, "Actions and
 * forms"; a sheet along the bottom edge on a phone) composed of `packages/ui` fields: name, kind,
 * institution, currency, tracking, opening balance, opened on and, for a card, the current account
 * it settles into; for a benefit account, the order its credits are used in. `key`d by the
 * account's id (or "new") at the call site so that editing another account starts from its own
 * values. Motion: the shared `Sheet`'s, sliding in from its edge over the backdrop; cut under
 * reduced motion.
 */
export function AccountForm({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  settlesIntoChoices,
  onSubmit,
  onSaved,
}: AccountFormProps) {
  const messages = useUiMessages();
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
    <Sheet
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      // While the form is sent it stays open: its answer lands on the form that sent it.
      sending={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      }
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
    </Sheet>
  );
}
