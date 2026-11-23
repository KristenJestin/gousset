import type { AccountChoice, AccountMode } from "@gousset/core/account-values";
import { ACCOUNT_CHOICES } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { DatePicker } from "@gousset/ui/components/date-picker";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { Select } from "@gousset/ui/components/select";
import type { ChoiceItem } from "@gousset/ui/components/select";
import { TextField } from "@gousset/ui/components/text-field";
import { useUiMessages } from "@gousset/ui/hooks/use-ui-messages";
import { useId, useState } from "react";

import { accountRefusalMessage } from "@/i18n/messages";
import { accountChoiceLabel } from "@/lib/account-labels";
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
  /** Called once a write succeeds, before the dialog closes, with the account's id when given. */
  onSaved?: (accountId: string | undefined) => void;
};

/**
 * The account create and edit form, a `Dialog` composed of `packages/ui` fields: name, kind,
 * institution, currency, tracking, opening balance, opened on and, for a card, the current account
 * it settles into. `key`d by the account's id (or "new") at the call site so that editing another
 * account starts from its own values.
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
  const formId = useId();
  const [name, setName] = useState(initial.name);
  const [choice, setChoice] = useState<AccountChoice>(initial.choice);
  const [institution, setInstitution] = useState(initial.institution);
  const [currency, setCurrency] = useState(initial.currency);
  const [mode, setMode] = useState<AccountMode>(initial.mode);
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState(initial.openingBalanceMinor);
  const [openedOn, setOpenedOn] = useState<string | null>(initial.openedOn);

  const [settlesIntoAccountId, setSettlesIntoAccountId] = useState<string | null>(
    initial.settlesIntoAccountId,
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

  async function submit() {
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
        <TextField
          label={m.fieldCurrency()}
          description={m.fieldCurrencyHelp()}
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          minLength={3}
          maxLength={3}
          autoComplete="off"
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
          onValueChange={(minor) => setOpeningBalanceMinor(minor ?? 0)}
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
        <FormMessage message={error} />
      </form>
    </Dialog>
  );
}
