import { m } from "@gousset/i18n/messages";
import {
  AccountGroup,
  AccountsOverviewSkeleton,
  AccountsTotals,
  ClosedAccounts,
} from "@gousset/ui/components/accounts-overview";
import type { AccountsOverviewTotal } from "@gousset/ui/components/accounts-overview";
import { Page } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AccountRowLink } from "@/components/app-link";
import type { AccountFormResult, AccountFormValues } from "@/components/account-form";
import { AccountForm, accountFormInput } from "@/components/account-form";
import { DataBlock } from "@/components/data-block";
import { createAccount } from "@/functions/accounts";
import { shortDay } from "@/lib/account-day";
import { accountEnvelopeLabel, accountGroupLabel } from "@/lib/account-labels";
import { accountQueries, invalidateAccounts } from "@/queries/accounts";

export const Route = createFileRoute("/_authed/accounts/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(accountQueries.list());
  },
  component: AccountsPage,
});

const NEW_ACCOUNT: AccountFormValues = {
  name: "",
  choice: "current",
  institution: "",
  currency: "EUR",
  mode: "lines",
  openingBalanceMinor: 0,
  openedOn: null,
  settlesIntoAccountId: null,
  creditOrder: "oldest_first",
};

function AccountsPage() {
  return (
    <Page title={m.accountsTitle()}>
      <DataBlock
        title={m.accountsTitle()}
        skeleton={<AccountsOverviewSkeleton />}
        resetKey="accounts"
      >
        <Overview />
      </DataBlock>
    </Page>
  );
}

function Overview() {
  const { data } = useSuspenseQuery(accountQueries.list());
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const [formOpen, setFormOpen] = useState(false);
  const [formOpened, setFormOpened] = useState(0);
  const [justCreatedId, setJustCreatedId] = useState<string>();

  const openCurrentAccounts = data.groups
    .flatMap((group) => group.accounts)
    .filter((account) => account.kind === "current")
    .map((account) => ({ id: account.id, name: account.name }));

  // Each opening starts from an empty form, with no past refusal.
  function openForm() {
    setFormOpened((count) => count + 1);
    setFormOpen(true);
  }

  async function handleCreate(values: AccountFormValues): Promise<AccountFormResult> {
    try {
      const result = await createAccount({ data: accountFormInput(values) });

      if (!result.ok) {
        return result;
      }

      await invalidateAccounts(queryClient);

      return { ok: true, id: result.id };
    } catch {
      return { ok: false, code: "UNKNOWN" };
    }
  }

  const form = (
    <AccountForm
      key={formOpened}
      open={formOpen}
      onOpenChange={setFormOpen}
      title={m.accountFormCreateTitle()}
      submitLabel={m.accountFormCreateSubmit()}
      initial={NEW_ACCOUNT}
      settlesIntoChoices={openCurrentAccounts}
      onSubmit={handleCreate}
      onSaved={setJustCreatedId}
    />
  );

  const totals: ReadonlyArray<AccountsOverviewTotal> = data.groups
    .filter((group) => group.totals.length > 0)
    .map((group) => ({
      id: group.group,
      label: accountGroupLabel(group.group),
      amounts: group.totals,
    }));

  const hasAnyAccount =
    data.groups.some((group) => group.accounts.length > 0) || data.closed.length > 0;

  if (!hasAnyAccount) {
    return (
      <>
        <EmptyState
          icon="accounts"
          title={m.accountsEmptyTitle()}
          description={m.accountsEmptyDescription()}
          action={{ label: m.accountsAddAccount(), icon: "add", onClick: openForm }}
        />
        {form}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button icon="add" onClick={openForm}>
          {m.accountsAddAccount()}
        </Button>
      </div>
      <AccountsTotals totals={totals} />
      {data.groups
        .filter((group) => group.accounts.length > 0)
        .map((group, index) => (
          <AccountGroup
            key={group.group}
            id={group.group}
            title={accountGroupLabel(group.group)}
            totals={group.totals}
            index={index}
          >
            {group.accounts.map((account, rowIndex) => (
              <AccountRowLink
                key={account.id}
                to="/accounts/$accountId"
                params={{ accountId: account.id }}
                name={account.name}
                envelope={accountEnvelopeLabel(account.choice)}
                institution={account.institution ?? undefined}
                tracking={account.mode}
                through={
                  account.statementsUntil === null
                    ? null
                    : shortDay(account.statementsUntil.day, locale)
                }
                balance={account.balance}
                restricted={group.group === "restricted"}
                justCreated={account.id === justCreatedId}
                index={rowIndex}
              />
            ))}
          </AccountGroup>
        ))}
      {data.closed.length === 0 ? null : (
        <ClosedAccounts count={data.closed.length}>
          {data.closed.map((account) => (
            <AccountRowLink
              key={account.id}
              to="/accounts/$accountId"
              params={{ accountId: account.id }}
              name={account.name}
              envelope={accountEnvelopeLabel(account.choice)}
              institution={account.institution ?? undefined}
              tracking={account.mode}
              through={
                account.statementsUntil === null
                  ? null
                  : shortDay(account.statementsUntil.day, locale)
              }
              balance={account.balance}
              closed
            />
          ))}
        </ClosedAccounts>
      )}
      {form}
    </div>
  );
}
