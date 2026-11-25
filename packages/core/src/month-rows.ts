import {
  account,
  accountBalance,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, eq, gte, lte, min, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { readAll } from "./category-store-database";
import type { MonthRows, MonthScope, StatementReach } from "./month";
import { chargesIn } from "./subscriptions/charges";

// The raw rows of a month (#32), read in one transaction of the user's (`MonthFacts`): what the
// month's figures are computed from in `./month`. Every value goes in as a parameter.

const outLine = alias(statementLine, "out_line");
const inLine = alias(statementLine, "in_line");

/** The month's rows, as `scope` asks for them, in `owner`'s transaction. */
export async function monthRowsIn(
  transaction: UserTransaction,
  scope: MonthScope,
): Promise<MonthRows> {
  const accounts = await transaction
    .select({
      id: account.id,
      name: account.name,
      institution: account.institution,
      kind: account.kind,
      currency: account.currency,
      mode: account.mode,
      openingBalanceMinor: account.openingBalanceMinor,
      openedOn: account.openedOn,
      closedOn: account.closedOn,
      creditOrder: account.creditOrder,
    })
    .from(account)
    .orderBy(asc(account.name), asc(account.id));

  const categories = await readAll(transaction);

  // Each part once, with its entry and its line (`entry_user_id_happened_on_idx`).
  const parts = await transaction
    .select({
      entryId: entry.id,
      kind: entry.kind,
      happenedOn: entry.happenedOn,
      categoryId: entry.categoryId,
      entryMerchantId: entry.merchantId,
      role: entryPart.role,
      amountMinor: entryPart.amountMinor,
      lineId: entryPart.lineId,
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
      accountId: statementLine.accountId,
    })
    .from(entry)
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(and(gte(entry.happenedOn, scope.entries.from), lte(entry.happenedOn, scope.entries.to)));

  const transfers = await transaction
    .select({
      outAccountId: outLine.accountId,
      outBookedOn: outLine.bookedOn,
      outMinor: outLine.amountMinor,
      inAccountId: inLine.accountId,
      inBookedOn: inLine.bookedOn,
      inMinor: inLine.amountMinor,
    })
    .from(transfer)
    .innerJoin(outLine, eq(outLine.id, transfer.outLineId))
    .innerJoin(inLine, eq(inLine.id, transfer.inLineId))
    .where(
      or(
        and(gte(outLine.bookedOn, scope.transfers.from), lte(outLine.bookedOn, scope.transfers.to)),
        and(gte(inLine.bookedOn, scope.transfers.from), lte(inLine.bookedOn, scope.transfers.to)),
      ),
    );

  const merchants = await transaction
    .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
    .from(merchant);

  const aliases = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias);

  const [first] = await transaction.select({ day: min(entry.happenedOn) }).from(entry);

  // A benefit account's credits are replayed from its counted lines, oldest first.
  const benefitLines = await transaction
    .select({
      accountId: statementLine.accountId,
      id: statementLine.id,
      bookedOn: statementLine.bookedOn,
      amountMinor: statementLine.amountMinor,
      label: statementLine.label,
      expiresOn: statementLine.expiresOn,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(account.kind, "benefit"),
        eq(statementLine.state, "counted"),
        lte(statementLine.bookedOn, scope.benefitTo),
      ),
    )
    .orderBy(asc(statementLine.bookedOn), asc(statementLine.id));

  const imported = await transaction
    .select({
      accountId: statementImport.accountId,
      to: sql<string | null>`max(${statementImport.periodTo})::text`,
    })
    .from(statementImport)
    .where(eq(statementImport.status, "done"))
    .groupBy(statementImport.accountId);

  const statements = await transaction
    .select({
      accountId: accountBalance.accountId,
      to: sql<string | null>`max(${accountBalance.day})::text`,
    })
    .from(accountBalance)
    .where(and(eq(accountBalance.source, "statement"), lte(accountBalance.day, scope.statementsTo)))
    .groupBy(accountBalance.accountId);

  // The accounts with lines entered by hand: those never imported are kept by hand (#235).
  const manual = await transaction
    .selectDistinct({ accountId: statementLine.accountId })
    .from(statementLine)
    .where(eq(statementLine.source, "manual"));

  const importedOf = new Map(imported.map((row) => [row.accountId, row.to]));
  const statementOf = new Map(statements.map((row) => [row.accountId, row.to]));
  const byHand = new Set(manual.map((row) => row.accountId));

  const reach = accounts.map((each): StatementReach => ({
    accountId: each.id,
    importedTo: importedOf.get(each.id) ?? null,
    statementTo: statementOf.get(each.id) ?? null,
    keptByHand: byHand.has(each.id) && !importedOf.has(each.id) && !statementOf.has(each.id),
  }));

  return {
    accounts,
    categories,
    parts,
    transfers,
    merchants,
    aliases,
    firstDay: first?.day ?? null,
    benefitLines,
    reach,
    charges: scope.charges === null ? [] : await chargesIn(transaction, scope.charges),
  };
}
