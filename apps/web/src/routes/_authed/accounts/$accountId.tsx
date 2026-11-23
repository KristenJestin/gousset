import type { AccountLine } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { AccountFigures, AccountFiguresSkeleton } from "@gousset/ui/components/account-figures";
import { AccountLines, AccountLinesSkeleton } from "@gousset/ui/components/account-lines";
import type { AccountLineRow } from "@gousset/ui/components/account-lines";
import { AccountSettings, AccountSettingsSkeleton } from "@gousset/ui/components/account-settings";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { BalanceChart, BalanceChartSkeleton } from "@gousset/ui/components/balance-chart";
import { BalanceCheck, BalanceCheckSkeleton } from "@gousset/ui/components/balance-check";
import { Button } from "@gousset/ui/components/button";
import { DatePicker } from "@gousset/ui/components/date-picker";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useId, useState } from "react";

import { AccountForm, accountFormInput } from "@/components/account-form";
import type { AccountFormResult, AccountFormValues } from "@/components/account-form";
import { DataBlock } from "@/components/data-block";
import {
  closeAccount,
  editAccount,
  getAccount,
  noteAccountBalance,
  reopenAccount,
} from "@/functions/accounts";
import { accountRefusalMessage } from "@/i18n/messages";
import { longDay, monthLabel, shortDay } from "@/lib/account-day";
import { accountChoiceLabel, accountGroupLabel } from "@/lib/account-labels";
import { whileBusy } from "@/lib/while-busy";
import { accountQueries, invalidateAccounts } from "@/queries/accounts";

export const Route = createFileRoute("/_authed/accounts/$accountId")({
  loader: async ({ context: { queryClient }, params }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(accountQueries.detail(params.accountId)),
      queryClient.ensureQueryData(accountQueries.list()),
    ]);

    if (!detail.ok) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
      throw notFound();
    }
  },
  notFoundComponent: AccountNotFound,
  component: AccountPage,
});

function AccountNotFound() {
  return (
    <Page title={m.accountNotFoundTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="accounts"
          title={m.accountNotFoundTitle()}
          description={m.accountNotFoundDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}

/** The detail, unwrapped: the loader already turned a refusal into "not found" before this runs. */
function useAccountDetail(accountId: string) {
  const { data } = useSuspenseQuery(accountQueries.detail(accountId));

  if (!data.ok) {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
    throw notFound();
  }

  return data.account;
}

function AccountPage() {
  const { accountId } = Route.useParams();
  const detail = useAccountDetail(accountId);
  const { account } = detail;
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closedOn, setClosedOn] = useState(detail.day);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string>();
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState<string>();

  const { data: list } = useSuspenseQuery(accountQueries.list());

  const settlesIntoChoices = list.groups
    .flatMap((group) => group.accounts)
    .filter((candidate) => candidate.kind === "current" && candidate.id !== account.id)
    .map((candidate) => ({ id: candidate.id, name: candidate.name }));

  async function handleEdit(values: AccountFormValues): Promise<AccountFormResult> {
    try {
      const result = await editAccount({
        data: { accountId: account.id, settings: accountFormInput(values) },
      });

      if (!result.ok) {
        return result;
      }

      await invalidateAccounts(queryClient);

      return { ok: true };
    } catch {
      return { ok: false, code: "UNKNOWN" };
    }
  }

  async function handleClose() {
    const result = await whileBusy(setCloseBusy, () =>
      closeAccount({ data: { accountId: account.id, closedOn } }),
    );

    if (!result.ok) {
      setCloseError(accountRefusalMessage(result.code));

      return;
    }

    setCloseError(undefined);
    await invalidateAccounts(queryClient);
    setCloseOpen(false);
  }

  async function handleReopen() {
    const result = await whileBusy(setReopenBusy, () =>
      reopenAccount({ data: { accountId: account.id } }),
    );

    if (!result.ok) {
      setReopenError(accountRefusalMessage(result.code));

      return;
    }

    setReopenError(undefined);
    await invalidateAccounts(queryClient);
  }

  return (
    <Page
      title={account.name}
      actions={
        account.closedOn === null ? (
          <Button
            variant="secondary"
            loading={closeBusy}
            onClick={() => {
              setClosedOn(detail.day);
              setCloseOpen(true);
            }}
          >
            {m.accountClose()}
          </Button>
        ) : (
          <Button variant="secondary" loading={reopenBusy} onClick={() => void handleReopen()}>
            {m.accountReopen()}
          </Button>
        )
      }
    >
      {account.closedOn === null ? null : <FormMessage message={reopenError} />}
      <DataBlock
        title={m.accountBlockFigures()}
        skeleton={<AccountFiguresSkeleton />}
        resetKey={accountId}
      >
        <Figures accountId={accountId} />
      </DataBlock>
      <DataBlock
        title={m.accountBlockCheck()}
        skeleton={<BalanceCheckSkeleton />}
        resetKey={accountId}
      >
        <Check accountId={accountId} />
      </DataBlock>
      <DataBlock
        title={m.accountBlockChart()}
        skeleton={<BalanceChartSkeleton />}
        resetKey={accountId}
      >
        <Chart accountId={accountId} />
      </DataBlock>
      <DataBlock
        title={m.accountBlockSettings()}
        skeleton={<AccountSettingsSkeleton />}
        resetKey={accountId}
      >
        <Settings accountId={accountId} onEdit={() => setEditOpen(true)} />
      </DataBlock>
      <DataBlock
        title={m.accountBlockLines()}
        skeleton={<AccountLinesSkeleton />}
        resetKey={accountId}
      >
        <Lines accountId={accountId} />
      </DataBlock>
      {account.mode === "balance" ? (
        <NoteBalance accountId={accountId} currency={account.currency} day={detail.day} />
      ) : null}
      <AccountForm
        key={account.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        title={m.accountFormEditTitle()}
        submitLabel={m.accountFormSaveSubmit()}
        initial={{
          name: account.name,
          choice: account.choice,
          institution: account.institution ?? "",
          currency: account.currency,
          mode: account.mode,
          openingBalanceMinor: account.openingBalance.minor,
          openedOn: account.openedOn,
          settlesIntoAccountId: account.settlesInto?.id ?? null,
        }}
        settlesIntoChoices={settlesIntoChoices}
        onSubmit={handleEdit}
      />
      <CloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        name={account.name}
        closedOn={closedOn}
        onClosedOnChange={setClosedOn}
        busy={closeBusy}
        error={closeError}
        onConfirm={() => void handleClose()}
      />
    </Page>
  );
}

function CloseDialog({
  open,
  onOpenChange,
  name,
  closedOn,
  onClosedOnChange,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  closedOn: string;
  onClosedOnChange: (day: string) => void;
  busy: boolean;
  error: string | undefined;
  onConfirm: () => void;
}) {
  const formId = useId();

  return (
    <Dialog
      title={m.accountCloseTitle({ name })}
      description={m.accountCloseDescription()}
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
            {m.accountCloseSubmit()}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <DatePicker
          label={m.fieldClosedOn()}
          value={closedOn}
          onValueChange={(day) => onClosedOnChange(day ?? closedOn)}
          required
        />
        <FormMessage message={error} />
      </form>
    </Dialog>
  );
}

function Figures({ accountId }: { accountId: string }) {
  const detail = useAccountDetail(accountId);
  const { account } = detail;
  const locale = usePageLanguage();

  return (
    <AccountFigures
      balanceDay={shortDay(detail.day, locale)}
      balance={detail.balance}
      period={monthLabel(detail.day, locale)}
      in={detail.monthIn}
      out={detail.monthOut}
      institution={account.institution ?? undefined}
      groupLabel={accountGroupLabel(account.group)}
    />
  );
}

function Check({ accountId }: { accountId: string }) {
  const detail = useAccountDetail(accountId);
  const locale = usePageLanguage();
  const { check } = detail;

  if (check === null) {
    return <BalanceCheck state="no-statement" />;
  }

  const earlierMismatches = check.earlierMismatches.map((mismatch) => ({
    day: shortDay(mismatch.day, locale),
    app: mismatch.app,
    statement: mismatch.statement,
    difference: mismatch.difference,
  }));

  return check.agrees ? (
    <BalanceCheck
      state="agrees"
      app={check.app}
      statement={check.statement}
      day={shortDay(check.day, locale)}
      earlierMismatches={earlierMismatches}
    />
  ) : (
    <BalanceCheck
      state="disagrees"
      app={check.app}
      statement={check.statement}
      day={shortDay(check.day, locale)}
      difference={check.difference}
      earlierMismatches={earlierMismatches}
    />
  );
}

function Chart({ accountId }: { accountId: string }) {
  const detail = useAccountDetail(accountId);
  const { account } = detail;

  const days = detail.daily.balances.map((balance) => ({
    date: new Date(`${balance.day}T00:00:00Z`),
    balanceMinor: balance.minor,
  }));

  return (
    <BalanceChart
      days={days}
      currency={account.currency}
      label={m.accountChartLabel({ name: account.name })}
      valueLabel={m.accountChartValueLabel()}
    />
  );
}

function Settings({ accountId, onEdit }: { accountId: string; onEdit: () => void }) {
  const { account } = useAccountDetail(accountId);
  const locale = usePageLanguage();

  return (
    <AccountSettings
      kind={accountChoiceLabel(account.choice)}
      tracking={account.mode}
      currency={account.currency}
      openedOn={account.openedOn === null ? null : longDay(account.openedOn, locale)}
      institution={account.institution ?? undefined}
      settlesInto={account.settlesInto?.name}
      action={
        <Button variant="secondary" size="sm" icon="edit" onClick={onEdit}>
          {m.accountEdit()}
        </Button>
      }
    />
  );
}

function toRow(line: AccountLine, locale: string): AccountLineRow {
  return {
    id: line.id,
    day: shortDay(line.bookedOn, locale),
    label: line.label,
    amount: line.amount,
    balanceAfter: line.balanceAfter ?? undefined,
  };
}

function Lines({ accountId }: { accountId: string }) {
  const detail = useAccountDetail(accountId);
  const { account } = detail;
  const locale = usePageLanguage();
  const [firstPage, setFirstPage] = useState(detail.lines);
  const [older, setOlder] = useState<ReadonlyArray<AccountLine>>([]);
  const [olderBefore, setOlderBefore] = useState(detail.olderBefore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();

  // The first page changed (a mutation, another account): drop whatever older lines were loaded.
  if (firstPage !== detail.lines) {
    setFirstPage(detail.lines);
    setOlder([]);
    setOlderBefore(detail.olderBefore);
    setOlderError(undefined);
  }

  async function showOlder() {
    if (olderBefore === null || loadingOlder) {
      return;
    }

    // A failed call answers `undefined`: the React Compiler has no `try` to handle in a component.
    const result = await whileBusy(setLoadingOlder, () =>
      getAccount({ data: { accountId, before: olderBefore } }).then(
        (answer) => answer,
        () => undefined,
      ),
    );

    if (result === undefined) {
      setOlderError(m.accountLinesOlderFailed());

      return;
    }

    if (result.ok) {
      setOlder((current) => [...current, ...result.account.lines]);
      setOlderBefore(result.account.olderBefore);
      setOlderError(undefined);
    } else {
      setOlderBefore(null);
    }
  }

  const rows = [...detail.lines, ...older].map((line) => toRow(line, locale));

  return (
    <AccountLines
      rows={rows}
      emptyText={account.mode === "balance" ? m.accountLinesEmptyBalance() : undefined}
      onShowOlder={olderBefore === null ? undefined : () => void showOlder()}
      loadingOlder={loadingOlder}
      olderError={olderError}
    />
  );
}

/** A balance-mode account's page: note its balance at the end of a day, one a day. */
function NoteBalance({
  accountId,
  currency,
  day,
}: {
  accountId: string;
  currency: string;
  day: string;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const locale = usePageLanguage();
  const [noteDay, setNoteDay] = useState(day);
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  async function submit() {
    if (balanceMinor === null) {
      return;
    }

    const result = await whileBusy(setBusy, () =>
      noteAccountBalance({ data: { accountId, day: noteDay, balanceMinor } }),
    );

    if (!result.ok) {
      setSaved(undefined);
      setError(accountRefusalMessage(result.code));

      return;
    }

    setError(undefined);
    setSaved(m.accountNoteBalanceSaved({ day: shortDay(noteDay, locale) }));
    setBalanceMinor(null);
    setResetKey((key) => key + 1);
    await invalidateAccounts(queryClient);
  }

  return (
    <DataBlock
      title={m.accountBlockNoteBalance()}
      skeleton={
        <p className="text-sm text-muted-foreground">{m.accountNoteBalanceDescription()}</p>
      }
      resetKey={accountId}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{m.accountNoteBalanceDescription()}</p>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <DatePicker
            label={m.fieldDay()}
            value={noteDay}
            onValueChange={(value) => setNoteDay(value ?? noteDay)}
            required
          />
          <MoneyField
            key={resetKey}
            label={m.fieldAmount()}
            currency={currency}
            onValueChange={setBalanceMinor}
            required
          />
          <Button type="submit" loading={busy}>
            {m.accountNoteBalanceSubmit()}
          </Button>
        </form>
        <FormMessage message={error} />
        <StatusMessage message={saved} />
      </div>
    </DataBlock>
  );
}
