import type { AccountDetail, AccountLine } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { AccountFigures, AccountFiguresSkeleton } from "@gousset/ui/components/account-figures";
import { AccountLines, AccountLinesSkeleton } from "@gousset/ui/components/account-lines";
import type { AccountLineRow } from "@gousset/ui/components/account-lines";
import { AccountSettings, AccountSettingsSkeleton } from "@gousset/ui/components/account-settings";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { BalanceChart, BalanceChartSkeleton } from "@gousset/ui/components/balance-chart";
import { BalanceCheck, BalanceCheckSkeleton } from "@gousset/ui/components/balance-check";
import { BenefitCredits, BenefitCreditsSkeleton } from "@gousset/ui/components/benefit-credits";
import { Button } from "@gousset/ui/components/button";
import { DatePicker } from "@gousset/ui/components/date-picker";
import { Dialog } from "@gousset/ui/components/dialog";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import { MoneyField } from "@gousset/ui/components/money-field";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";

import { AccountForm, accountFormInput } from "@/components/account-form";
import type { AccountFormResult, AccountFormValues } from "@/components/account-form";
import { DataBlock } from "@/components/data-block";
import {
  closeAccount,
  editAccount,
  getAccount,
  noteAccountBalance,
  reopenAccount,
  setCreditExpiry,
} from "@/functions/accounts";
import { accountRefusalMessage } from "@/i18n/messages";
import { longDay, monthLabel, shortDay } from "@/lib/account-day";
import { accountChoiceLabel, accountGroupLabel } from "@/lib/account-labels";
import { shownPath } from "@/lib/categories";
import {
  OPENING_CREDIT_ID,
  benefitCreditsOf,
  creditExpiryTag,
  creditOrderLabel,
} from "@/lib/benefit-credits";
import { whileBusy } from "@/lib/while-busy";
import { accountQueries, invalidateAccounts } from "@/queries/accounts";
import { invalidateCategories } from "@/queries/categories";

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
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteOpened, setNoteOpened] = useState(0);
  const [noteSaved, setNoteSaved] = useState<string>();

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

      const movementsRemade = account.mode === "balance" || values.mode === "balance";

      // Kept by its balance, before or now: its movements were made again, which the months and
      // the categories count.
      await Promise.all([
        invalidateAccounts(queryClient),
        ...(movementsRemade ? [invalidateCategories(queryClient)] : []),
      ]);

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
        <>
          {account.mode === "balance" ? (
            <Button
              onClick={() => {
                setNoteOpened((count) => count + 1);
                setNoteOpen(true);
              }}
            >
              {m.accountBlockNoteBalance()}
            </Button>
          ) : null}
          {account.closedOn === null ? (
            <Button
              variant="secondary"
              loading={closeBusy}
              onClick={() => {
                setClosedOn(detail.day);
                setCloseError(undefined);
                setCloseOpen(true);
              }}
            >
              {m.accountClose()}
            </Button>
          ) : (
            <Button variant="secondary" loading={reopenBusy} onClick={() => void handleReopen()}>
              {m.accountReopen()}
            </Button>
          )}
        </>
      }
    >
      {account.closedOn === null ? null : <FormMessage message={reopenError} />}
      <StatusMessage message={noteSaved} />
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
      {detail.credits === null ? null : (
        <DataBlock
          title={m.accountBlockCredits()}
          skeleton={
            <BenefitCreditsSkeleton
              expiring={detail.credits.expiring.length}
              credits={detail.credits.open.length}
            />
          }
          resetKey={accountId}
        >
          <Credits accountId={accountId} />
        </DataBlock>
      )}
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
        <NoteBalanceDialog
          // Each opening starts from today's day and an empty amount, with no past refusal.
          key={noteOpened}
          open={noteOpen}
          onOpenChange={setNoteOpen}
          accountId={accountId}
          currency={account.currency}
          day={detail.day}
          onSaved={setNoteSaved}
        />
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
          creditOrder: account.creditOrder,
          balanceCategoryId: account.balanceCategory?.id ?? null,
          topUpDays: account.topUpDays,
          topUpCapMinor: account.topUpCap?.minor ?? null,
        }}
        settlesIntoChoices={settlesIntoChoices}
        balanceCategory={account.balanceCategory}
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
  return (
    <Dialog
      title={m.accountCloseTitle({ name })}
      description={m.accountCloseDescription()}
      open={open}
      onOpenChange={onOpenChange}
      // While the form is sent it stays open: its answer lands on the form that sent it.
      sending={busy}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {m.accountCloseSubmit()}
        </Button>
      }
    >
      <DatePicker
        label={m.fieldClosedOn()}
        value={closedOn}
        onValueChange={(day) => onClosedOnChange(day ?? closedOn)}
        required
      />
      <FormMessage message={error} />
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
      restricted={account.kind === "benefit"}
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

/** What a credit's expiry dialog edits: the credit as it was when its button was pressed. */
type ExpiryTarget = { lineId: string; label: string; expiresOn: string | null; opened: number };

/** A benefit account kept by its lines: its credits, and the dialog that sets one's expiry. */
function Credits({ accountId }: { accountId: string }) {
  const detail = useAccountDetail(accountId);
  const locale = usePageLanguage();
  const [target, setTarget] = useState<ExpiryTarget>();
  const [open, setOpen] = useState(false);

  if (detail.credits === null) {
    return null;
  }

  const { open: credits } = detail.credits;
  const shown = benefitCreditsOf(detail.credits, detail.day, locale);

  function editExpiry(id: string) {
    const credit = credits.find((each) => each.lineId === id);

    if (id === OPENING_CREDIT_ID || credit === undefined || credit.lineId === null) {
      return;
    }

    setTarget({
      lineId: credit.lineId,
      label: credit.label ?? "",
      expiresOn: credit.expiresOn,
      opened: (target?.opened ?? 0) + 1,
    });
    setOpen(true);
  }

  return (
    <>
      <BenefitCredits
        order={shown.order}
        expiring={shown.expiring}
        credits={shown.credits}
        uncovered={shown.uncovered}
        onEditExpiry={editExpiry}
      />
      {target === undefined ? null : (
        <ExpiryDialog
          // Each opening starts from the credit's expiry as it is then, with no past refusal.
          key={target.opened}
          open={open}
          onOpenChange={setOpen}
          lineId={target.lineId}
          label={target.label}
          initial={target.expiresOn}
        />
      )}
    </>
  );
}

function ExpiryDialog({
  open,
  onOpenChange,
  lineId,
  label,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineId: string;
  label: string;
  initial: string | null;
}) {
  const queryClient = useQueryClient();
  const [expiresOn, setExpiresOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    const result = await whileBusy(setBusy, () =>
      setCreditExpiry({ data: { lineId, expiresOn } }).then(
        (answer) => answer,
        () => ({ ok: false as const, code: "UNKNOWN" }),
      ),
    );

    if (!result.ok) {
      setError(accountRefusalMessage(result.code));

      return;
    }

    setError(undefined);
    await invalidateAccounts(queryClient);
    onOpenChange(false);
  }

  return (
    <Dialog
      title={m.accountCreditExpiryTitle({ label })}
      description={m.accountCreditExpiryDescription()}
      open={open}
      onOpenChange={onOpenChange}
      sending={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {m.accountCreditExpirySubmit()}
        </Button>
      }
    >
      <DatePicker label={m.fieldExpiresOn()} value={expiresOn} onValueChange={setExpiresOn} />
      <FormMessage message={error} />
    </Dialog>
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
      creditOrder={account.kind === "benefit" ? creditOrderLabel(account.creditOrder) : undefined}
      balanceCategory={account.mode === "balance" ? balanceCategoryLabel(account) : undefined}
      action={
        <Button variant="secondary" size="sm" icon="edit" onClick={onEdit}>
          {m.accountEdit()}
        </Button>
      }
    />
  );
}

/** The category an account kept by its balance sends its movements to, worded: "None" for none. */
function balanceCategoryLabel(account: AccountDetail["account"]): string {
  const category = account.balanceCategory;

  if (category === null) {
    return m.accountBalanceCategoryNone();
  }

  return category.archived
    ? m.accountBalanceCategoryArchived({ name: shownPath(category.name) })
    : shownPath(category.name);
}

function toRow(line: AccountLine, today: string, locale: string): AccountLineRow {
  return {
    id: line.id,
    day: shortDay(line.bookedOn, locale),
    // The movement a noted balance makes has no label of its own.
    label: line.fromBalance ? m.lineFromBalance() : line.label,
    amount: line.amount,
    balanceAfter: line.balanceAfter ?? undefined,
    tag: creditExpiryTag(line.expiresOn, today, locale),
    subjects: line.subjects,
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

  const rows = [...detail.lines, ...older].map((line) => toRow(line, detail.day, locale));

  return (
    <AccountLines
      rows={rows}
      // A column of subjects (#37) once a line has one: most accounts' lines have none.
      withSubjects={rows.some((row) => (row.subjects ?? []).length > 0)}
      emptyText={account.mode === "balance" ? m.accountLinesEmptyBalance() : undefined}
      onShowOlder={olderBefore === null ? undefined : () => void showOlder()}
      loadingOlder={loadingOlder}
      olderError={olderError}
    />
  );
}

/**
 * A balance-mode account: note its balance at the end of a day, one a day, in a dialog the page's
 * "Note a balance" button opens (an action that asks for input never sits inline in a page).
 */
function NoteBalanceDialog({
  open,
  onOpenChange,
  accountId,
  currency,
  day,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  currency: string;
  day: string;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const [noteDay, setNoteDay] = useState(day);
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (balanceMinor === null) {
      return;
    }

    const result = await whileBusy(setBusy, () =>
      noteAccountBalance({ data: { accountId, day: noteDay, balanceMinor } }),
    );

    if (!result.ok) {
      setError(accountRefusalMessage(result.code));

      return;
    }

    setError(undefined);
    onSaved(m.accountNoteBalanceSaved({ day: shortDay(noteDay, locale) }));
    // The balance made its movement, and the one after it again: the months and the categories
    // count them.
    await Promise.all([invalidateAccounts(queryClient), invalidateCategories(queryClient)]);
    onOpenChange(false);
  }

  return (
    <Dialog
      title={m.accountBlockNoteBalance()}
      description={m.accountNoteBalanceDescription()}
      open={open}
      onOpenChange={onOpenChange}
      sending={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      actions={
        <Button type="submit" loading={busy}>
          {m.accountNoteBalanceSubmit()}
        </Button>
      }
    >
      <DatePicker
        label={m.fieldDay()}
        value={noteDay}
        onValueChange={(value) => setNoteDay(value ?? noteDay)}
        required
      />
      <MoneyField
        label={m.fieldAmount()}
        currency={currency}
        onValueChange={setBalanceMinor}
        required
      />
      <FormMessage message={error} />
    </Dialog>
  );
}
