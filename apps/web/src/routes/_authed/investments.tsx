import type { InvestmentAccount, OperationRead } from "@gousset/core";
import { AccountId } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { AlertDialog } from "@gousset/ui/components/dialog";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import {
  InvestmentFigures,
  InvestmentFiguresSkeleton,
  InvestmentOperations,
  InvestmentOperationsSkeleton,
  OperationForm,
  PositionsTable,
  PositionsTableSkeleton,
} from "@gousset/ui/components/investments";
import type {
  InvestmentOperationRow,
  OperationFormErrors,
  OperationFormValues,
} from "@gousset/ui/components/investments";
import { Select } from "@gousset/ui/components/select";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { useUiMessages } from "@gousset/ui/hooks/use-ui-messages";
import { formatMoney } from "@gousset/ui/lib/money";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { useState } from "react";

import { AppButtonLink } from "@/components/app-link";
import { DataBlock } from "@/components/data-block";
import {
  correctOperation,
  deleteOperation,
  enterOperation,
  getInvestmentOperations,
} from "@/functions/investments";
import { operationRefusalMessage } from "@/i18n/messages";
import { shortDay } from "@/lib/account-day";
import { accountEnvelopeLabel } from "@/lib/account-labels";
import { formValuesOf, operationOf, refusalField, tradeAmountOf } from "@/lib/investment-form";
import type { OperationRefusal } from "@/lib/investment-form";
import { whileBusy } from "@/lib/while-busy";
import { invalidateAccounts } from "@/queries/accounts";
import { invalidateCategories } from "@/queries/categories";
import { investmentQueries } from "@/queries/investments";

// The investments page (#250; docs/wireframes, screen 4), at cost until prices come (#251): one
// investment account at a time, its figures, its positions by ISIN and its operations, entered,
// corrected and deleted by hand. With several accounts, a select above the blocks chooses which,
// kept in the address (`?account=`) so that a link and the back button reach the same one: a
// select holds any number of accounts and any name on a phone, where tabs would overflow, and the
// wireframe draws the page for one account.
//
// Motion: the figures' amounts roll to their new value once an operation is entered, corrected or
// deleted (200 ms, ease-out; `Amount`); the operation just entered or corrected slides in from the
// side and fades in (200 ms, ease-out); the positions' rows fade and slide up on first paint
// (200 ms, staggered); the form's dialog fades and grows in 200 ms, rising from the bottom on a
// phone (300 ms); a deleted operation leaves at once, as a trade's amount prefilled and the
// difference said under one typed otherwise appear. Everything is cut under reduced motion.

/** The account asked for in the address; anything else is dropped, as a typed address may be. */
const investmentsSearch = Schema.toStandardSchemaV1(
  Schema.Struct({
    account: Schema.optional(
      Schema.UndefinedOr(AccountId).pipe(
        Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))),
      ),
    ),
  }),
);

/** The account shown: the one asked for, else the first open one, else the first. */
function shownAccount(
  accounts: ReadonlyArray<InvestmentAccount>,
  asked: string | undefined,
): InvestmentAccount | undefined {
  return (
    accounts.find((each) => each.id === asked) ??
    accounts.find((each) => each.closedOn === null) ??
    accounts[0]
  );
}

export const Route = createFileRoute("/_authed/investments")({
  validateSearch: investmentsSearch,
  loaderDeps: ({ search }) => ({ account: search.account }),
  loader: async ({ context: { queryClient }, deps }) => {
    const { accounts } = await queryClient.ensureQueryData(investmentQueries.list());
    const shown = shownAccount(accounts, deps.account);

    if (shown !== undefined) {
      await queryClient.ensureQueryData(investmentQueries.operations(shown.id));
    }
  },
  component: InvestmentsPage,
});

/** What the operation form is open for: a new operation, or one to correct. */
type FormTarget = {
  readonly operationId: string | null;
  readonly initial: OperationFormValues;
  /** Each opening starts anew, with no past refusal. */
  readonly opened: number;
};

function InvestmentsPage() {
  const { data } = useSuspenseQuery(investmentQueries.list());
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const account = shownAccount(data.accounts, search.account);

  if (account === undefined) {
    return (
      <Page title={m.investmentsTitle()}>
        <ScreenBlock>
          <EmptyState
            icon="investments"
            title={m.investmentsEmptyTitle()}
            description={m.investmentsEmptyDescription()}
            links={<AppButtonLink to="/accounts">{m.investmentsEmptyAction()}</AppButtonLink>}
          />
        </ScreenBlock>
      </Page>
    );
  }

  return (
    <AccountInvestments
      // Another account starts from its own state: no form, no message of the last one's.
      key={account.id}
      account={account}
      accounts={data.accounts}
      day={data.day}
      onChoose={(accountId) => void navigate({ search: { account: accountId } })}
    />
  );
}

function AccountInvestments({
  account,
  accounts,
  day,
  onChoose,
}: {
  account: InvestmentAccount;
  accounts: ReadonlyArray<InvestmentAccount>;
  day: string;
  onChoose: (accountId: string) => void;
}) {
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const kinds = useUiMessages().investments.kinds;
  const [target, setTarget] = useState<FormTarget>();
  const [formOpen, setFormOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<OperationFormErrors>({});
  const [status, setStatus] = useState<string>();
  const [justChanged, setJustChanged] = useState<string>();
  const [deleting, setDeleting] = useState<OperationRead>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const byHand = account.mode === "lines";

  function openForm(operationId: string | null, initial: OperationFormValues) {
    setTarget({ operationId, initial, opened: (target?.opened ?? 0) + 1 });
    setErrors({});
    setFormOpen(true);
  }

  const said = (operation: OperationRead) => ({
    kind: kinds[operation.kind],
    day: shortDay(operation.bookedOn, locale),
  });

  /** Everything an operation moves: the account's cash and lines, a deposit's month and entry. */
  const reread = () =>
    Promise.all([invalidateAccounts(queryClient), invalidateCategories(queryClient)]);

  async function submit(values: OperationFormValues) {
    if (target === undefined) {
      return;
    }

    const operation = operationOf(values);

    // A failed call answers `undefined`: the React Compiler has no `try` to handle in a component.
    const result = await whileBusy(setSending, () =>
      (target.operationId === null
        ? enterOperation({ data: { accountId: account.id, operation } })
        : correctOperation({ data: { operationId: target.operationId, operation } })
      ).then(
        (answer) => answer,
        () => undefined,
      ),
    );

    if (result === undefined) {
      setErrors({ form: m.errorUnknown() });

      return;
    }

    if (!result.ok) {
      const refusal: OperationRefusal = { code: result.code, text: result.text };
      const field = refusalField(refusal, values);

      setErrors({ [field]: operationRefusalMessage(result.code, field === "unitPrice") });

      return;
    }

    setErrors({});
    setStatus(
      target.operationId === null
        ? m.investmentsEntered(said(result.operation))
        : m.investmentsCorrected(said(result.operation)),
    );
    setJustChanged(result.operation.id);
    await reread();
    setFormOpen(false);
  }

  async function remove() {
    if (deleting === undefined) {
      return;
    }

    const result = await deleteOperation({ data: { operationId: deleting.id } }).then(
      (answer) => answer,
      () => undefined,
    );

    if (result === undefined || !result.ok) {
      setDeleteError(
        m.investmentsDeleteFailed({
          reason: result === undefined ? m.errorUnknown() : operationRefusalMessage(result.code),
        }),
      );

      return;
    }

    setDeleteError(undefined);
    setStatus(m.investmentsDeleted(said(result.operation)));
    await reread();
  }

  return (
    <Page
      title={m.investmentsTitle()}
      actions={
        <>
          {accounts.length > 1 ? (
            <Select
              label={m.investmentsAccount()}
              hideLabel
              items={accounts.map((each) => ({
                value: each.id,
                label:
                  each.closedOn === null
                    ? each.name
                    : m.investmentsAccountClosed({ name: each.name }),
              }))}
              value={account.id}
              onValueChange={(next) => {
                if (next !== null) {
                  onChoose(next);
                }
              }}
            />
          ) : null}
          {byHand ? (
            <Button
              icon="add"
              onClick={() =>
                openForm(null, {
                  kind: "purchase",
                  bookedOn: day,
                  amountMinor: null,
                  isin: "",
                  securityName: "",
                  quantity: "",
                  unitPrice: "",
                  feesMinor: null,
                })
              }
            >
              {m.investmentsAddOperation()}
            </Button>
          ) : null}
        </>
      }
    >
      <StatusMessage message={status} />
      <FormMessage message={deleteError} />
      <DataBlock
        title={account.name}
        skeleton={<InvestmentFiguresSkeleton />}
        resetKey={account.id}
      >
        <InvestmentFigures
          envelope={accountEnvelopeLabel(account.choice)}
          institution={account.institution ?? undefined}
          closed={
            account.closedOn === null
              ? undefined
              : m.investmentsClosedOn({ day: shortDay(account.closedOn, locale) })
          }
          cash={account.cash}
          positionsCost={{
            minor: account.positions.reduce((sum, each) => sum + each.cost.minor, 0),
            currency: account.currency,
          }}
        />
      </DataBlock>
      <DataBlock
        title={m.investmentsBlockPositions()}
        skeleton={<PositionsTableSkeleton rows={account.positions.length} />}
        resetKey={account.id}
      >
        <PositionsTable
          label={m.investmentsPositionsCaption({ name: account.name })}
          cash={account.cash}
          positions={account.positions.map((each) => ({
            id: each.security.id,
            name: each.security.name,
            isin: each.security.isin,
            quantity: each.quantity,
            averageCost: each.averageCost,
            cost: each.cost,
            incomplete: each.incomplete,
          }))}
        />
      </DataBlock>
      <DataBlock
        title={m.investmentsBlockOperations()}
        skeleton={<InvestmentOperationsSkeleton />}
        resetKey={account.id}
      >
        <Operations
          account={account}
          justChanged={justChanged}
          onCorrect={(operation) => openForm(operation.id, formValuesOf(operation))}
          onDelete={(operation) => {
            setDeleting(operation);
            setDeleteError(undefined);
            setDeleteOpen(true);
          }}
        />
      </DataBlock>
      {target === undefined ? null : (
        <OperationForm
          key={target.opened}
          open={formOpen}
          onOpenChange={setFormOpen}
          title={
            target.operationId === null ? m.investmentsEnterTitle() : m.investmentsCorrectTitle()
          }
          description={
            target.operationId === null
              ? m.investmentsEnterDescription({ name: account.name })
              : m.investmentsCorrectDescription({ name: account.name })
          }
          submitLabel={
            target.operationId === null ? m.investmentsEnterSubmit() : m.investmentsCorrectSubmit()
          }
          currency={account.currency}
          initial={target.initial}
          errors={errors}
          sending={sending}
          onSubmit={(values) => void submit(values)}
          onInput={() => setErrors({})}
          tradeAmount={(values) => tradeAmountOf(values, account.currency)}
        />
      )}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={m.investmentsDeleteTitle()}
        description={
          deleting === undefined
            ? ""
            : m.investmentsDeleteDescription({
                ...said(deleting),
                amount: formatMoney(deleting.amount, { locale, sign: "always" }),
              })
        }
        confirmLabel={m.investmentsDeleteConfirm()}
        destructive
        onConfirm={remove}
      />
    </Page>
  );
}

/** An account gone meanwhile: no operation, one value for every render. */
const NO_PAGE = { operations: [], next: null, total: 0 } as const;

function rowOf(operation: OperationRead, locale: string): InvestmentOperationRow {
  return {
    id: operation.id,
    day: shortDay(operation.bookedOn, locale),
    kind: operation.kind,
    amount: operation.amount,
    security: operation.security?.name ?? null,
    quantity: operation.quantity,
    fees: operation.fees,
    paired: operation.paired,
  };
}

/** The account's operations, newest first, a page at a time. */
function Operations({
  account,
  justChanged,
  onCorrect,
  onDelete,
}: {
  account: InvestmentAccount;
  justChanged: string | undefined;
  onCorrect: (operation: OperationRead) => void;
  onDelete: (operation: OperationRead) => void;
}) {
  const { data } = useSuspenseQuery(investmentQueries.operations(account.id));
  const locale = usePageLanguage();
  const first = data.ok ? data.page : NO_PAGE;
  const [firstPage, setFirstPage] = useState(first.operations);
  const [older, setOlder] = useState<ReadonlyArray<OperationRead>>([]);
  const [next, setNext] = useState(first.next);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string>();

  // The first page changed (an operation entered, corrected, deleted): drop the older ones loaded.
  if (firstPage !== first.operations) {
    setFirstPage(first.operations);
    setOlder([]);
    setNext(first.next);
    setOlderError(undefined);
  }

  async function showOlder() {
    if (next === null || loadingOlder) {
      return;
    }

    const result = await whileBusy(setLoadingOlder, () =>
      getInvestmentOperations({ data: { accountId: account.id, after: next } }).then(
        (answer) => answer,
        () => undefined,
      ),
    );

    if (result === undefined) {
      setOlderError(m.investmentsOlderFailed());

      return;
    }

    if (result.ok) {
      setOlder((current) => [...current, ...result.page.operations]);
      setNext(result.page.next);
      setOlderError(undefined);
    } else {
      setNext(null);
    }
  }

  const operations = [...first.operations, ...older];
  const find = (id: string) => operations.find((each) => each.id === id);
  const byHand = account.mode === "lines";

  return (
    <InvestmentOperations
      label={m.investmentsOperationsLabel({ name: account.name })}
      rows={operations.map((operation) => rowOf(operation, locale))}
      justChanged={justChanged}
      emptyText={byHand ? undefined : m.investmentsKeptByBalance()}
      onCorrect={
        byHand
          ? (id) => {
              const operation = find(id);

              if (operation !== undefined) {
                onCorrect(operation);
              }
            }
          : undefined
      }
      onDelete={
        byHand
          ? (id) => {
              const operation = find(id);

              if (operation !== undefined) {
                onDelete(operation);
              }
            }
          : undefined
      }
      onShowOlder={next === null ? undefined : () => void showOlder()}
      loadingOlder={loadingOlder}
      olderError={olderError}
    />
  );
}
