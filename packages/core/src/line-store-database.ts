import {
  account,
  entry,
  entryPart,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, desc, eq, exists, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { categoriesOfLines } from "./category-store-database";
import type { LineCategory } from "./category-store";
import { LineStore } from "./line-store";
import { linesWithSeveralCandidates } from "./transfers/pair-lines";
import type { FoundLine, FoundLineDetail, LineQuery } from "./line-store";

// Every line of the user's, through `UserData` only (docs/data-model.md, "Ownership and
// isolation"). Every value goes in as a parameter, never into the SQL's text.
//
// The text is searched with `ilike` and no index of its own: under row-level security Postgres
// applies a condition whose operator is not leakproof (`ilike`, pg_trgm's) only after the policy's,
// so a trigram index is never used (docs/data-model.md, "Statement lines", measured for #21). The
// policy's `user_id` picks the user's rows by index; the text is then read on each.

/** A uuid, as the database writes them: anything else names no row, and would fail the query. */
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const isId = (id: string) => UUID.test(id);

/** The text a search reads: the label, the memo and the counterparty's name, as one. */
const searched = sql`(${statementLine.label} || ' ' || coalesce(${statementLine.memo}, '') || ' ' || coalesce(${statementLine.counterpartyName}, ''))`;

/** `%`, `_` and `\` are themselves in a search, not `like`'s wildcards. */
const substring = (text: string) => `%${text.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;

type AccountColumns = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly currency: string;
};

/** The amount's bounds, by the currency of each line's account: one condition per account. */
function amountCondition(
  accounts: ReadonlyArray<AccountColumns>,
  bounds: NonNullable<LineQuery["amount"]>,
): SQL {
  const absolute = sql`abs(${statementLine.amountMinor})`;

  const each = accounts.flatMap(({ id, currency }) => {
    const bound = bounds(currency);

    if (bound === null) {
      return [];
    }

    const condition = and(
      eq(statementLine.accountId, id),
      bound.minMinor === null ? undefined : sql`${absolute} >= ${bound.minMinor}`,
      bound.maxMinor === null ? undefined : sql`${absolute} <= ${bound.maxMinor}`,
    );

    return condition === undefined ? [] : [condition];
  });

  return or(...each) ?? sql`false`;
}

/**
 * A line whose entry is still where the import put it, in its kind's fallback: to classify. A noted
 * balance's movement in its account's own category is not (#31): the user chose that category.
 */
const byDefault = exists(
  sql`(select 1 from ${entryPart} inner join ${entry} on ${entry.id} = ${entryPart.entryId} where ${entryPart.lineId} = ${statementLine.id} and ${entry.classifiedBy} = 'default' and not (${statementLine.source} = 'balance' and ${entry.categoryId} = (select ${account.balanceCategoryId} from ${account} where ${account.id} = ${statementLine.accountId})))`,
);

function conditions(accounts: ReadonlyArray<AccountColumns>, query: LineQuery) {
  const ofState = eq(statementLine.state, query.state);
  const ids = query.alsoLineIds.filter(isId);

  return and(
    query.state === "held"
      ? or(
          ofState,
          and(
            eq(statementLine.state, "counted"),
            ids.length > 0 ? or(inArray(statementLine.id, ids), byDefault) : byDefault,
          ),
        )
      : ofState,
    lte(statementLine.bookedOn, query.to),
    query.from === null ? undefined : gte(statementLine.bookedOn, query.from),
    query.accountId === null ? undefined : eq(statementLine.accountId, query.accountId),
    query.text === null ? undefined : sql`${searched} ilike ${substring(query.text)}`,
    query.amount === null ? undefined : amountCondition(accounts, query.amount),
  );
}

const lineColumns = {
  id: statementLine.id,
  bookedOn: statementLine.bookedOn,
  valueOn: statementLine.valueOn,
  label: statementLine.label,
  memo: statementLine.memo,
  counterpartyName: statementLine.counterpartyName,
  amountMinor: statementLine.amountMinor,
  state: statementLine.state,
  accountId: account.id,
  accountName: account.name,
  institution: account.institution,
  currency: account.currency,
  source: statementLine.source,
};

type LineColumns = {
  readonly id: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly label: string;
  readonly memo: string | null;
  readonly counterpartyName: string | null;
  readonly amountMinor: number;
  readonly state: "counted" | "held" | "discarded";
  readonly accountId: string;
  readonly accountName: string;
  readonly institution: string | null;
  readonly currency: string;
  readonly source: "import" | "manual" | "balance" | "counterpart";
};

/** A row of `lineColumns`, with its category; a discarded one is never asked for. */
function found(row: LineColumns, category: LineCategory | null): FoundLine {
  return {
    id: row.id,
    bookedOn: row.bookedOn,
    valueOn: row.valueOn,
    label: row.label,
    memo: row.memo,
    counterpartyName: row.counterpartyName,
    amountMinor: row.amountMinor,
    state: row.state === "held" ? "held" : "counted",
    account: {
      id: row.accountId,
      name: row.accountName,
      institution: row.institution,
      currency: row.currency,
    },
    category,
    fromBalance: row.source === "balance",
  };
}

// The accounts are read apart, not joined: a user has tens of them, and with a join Postgres reads
// each account's lines in turn, about three times the pages of reading the user's lines once by
// `user_id` (measured for #21 on 30,000 lines: 60 ms against 22 ms for a text search).
async function search(transaction: UserTransaction, query: LineQuery) {
  if (query.accountId !== null && !isId(query.accountId)) {
    return { lines: [], total: 0 };
  }

  const accounts = await transaction
    .select({
      id: account.id,
      name: account.name,
      institution: account.institution,
      currency: account.currency,
    })
    .from(account);

  const accountOf = new Map(accounts.map((each) => [each.id, each]));
  const where = conditions(accounts, query);
  const { after } = query;

  const older =
    after === null
      ? undefined
      : sql`(${statementLine.bookedOn}, ${statementLine.id}) < (${after.bookedOn}::date, ${after.id}::uuid)`;

  const rows = await transaction
    .select({
      id: statementLine.id,
      bookedOn: statementLine.bookedOn,
      valueOn: statementLine.valueOn,
      label: statementLine.label,
      memo: statementLine.memo,
      counterpartyName: statementLine.counterpartyName,
      amountMinor: statementLine.amountMinor,
      state: statementLine.state,
      accountId: statementLine.accountId,
      source: statementLine.source,
    })
    .from(statementLine)
    .where(and(where, older))
    .orderBy(desc(statementLine.bookedOn), desc(statementLine.id))
    .limit(query.limit);

  const [counted] = await transaction
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(statementLine)
    .where(where);

  const categories = await categoriesOfLines(
    transaction,
    rows.map((row) => row.id),
  );

  // Every line's account is the user's (a composite foreign key) and so among those just read.
  const lines = rows.flatMap((row) => {
    const owned = accountOf.get(row.accountId);

    return owned === undefined
      ? []
      : [
          found(
            {
              ...row,
              accountName: owned.name,
              institution: owned.institution,
              currency: owned.currency,
            },
            categories.get(row.id) ?? null,
          ),
        ];
  });

  return { lines, total: counted?.total ?? 0 };
}

const duplicate = alias(statementLine, "duplicate");
const duplicateAccount = alias(account, "duplicate_account");

async function show(
  transaction: UserTransaction,
  lineId: string,
  day: string,
): Promise<FoundLineDetail | undefined> {
  if (!isId(lineId)) {
    return undefined;
  }

  const [row] = await transaction
    .select({
      ...lineColumns,
      originalAmountMinor: statementLine.originalAmountMinor,
      originalCurrency: statementLine.originalCurrency,
      counterpartyIban: statementLine.counterpartyIban,
      expiresOn: statementLine.expiresOn,
      duplicateId: duplicate.id,
      duplicateBookedOn: duplicate.bookedOn,
      duplicateLabel: duplicate.label,
      duplicateAmountMinor: duplicate.amountMinor,
      duplicateCurrency: duplicateAccount.currency,
      importId: statementImport.id,
      fileName: statementImport.fileName,
      format: statementImport.format,
      importedAt: statementImport.createdAt,
      periodFrom: statementImport.periodFrom,
      periodTo: statementImport.periodTo,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .leftJoin(duplicate, eq(duplicate.id, statementLine.duplicateOfLineId))
    .leftJoin(duplicateAccount, eq(duplicateAccount.id, duplicate.accountId))
    .leftJoin(statementImport, eq(statementImport.id, statementLine.importId))
    .where(
      and(
        eq(statementLine.id, lineId),
        inArray(statementLine.state, ["counted", "held"]),
        lte(statementLine.bookedOn, day),
      ),
    );

  if (row === undefined) {
    return undefined;
  }

  const categories = await categoriesOfLines(transaction, [row.id]);

  return {
    ...found(row, categories.get(row.id) ?? null),
    source: row.source,
    originalAmountMinor: row.originalAmountMinor,
    originalCurrency: row.originalCurrency,
    counterpartyIban: row.counterpartyIban,
    expiresOn: row.expiresOn,
    duplicateOf:
      row.duplicateId === null ||
      row.duplicateBookedOn === null ||
      row.duplicateLabel === null ||
      row.duplicateAmountMinor === null ||
      row.duplicateCurrency === null
        ? null
        : {
            id: row.duplicateId,
            bookedOn: row.duplicateBookedOn,
            label: row.duplicateLabel,
            amountMinor: row.duplicateAmountMinor,
            currency: row.duplicateCurrency,
          },
    import:
      row.importId === null ||
      row.fileName === null ||
      row.format === null ||
      row.importedAt === null
        ? null
        : {
            id: row.importId,
            fileName: row.fileName,
            format: row.format,
            importedAt: row.importedAt.toISOString(),
            periodFrom: row.periodFrom,
            periodTo: row.periodTo,
          },
  };
}

/** `LineStore` on the user's tables, through `UserData`. */
export const DatabaseLineStore = Layer.effect(
  LineStore,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      search: (owner, query) =>
        userData.transaction(owner, (transaction) => search(transaction, query)),

      show: (owner, lineId, day) =>
        userData.transaction(owner, (transaction) => show(transaction, lineId, day)),

      severalCandidates: (owner, day) =>
        userData.transaction(owner, (transaction) => linesWithSeveralCandidates(transaction, day)),
    };
  }),
);
