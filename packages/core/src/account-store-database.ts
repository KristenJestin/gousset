import {
  account,
  accountBalance,
  category,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, desc, eq, lt, lte, sql } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";

import { AccountStore } from "./account-store";
import type {
  AccountChange,
  AccountFacts,
  AccountRecord,
  BalanceCategory,
  ChoosableCategory,
  EditFacts,
  LineExpiry,
  LineFacts,
  NewAccount,
  StatementBalanceAt,
} from "./account-store";
import { remakeBalanceLines } from "./balance-lines";
import type { DayBalance } from "./balances";
import { takeCategoryTurn } from "./category-turn";
import { AccountNotFound, BalanceAlreadyNoted, LineNotFound } from "./errors";
import { topUpsToBalanceCategories } from "./expenses/top-up-categories";
import { matchTopUpsIn } from "./expenses/top-ups";

// The accounts in the database, through `UserData` only (docs/data-model.md, "Ownership and
// isolation"): each call is one transaction of the user's, which row-level security keeps to their
// own rows. Sums are made by Postgres, cast to `bigint` (exact) and read as numbers.

type AccountRow = typeof account.$inferSelect;

const record = (row: AccountRow): AccountRecord => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  envelope: row.envelope,
  institution: row.institution,
  currency: row.currency,
  mode: row.mode,
  openingBalanceMinor: row.openingBalanceMinor,
  openedOn: row.openedOn,
  closedOn: row.closedOn,
  settlesIntoAccountId: row.settlesIntoAccountId,
  creditOrder: row.creditOrder,
  balanceCategoryId: row.balanceCategoryId,
  topUpDays: row.topUpDays,
  topUpCapMinor: row.topUpCapMinor,
});

/** Every category of the user's, as a write checks the one an account names. */
async function choosableCategories(
  transaction: UserTransaction,
): Promise<ReadonlyArray<ChoosableCategory>> {
  const rows = await transaction
    .select({ id: category.id, archivedAt: category.archivedAt })
    .from(category);

  return rows.map((row) => ({ id: row.id, archived: row.archivedAt !== null }));
}

/** The user's categories by id, each named with its parent's for a child. */
async function namedCategories(
  transaction: UserTransaction,
): Promise<ReadonlyMap<string, BalanceCategory>> {
  const rows = await transaction
    .select({
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      kind: category.kind,
      archivedAt: category.archivedAt,
    })
    .from(category);

  const nameOf = new Map(rows.map((row) => [row.id, row.name]));

  return new Map(
    rows.map((row) => {
      const parent = row.parentId === null ? undefined : nameOf.get(row.parentId);

      return [
        row.id,
        {
          id: row.id,
          name: parent === undefined ? row.name : `${parent} > ${row.name}`,
          kind: row.kind,
          archived: row.archivedAt !== null,
        },
      ];
    }),
  );
}

/** A uuid, as the database writes them: anything else names no row, and would fail the query. */
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const isId = (id: string) => UUID.test(id);

const summed = () =>
  sql<number>`coalesce(sum(${statementLine.amountMinor}), 0)::bigint`.mapWith(Number);

const summedPositive = () =>
  sql<number>`coalesce(sum(greatest(${statementLine.amountMinor}, 0)), 0)::bigint`.mapWith(Number);

const summedNegative = () =>
  sql<number>`coalesce(sum(greatest(-${statementLine.amountMinor}, 0)), 0)::bigint`.mapWith(Number);

const counted = (accountId: string) =>
  and(eq(statementLine.accountId, accountId), eq(statementLine.state, "counted"));

async function readFacts(transaction: UserTransaction, day: string) {
  const accounts = await transaction.select().from(account).orderBy(asc(account.id));

  const countedSums = await transaction
    .select({ accountId: statementLine.accountId, minor: summed() })
    .from(statementLine)
    .where(and(eq(statementLine.state, "counted"), lte(statementLine.bookedOn, day)))
    .groupBy(statementLine.accountId);

  const balances = await transaction
    .select({
      accountId: accountBalance.accountId,
      day: accountBalance.day,
      minor: accountBalance.balanceMinor,
      source: accountBalance.source,
    })
    .from(accountBalance)
    .where(lte(accountBalance.day, day))
    .orderBy(asc(accountBalance.day), asc(accountBalance.id));

  const imported = await transaction
    .select({
      accountId: statementImport.accountId,
      to: sql<string | null>`max(${statementImport.periodTo})::text`,
    })
    .from(statementImport)
    .where(eq(statementImport.status, "done"))
    .groupBy(statementImport.accountId);

  // Every distinct day an account has a statement balance, on or before `day`: the account page's
  // check compares the latest against the app's balance, and the earlier ones too, each at the end
  // of its own day.
  const statementDays = transaction
    .select({ accountId: accountBalance.accountId, day: accountBalance.day })
    .from(accountBalance)
    .where(and(eq(accountBalance.source, "statement"), lte(accountBalance.day, day)))
    .groupBy(accountBalance.accountId, accountBalance.day)
    .as("statement_days");

  const countedAtEachStatement = await transaction
    .select({ accountId: statementLine.accountId, day: statementDays.day, minor: summed() })
    .from(statementLine)
    .innerJoin(statementDays, eq(statementDays.accountId, statementLine.accountId))
    .where(
      and(
        eq(statementLine.state, "counted"),
        sql`${statementLine.bookedOn} <= ${statementDays.day}`,
      ),
    )
    .groupBy(statementLine.accountId, statementDays.day);

  const categories = accounts.some((row) => row.balanceCategoryId !== null)
    ? await namedCategories(transaction)
    : new Map<string, BalanceCategory>();

  const countedOf = new Map(countedSums.map((row) => [row.accountId, row.minor]));
  const importedOf = new Map(imported.map((row) => [row.accountId, row.to]));
  const notedOf = new Map<string, Array<DayBalance>>();
  // Per account, per day: of two statement balances on one day, the latest import's (`balances` is
  // ordered oldest first, by day then by id, so the last write for a day wins).
  const statementMinorOf = new Map<string, Map<string, number>>();

  for (const balance of balances) {
    if (balance.source === "statement") {
      const byDay = statementMinorOf.get(balance.accountId) ?? new Map<string, number>();

      byDay.set(balance.day, balance.minor);
      statementMinorOf.set(balance.accountId, byDay);
    } else {
      const noted = notedOf.get(balance.accountId) ?? [];

      noted.push({ day: balance.day, minor: balance.minor });
      notedOf.set(balance.accountId, noted);
    }
  }

  const countedAtOf = new Map<string, Map<string, number>>();

  for (const row of countedAtEachStatement) {
    const byDay = countedAtOf.get(row.accountId) ?? new Map<string, number>();

    byDay.set(row.day, row.minor);
    countedAtOf.set(row.accountId, byDay);
  }

  const statementsOf = (accountId: string): ReadonlyArray<StatementBalanceAt> => {
    const byDay = statementMinorOf.get(accountId);

    if (byDay === undefined) {
      return [];
    }

    const countedByDay = countedAtOf.get(accountId);

    return [...byDay.entries()]
      .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
      .map(([statementDay, minor]) => ({
        day: statementDay,
        minor,
        countedMinor: countedByDay?.get(statementDay) ?? 0,
      }));
  };

  return accounts.map((row): AccountFacts => ({
    account: record(row),
    balanceCategory:
      row.balanceCategoryId === null ? null : (categories.get(row.balanceCategoryId) ?? null),
    countedMinor: countedOf.get(row.id) ?? 0,
    noted: notedOf.get(row.id) ?? [],
    statements: statementsOf(row.id),
    importedTo: importedOf.get(row.id) ?? null,
  }));
}

async function findAccount(transaction: UserTransaction, accountId: string) {
  if (!isId(accountId)) {
    return undefined;
  }

  const [row] = await transaction.select().from(account).where(eq(account.id, accountId));

  return row === undefined ? undefined : record(row);
}

async function hasEntries(transaction: UserTransaction, accountId: string): Promise<boolean> {
  const [line] = await transaction
    .select({ id: statementLine.id })
    .from(statementLine)
    .where(eq(statementLine.accountId, accountId))
    .limit(1);

  const [balance] = await transaction
    .select({ id: accountBalance.id })
    .from(accountBalance)
    .where(eq(accountBalance.accountId, accountId))
    .limit(1);

  return line !== undefined || balance !== undefined;
}

/** `AccountStore` on the user's tables, through `UserData`. */
export const DatabaseAccountStore = Layer.effect(
  AccountStore,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      facts: (owner, day) =>
        userData.transaction(owner, (transaction) => readFacts(transaction, day)),

      lines: (owner, accountId, { before, limit, day }) =>
        userData.transaction(owner, async (transaction) => {
          if (!isId(accountId) || (before !== undefined && !isId(before))) {
            return { lines: [], olderMinor: 0, more: false };
          }

          // A cursor of another account's, or of no line, matches nothing: an empty page.
          const older =
            before === undefined
              ? undefined
              : sql`(${statementLine.bookedOn}, ${statementLine.id}) < (select cursor.booked_on, cursor.id from statement_line cursor where cursor.id = ${before}::uuid and cursor.account_id = ${accountId}::uuid)`;

          const rows = await transaction
            .select({
              id: statementLine.id,
              bookedOn: statementLine.bookedOn,
              valueOn: statementLine.valueOn,
              amountMinor: statementLine.amountMinor,
              label: statementLine.label,
              memo: statementLine.memo,
              counterpartyName: statementLine.counterpartyName,
              expiresOn: statementLine.expiresOn,
              source: statementLine.source,
            })
            .from(statementLine)
            .where(and(counted(accountId), lte(statementLine.bookedOn, day), older))
            .orderBy(desc(statementLine.bookedOn), desc(statementLine.id))
            .limit(limit + 1);

          const lines = rows.slice(0, limit);
          const oldest = lines.at(-1);

          if (oldest === undefined) {
            return { lines, olderMinor: 0, more: false };
          }

          const [beyond] = await transaction
            .select({ minor: summed() })
            .from(statementLine)
            .where(
              and(
                counted(accountId),
                sql`(${statementLine.bookedOn}, ${statementLine.id}) < (${oldest.bookedOn}::date, ${oldest.id}::uuid)`,
              ),
            );

          return { lines, olderMinor: beyond?.minor ?? 0, more: rows.length > limit };
        }),

      moves: (owner, accountId, { from, to }) =>
        userData.transaction(owner, async (transaction) => {
          if (!isId(accountId)) {
            return { beforeMinor: 0, moves: [] };
          }

          const [before] = await transaction
            .select({ minor: summed() })
            .from(statementLine)
            .where(and(counted(accountId), lt(statementLine.bookedOn, from)));

          const moves = await transaction
            .select({ day: statementLine.bookedOn, minor: summed() })
            .from(statementLine)
            .where(
              and(
                counted(accountId),
                sql`${statementLine.bookedOn} between ${from}::date and ${to}::date`,
              ),
            )
            .groupBy(statementLine.bookedOn)
            .orderBy(asc(statementLine.bookedOn));

          return { beforeMinor: before?.minor ?? 0, moves };
        }),

      inOut: (owner, accountId, { from, to }) =>
        userData.transaction(owner, async (transaction) => {
          if (!isId(accountId)) {
            return { inMinor: 0, outMinor: 0 };
          }

          const [row] = await transaction
            .select({ inMinor: summedPositive(), outMinor: summedNegative() })
            .from(statementLine)
            .where(
              and(
                counted(accountId),
                sql`${statementLine.bookedOn} between ${from}::date and ${to}::date`,
              ),
            );

          return { inMinor: row?.inMinor ?? 0, outMinor: row?.outMinor ?? 0 };
        }),

      countedLines: (owner, accountId, day) =>
        userData.transaction(owner, async (transaction) => {
          if (!isId(accountId)) {
            return [];
          }

          return transaction
            .select({
              id: statementLine.id,
              bookedOn: statementLine.bookedOn,
              amountMinor: statementLine.amountMinor,
              label: statementLine.label,
              expiresOn: statementLine.expiresOn,
            })
            .from(statementLine)
            .where(and(counted(accountId), lte(statementLine.bookedOn, day)))
            .orderBy(asc(statementLine.bookedOn), asc(statementLine.id));
        }),

      create: <E>(
        owner: string,
        decide: (
          accounts: ReadonlyArray<AccountRecord>,
          categories: ReadonlyArray<ChoosableCategory>,
        ) => Result.Result<NewAccount, E>,
      ) =>
        userData
          .transaction(owner, async (transaction): Promise<Result.Result<AccountRecord, E>> => {
            // A benefit card's issuer and category classify the bank's top-ups below (#28).
            await takeCategoryTurn(transaction, owner);

            const accounts = await transaction.select().from(account);
            const categories = await choosableCategories(transaction);
            const decided = decide(accounts.map(record), categories);

            if (Result.isFailure(decided)) {
              return Result.fail(decided.failure);
            }

            const [created] = await transaction
              .insert(account)
              .values({ userId: owner, ...decided.success })
              .returning();

            if (created === undefined) {
              throw new Error("The insert returned no row.");
            }

            await topUpsToBalanceCategories(transaction, { every: true });

            return Result.succeed(record(created));
          })
          .pipe(Effect.flatMap(Effect.fromResult)),

      update: <E>(
        owner: string,
        accountId: string,
        decide: (facts: EditFacts) => Result.Result<AccountChange, E>,
      ) =>
        userData
          .transaction(
            owner,
            async (transaction): Promise<Result.Result<AccountRecord, E | AccountNotFound>> => {
              // Its opening balance, mode and category shape its movement lines, made again below.
              await takeCategoryTurn(transaction, owner);

              const found = await findAccount(transaction, accountId);

              if (found === undefined) {
                return Result.fail(new AccountNotFound({ accountId }));
              }

              const accounts = await transaction.select().from(account);

              const decided = decide({
                account: found,
                accounts: accounts.map(record),
                hasEntries: await hasEntries(transaction, accountId),
                categories: await choosableCategories(transaction),
              });

              if (Result.isFailure(decided)) {
                return Result.fail(decided.failure);
              }

              const [changed] = await transaction
                .update(account)
                .set(decided.success)
                .where(eq(account.id, accountId))
                .returning();

              if (changed === undefined) {
                return Result.fail(new AccountNotFound({ accountId }));
              }

              await remakeBalanceLines(transaction, owner);

              // A benefit card's issuer, days, cap and category shape what its top-ups are (#28).
              await matchTopUpsIn(transaction, owner);
              await topUpsToBalanceCategories(transaction, { every: true });

              return Result.succeed(record(changed));
            },
          )
          .pipe(Effect.flatMap(Effect.fromResult)),

      noteBalance: <E>(
        owner: string,
        accountId: string,
        decide: (account: AccountRecord) => Result.Result<DayBalance, E>,
      ) =>
        userData
          .transaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<DayBalance, E | AccountNotFound | BalanceAlreadyNoted>> => {
              // The movement line is made in this transaction (`./balance-lines`).
              await takeCategoryTurn(transaction, owner);

              const found = await findAccount(transaction, accountId);

              if (found === undefined) {
                return Result.fail(new AccountNotFound({ accountId }));
              }

              const decided = decide(found);

              if (Result.isFailure(decided)) {
                return Result.fail(decided.failure);
              }

              const noted = decided.success;

              const [taken] = await transaction
                .select({ id: accountBalance.id })
                .from(accountBalance)
                .where(
                  and(
                    eq(accountBalance.accountId, accountId),
                    eq(accountBalance.source, "noted"),
                    eq(accountBalance.day, noted.day),
                  ),
                )
                .limit(1);

              if (taken !== undefined) {
                return Result.fail(new BalanceAlreadyNoted({ accountId, day: noted.day }));
              }

              await transaction.insert(accountBalance).values({
                userId: owner,
                accountId,
                day: noted.day,
                balanceMinor: noted.minor,
                source: "noted",
              });

              await remakeBalanceLines(transaction, owner);

              return Result.succeed(noted);
            },
          )
          // Two calls noting the same day at once: the unique index refuses the second (23505).
          .pipe(Effect.flatMap(Effect.fromResult)),

      setLineExpiry: <E>(
        owner: string,
        lineId: string,
        decide: (line: LineFacts) => Result.Result<string | null, E>,
      ) =>
        userData
          .transaction(
            owner,
            async (transaction): Promise<Result.Result<LineExpiry, E | LineNotFound>> => {
              if (!isId(lineId)) {
                return Result.fail(new LineNotFound({ lineId }));
              }

              // Row-level security keeps another user's line out: as good as unknown. The line is
              // locked until the write, so that a concurrent change of it waits.
              const [found] = await transaction
                .select({
                  id: statementLine.id,
                  bookedOn: statementLine.bookedOn,
                  amountMinor: statementLine.amountMinor,
                  state: statementLine.state,
                  expiresOn: statementLine.expiresOn,
                  account,
                })
                .from(statementLine)
                .innerJoin(account, eq(account.id, statementLine.accountId))
                .where(eq(statementLine.id, lineId))
                .for("update", { of: statementLine });

              if (found === undefined) {
                return Result.fail(new LineNotFound({ lineId }));
              }

              const decided = decide({ ...found, account: record(found.account) });

              if (Result.isFailure(decided)) {
                return Result.fail(decided.failure);
              }

              const [changed] = await transaction
                .update(statementLine)
                .set({ expiresOn: decided.success })
                .where(eq(statementLine.id, lineId))
                .returning({
                  accountId: statementLine.accountId,
                  expiresOn: statementLine.expiresOn,
                });

              return changed === undefined
                ? Result.fail(new LineNotFound({ lineId }))
                : Result.succeed({ lineId, ...changed });
            },
          )
          .pipe(Effect.flatMap(Effect.fromResult)),
    };
  }),
);
