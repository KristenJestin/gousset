import {
  account,
  accountBalance,
  category,
  entry,
  entryPart,
  entrySubject,
  merchant,
  merchantAlias,
  statementLine,
  subject,
  subjectAccount,
  subjectEntryRefused,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, count, eq, exists, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Result } from "effect";

import type { AccountKind, AccountMode } from "../account-values";
import { balanceAt } from "../balances";
import { takeCategoryTurn } from "../category-turn";
import type { LineCategory } from "../category-store";
import { isId } from "../imports/rows";
import type { LineAccount } from "../lines";
import { merchantKey } from "../merchants/labels";
import type { Money } from "../month";
import { today } from "../today";
import { costsOf, countedIn, makesCycle, monthsOf, subtreeOf, sumsOf, treeOrder } from "./counting";
import type { CostPart, SubjectCost } from "./counting";
import { EntryNotFound, SubjectNameTaken, SubjectNotFound, SubjectRefused } from "./errors";

// The subjects (v0.5, #37; docs/vision.md, "Subjects"; docs/data-model.md, "v0.5: Subjects"): what
// the money is spent for, beside the category. Created by the user, nested at any depth, archived
// rather than deleted. An expense has zero, one or several; its cost counts by the rule of
// `./counting`, the same in every read here and in the month's "by subject" (`../month`).
//
// A subject "with dates" proposes the expenses of its period that are not attached to it yet; the
// maintainer's decision (#37): none is attached without the user's yes (`attachSubject`), and one
// the user declines is never proposed for it again (`refuseProposals`).

/** The most subjects a user may have, archived ones included. */
export const MAX_SUBJECTS = 200;

/** The longest a subject's name may be, once trimmed. */
export const MAX_SUBJECT_NAME = 100;

/** How many of a subject's latest expenses its page gives. */
export const SUBJECT_EXPENSES_SHOWN = 10;

/** How many proposals a subject with dates gives at most, the oldest first. */
export const SUBJECT_PROPOSALS_SHOWN = 100;

/** How many expenses one attachment or refusal names at most. */
export const MAX_ATTACHED = 500;

/** A subject as the user set it up. */
export type SubjectRecord = {
  readonly id: string;
  readonly name: string;
  /** Null for a top-level subject. */
  readonly parentId: string | null;
  /** Its parent's name; null at the top. */
  readonly parentName: string | null;
  readonly archived: boolean;
  /** "Has a value": what it is worth, in its own currency; null without. */
  readonly value: Money | null;
  /** The loan account it is bought with; null without. */
  readonly loan: LineAccount | null;
  /** "Has dates": its period, the end null while it goes on; both null without. */
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  /** The accounts linked to it, by name. */
  readonly accounts: ReadonlyArray<LineAccount>;
};

/**
 * A subject's figure in the list. Without dates: what it cost this year (`total`, in the user's
 * currency) and per month over the months counted (from January, or its first expense, to today's
 * month; null with none). With dates: its dates and what it cost in all.
 */
export type SubjectHeadline =
  | {
      readonly kind: "monthly";
      readonly year: number;
      readonly months: number;
      readonly total: Money;
      readonly perMonth: Money | null;
      /** What it cost this year in other currencies, never converted. */
      readonly elsewhere: ReadonlyArray<Money>;
    }
  | {
      readonly kind: "dated";
      readonly startsOn: string;
      readonly endsOn: string | null;
      readonly total: Money;
      readonly elsewhere: ReadonlyArray<Money>;
    };

/** A subject in the list: its place in the tree and its figure. */
export type SubjectListed = SubjectRecord & {
  /** 0 at the top. */
  readonly depth: number;
  readonly headline: SubjectHeadline;
};

/** The user's subjects in tree order: each parent before its children, siblings by name. */
export type SubjectList = {
  /** The user's currency, the one figures are summed in. */
  readonly currency: string;
  readonly today: string;
  readonly subjects: ReadonlyArray<SubjectListed>;
};

/** What a subject's page reads: a year (the current one by default), or all time. */
export type SubjectPeriod = "all" | { readonly year: number };

/** An expense as a subject's page lists it. */
export type SubjectExpense = {
  readonly entryId: string;
  readonly happenedOn: string;
  /** Who was paid: its own merchant, else its first payment's; null when none is known. */
  readonly merchant: string | null;
  /** Its first payment's label, as the bank wrote it. */
  readonly label: string;
  readonly category: LineCategory;
  /** Its net cost, in its own currency. */
  readonly net: Money;
};

/** An account of the subject's, with its balance today. */
export type SubjectAccountBalance = LineAccount & {
  readonly kind: AccountKind;
  readonly closedOn: string | null;
  readonly balance: Money;
};

/** A subject's page (`showSubject`). */
export type SubjectDetail = Omit<SubjectRecord, "accounts" | "loan"> & {
  readonly currency: string;
  readonly today: string;
  /** The days counted: `from` null for all time, `to` never after today. */
  readonly period:
    | { readonly kind: "year"; readonly year: number; readonly from: string; readonly to: string }
    | { readonly kind: "all"; readonly from: null; readonly to: string };
  /** What it and its descendants cost in the period, each expense once, in the user's currency. */
  readonly total: Money;
  /** The same in other currencies, never converted. */
  readonly elsewhere: ReadonlyArray<Money>;
  /**
   * Its cost month by month, in the user's currency: every month of the period up to today's,
   * starting no earlier than its first expense; none without an expense.
   */
  readonly months: ReadonlyArray<{ readonly month: string; readonly spent: Money }>;
  /** Its cost by category, in the user's currency, the largest first. */
  readonly categories: ReadonlyArray<{ readonly category: LineCategory; readonly spent: Money }>;
  readonly accounts: ReadonlyArray<SubjectAccountBalance>;
  readonly loan: SubjectAccountBalance | null;
  /** Its direct children, by name, each with what it cost in the period. */
  readonly children: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly archived: boolean;
    readonly total: Money;
    readonly elsewhere: ReadonlyArray<Money>;
  }>;
  /** Its latest expenses of the period, the newest first, and how many it has in the period. */
  readonly expenses: { readonly latest: ReadonlyArray<SubjectExpense>; readonly count: number };
  /**
   * With dates: the expenses of its period attached neither to it nor to a descendant, and not
   * refused for it, the oldest first, `SUBJECT_PROPOSALS_SHOWN` at most, with how many more there
   * are. Never attached unasked. Null for a subject without dates.
   */
  readonly proposals: {
    readonly expenses: ReadonlyArray<SubjectExpense>;
    readonly more: number;
  } | null;
};

/** A new subject. Every field but the name may be left out. */
export type SubjectInput = {
  readonly name: string;
  readonly parentId?: string | null;
  /** In minor units of `valueCurrency`; both or neither. */
  readonly valueMinor?: number | null;
  readonly valueCurrency?: string | null;
  /** One of the user's `loan` accounts. */
  readonly loanAccountId?: string | null;
  /** `YYYY-MM-DD`; an end needs a start. */
  readonly startsOn?: string | null;
  readonly endsOn?: string | null;
  /** The accounts linked to it, all of them. */
  readonly accountIds?: ReadonlyArray<string>;
};

/** A subject's change: each field left out stays as it is. `accountIds` replaces the links. */
export type SubjectEdit = Partial<SubjectInput> & { readonly archived?: boolean };

/** What an attachment, a removal or a refusal did. */
export type SubjectAttachment = {
  readonly subjectId: string;
  /** The expenses named. */
  readonly entries: number;
  /** Those it changed: the others were already as asked. */
  readonly changed: number;
};

type SubjectRow = typeof subject.$inferSelect;

type AccountRow = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly kind: AccountKind;
  readonly currency: string;
  readonly mode: AccountMode;
  readonly openingBalanceMinor: number;
  readonly closedOn: string | null;
};

/** The first key of the lock a user's changes of the subjects take, the user's the second. */
const CHANGE_LOCK = "gousset.subject.change";

/**
 * Takes the user's turn among the changes of the subjects until the transaction ends, so that two
 * moves never make a cycle together, nor two creations pass the limit or share a name.
 */
const takeSubjectTurn = (transaction: UserTransaction, owner: string) =>
  transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${CHANGE_LOCK}), hashtext(${owner}))`,
  );

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function isDay(text: string): boolean {
  if (!DAY.test(text)) {
    return false;
  }

  const date = new Date(`${text}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const money = (minor: number, currency: string): Money => ({ minor, currency });

const moneyElsewhere = (elsewhere: ReadonlyArray<readonly [string, number]>) =>
  elsewhere.map(([currency, minor]) => money(minor, currency));

type RefusedAbout = {
  readonly subjectId?: string;
  readonly accountId?: string;
  readonly entryId?: string;
};

const refusal = (reason: SubjectRefused["reason"], about: RefusedAbout = {}) =>
  new SubjectRefused({ reason, ...about });

const refused = (reason: SubjectRefused["reason"], about: RefusedAbout = {}) =>
  Result.fail(refusal(reason, about));

const comparable = (name: string) => name.trim().toLowerCase();

const parent = alias(category, "parent");

/** Every account of the user's, by name: a user has tens of them. */
const accountsOf = (transaction: UserTransaction): Promise<ReadonlyArray<AccountRow>> =>
  transaction
    .select({
      id: account.id,
      name: account.name,
      institution: account.institution,
      kind: account.kind,
      currency: account.currency,
      mode: account.mode,
      openingBalanceMinor: account.openingBalanceMinor,
      closedOn: account.closedOn,
    })
    .from(account)
    .orderBy(asc(account.name), asc(account.id));

const lineAccount = (row: AccountRow): LineAccount => ({
  id: row.id,
  name: row.name,
  institution: row.institution,
});

/** Each subject's linked accounts' ids. */
async function linksOf(
  transaction: UserTransaction,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  const rows = await transaction
    .select({ subjectId: subjectAccount.subjectId, accountId: subjectAccount.accountId })
    .from(subjectAccount);

  const links = new Map<string, Array<string>>();

  for (const row of rows) {
    links.set(row.subjectId, [...(links.get(row.subjectId) ?? []), row.accountId]);
  }

  return links;
}

const subjectRows = (transaction: UserTransaction): Promise<ReadonlyArray<SubjectRow>> =>
  transaction.select().from(subject);

/** A subject's row as the user set it up, with its accounts named. */
function recordOf(
  row: SubjectRow,
  rows: ReadonlyArray<SubjectRow>,
  accounts: ReadonlyMap<string, AccountRow>,
  links: ReadonlyMap<string, ReadonlyArray<string>>,
): SubjectRecord {
  const loan = row.loanAccountId === null ? undefined : accounts.get(row.loanAccountId);

  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    parentName: rows.find((each) => each.id === row.parentId)?.name ?? null,
    archived: row.archivedAt !== null,
    value:
      row.estimatedValueMinor === null || row.valueCurrency === null
        ? null
        : money(row.estimatedValueMinor, row.valueCurrency),
    loan: loan === undefined ? null : lineAccount(loan),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    accounts: (links.get(row.id) ?? [])
      .flatMap((id) => {
        const found = accounts.get(id);

        return found === undefined ? [] : [found];
      })
      .toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(lineAccount),
  };
}

/** The subjects named, as their tree reads them. */
const nodesOf = (rows: ReadonlyArray<SubjectRow>) =>
  rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));

/**
 * The expenses attached to any of `subjectIds` (every subject when null), happened up to `day`,
 * each at its net cost per currency, with the subjects among those it is attached to.
 */
async function costsIn(
  transaction: UserTransaction,
  subjectIds: ReadonlyArray<string> | null,
  day: string,
): Promise<ReadonlyArray<SubjectCost>> {
  const among = subjectIds === null ? undefined : inArray(entrySubject.subjectId, [...subjectIds]);

  if (subjectIds !== null && subjectIds.length === 0) {
    return [];
  }

  const links = await transaction
    .select({ entryId: entrySubject.entryId, subjectId: entrySubject.subjectId })
    .from(entrySubject)
    .where(among);

  if (links.length === 0) {
    return [];
  }

  const subjectsOf = new Map<string, Array<string>>();

  for (const link of links) {
    subjectsOf.set(link.entryId, [...(subjectsOf.get(link.entryId) ?? []), link.subjectId]);
  }

  const parts: ReadonlyArray<CostPart> = await transaction
    .select({
      entryId: entry.id,
      happenedOn: entry.happenedOn,
      categoryId: entry.categoryId,
      role: entryPart.role,
      amountMinor: entryPart.amountMinor,
      currency: account.currency,
    })
    .from(entry)
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(entry.kind, "expense"),
        lte(entry.happenedOn, day),
        exists(
          transaction
            .select({ one: sql`1` })
            .from(entrySubject)
            .where(and(eq(entrySubject.entryId, entry.id), among)),
        ),
      ),
    )
    .orderBy(asc(entry.happenedOn), asc(entry.id));

  return costsOf(parts, subjectsOf);
}

/** The first day of the earliest of `costs`, its month `YYYY-MM`; null with none. */
const firstMonthOf = (costs: ReadonlyArray<SubjectCost>) =>
  costs
    .reduce<string | null>(
      (first, cost) => (first === null || cost.happenedOn < first ? cost.happenedOn : first),
      null,
    )
    ?.slice(0, 7) ?? null;

const earlier = (a: string, b: string) => (a < b ? a : b);

/** A subject's figure in the list, as of `day`. */
function headlineOf(
  row: SubjectRow,
  counted: ReadonlyArray<SubjectCost>,
  currency: string,
  day: string,
): SubjectHeadline {
  if (row.startsOn !== null) {
    const sums = sumsOf(counted, currency);

    return {
      kind: "dated",
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      total: money(sums.own, currency),
      elsewhere: moneyElsewhere(sums.elsewhere),
    };
  }

  const year = day.slice(0, 4);

  const sums = sumsOf(
    counted.filter((cost) => cost.happenedOn >= `${year}-01-01`),
    currency,
  );

  const months = monthsOf(`${year}-01`, day.slice(0, 7), firstMonthOf(counted)).length;

  return {
    kind: "monthly",
    year: Number(year),
    months,
    total: money(sums.own, currency),
    perMonth: months === 0 ? null : money(Math.round(sums.own / months), currency),
    elsewhere: moneyElsewhere(sums.elsewhere),
  };
}

async function listIn(
  transaction: UserTransaction,
  currency: string,
  day: string,
): Promise<SubjectList> {
  const rows = await subjectRows(transaction);
  const accounts = new Map((await accountsOf(transaction)).map((each) => [each.id, each]));
  const links = await linksOf(transaction);
  const costs = await costsIn(transaction, null, day);
  const nodes = nodesOf(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    currency,
    today: day,
    subjects: treeOrder(nodes).flatMap((node): ReadonlyArray<SubjectListed> => {
      const row = byId.get(node.id);

      if (row === undefined) {
        return [];
      }

      const counted = countedIn(costs, subtreeOf(nodes, row.id));

      return [
        {
          ...recordOf(row, rows, accounts, links),
          depth: node.depth,
          headline: headlineOf(row, counted, currency, day),
        },
      ];
    }),
  };
}

/** Each account's balance today: kept by its lines, or by the balances noted. */
async function balancesOf(
  transaction: UserTransaction,
  accounts: ReadonlyArray<AccountRow>,
  day: string,
): Promise<ReadonlyArray<SubjectAccountBalance>> {
  const ids = accounts.map((each) => each.id);

  if (ids.length === 0) {
    return [];
  }

  const counted = await transaction
    .select({
      accountId: statementLine.accountId,
      minor: sql<number>`coalesce(sum(${statementLine.amountMinor}), 0)::bigint`.mapWith(Number),
    })
    .from(statementLine)
    .where(
      and(
        inArray(statementLine.accountId, ids),
        eq(statementLine.state, "counted"),
        lte(statementLine.bookedOn, day),
      ),
    )
    .groupBy(statementLine.accountId);

  const noted = await transaction
    .select({
      accountId: accountBalance.accountId,
      day: accountBalance.day,
      minor: accountBalance.balanceMinor,
    })
    .from(accountBalance)
    .where(
      and(
        inArray(accountBalance.accountId, ids),
        eq(accountBalance.source, "noted"),
        lte(accountBalance.day, day),
      ),
    )
    .orderBy(asc(accountBalance.day));

  return accounts.map((each) => ({
    ...lineAccount(each),
    kind: each.kind,
    closedOn: each.closedOn,
    balance: money(
      balanceAt(
        each,
        counted.find((row) => row.accountId === each.id)?.minor ?? 0,
        noted.filter((row) => row.accountId === each.id),
        day,
      ),
      each.currency,
    ),
  }));
}

/** The expenses `entryIds` as a subject's page lists them, each at its `net`, in that order. */
async function expensesOf(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
  netOf: (entryId: string) => Money,
): Promise<ReadonlyArray<SubjectExpense>> {
  if (entryIds.length === 0) {
    return [];
  }

  const rows = await transaction
    .select({
      id: entry.id,
      happenedOn: entry.happenedOn,
      merchantId: entry.merchantId,
      categoryId: category.id,
      categoryName: category.name,
      categoryKind: category.kind,
      parentName: parent.name,
    })
    .from(entry)
    .innerJoin(category, eq(category.id, entry.categoryId))
    .leftJoin(parent, eq(parent.id, category.parentId))
    .where(inArray(entry.id, [...entryIds]));

  const payments = await transaction
    .select({
      entryId: entryPart.entryId,
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(entryPart)
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(and(inArray(entryPart.entryId, [...entryIds]), eq(entryPart.role, "payment")))
    .orderBy(asc(statementLine.bookedOn), asc(statementLine.id));

  const firstPayment = new Map<string, (typeof payments)[number]>();

  for (const payment of payments) {
    if (!firstPayment.has(payment.entryId)) {
      firstPayment.set(payment.entryId, payment);
    }
  }

  const keyOf = new Map(
    [...firstPayment].map(([entryId, payment]) => [
      entryId,
      merchantKey(payment.label, payment.counterpartyName),
    ]),
  );

  const keys = [...new Set([...keyOf.values()].flatMap((key) => (key === null ? [] : [key])))];

  const aliases =
    keys.length === 0
      ? []
      : await transaction
          .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
          .from(merchantAlias)
          .where(inArray(merchantAlias.alias, keys));

  const merchantIds = [
    ...new Set([
      ...rows.flatMap((row) => (row.merchantId === null ? [] : [row.merchantId])),
      ...aliases.map((each) => each.merchantId),
    ]),
  ];

  const merchants = new Map(
    (merchantIds.length === 0
      ? []
      : await transaction
          .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
          .from(merchant)
          .where(inArray(merchant.id, merchantIds))
    ).map((each) => [each.id, each]),
  );

  const byAlias = new Map(aliases.map((each) => [each.alias, each.merchantId]));

  return entryIds.flatMap((entryId): ReadonlyArray<SubjectExpense> => {
    const row = rows.find((each) => each.id === entryId);

    if (row === undefined) {
      return [];
    }

    // Its own merchant when it is no intermediary, else its line's, as the month names it.
    const own = row.merchantId === null ? undefined : merchants.get(row.merchantId);
    const key = keyOf.get(entryId) ?? null;
    const named = key === null ? undefined : merchants.get(byAlias.get(key) ?? "");
    const chosen = own !== undefined && !own.intermediary ? own : (named ?? own);

    return [
      {
        entryId,
        happenedOn: row.happenedOn,
        merchant: chosen?.name ?? null,
        label: firstPayment.get(entryId)?.label ?? "",
        category: {
          id: row.categoryId,
          name: row.categoryName,
          parentName: row.parentName,
          kind: row.categoryKind,
        },
        net: netOf(entryId),
      },
    ];
  });
}

/** The proposals of a subject with dates (`SubjectDetail.proposals`). */
async function proposalsOf(
  transaction: UserTransaction,
  row: SubjectRow & { readonly startsOn: string },
  subtree: ReadonlySet<string>,
  day: string,
): Promise<NonNullable<SubjectDetail["proposals"]>> {
  const until = row.endsOn === null ? day : earlier(row.endsOn, day);

  const where = and(
    eq(entry.kind, "expense"),
    gte(entry.happenedOn, row.startsOn),
    lte(entry.happenedOn, until),
    notExists(
      transaction
        .select({ one: sql`1` })
        .from(entrySubject)
        .where(
          and(eq(entrySubject.entryId, entry.id), inArray(entrySubject.subjectId, [...subtree])),
        ),
    ),
    notExists(
      transaction
        .select({ one: sql`1` })
        .from(subjectEntryRefused)
        .where(
          and(eq(subjectEntryRefused.entryId, entry.id), eq(subjectEntryRefused.subjectId, row.id)),
        ),
    ),
  );

  const nets = await transaction
    .select({
      entryId: entry.id,
      happenedOn: entry.happenedOn,
      currency: account.currency,
      minor:
        sql<number>`sum(case when ${entryPart.role} = 'payment' then ${entryPart.amountMinor} else -${entryPart.amountMinor} end)::bigint`.mapWith(
          Number,
        ),
    })
    .from(entry)
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(where)
    .groupBy(entry.id, entry.happenedOn, account.currency)
    .orderBy(asc(entry.happenedOn), asc(entry.id))
    .limit(SUBJECT_PROPOSALS_SHOWN);

  const [counted] = await transaction.select({ entries: count() }).from(entry).where(where);
  const shown = [...new Set(nets.map((each) => each.entryId))];

  const netOf = (entryId: string) => {
    const found = nets.find((each) => each.entryId === entryId);

    return money(found?.minor ?? 0, found?.currency ?? "");
  };

  return {
    expenses: await expensesOf(transaction, shown, netOf),
    more: Math.max(0, (counted?.entries ?? 0) - shown.length),
  };
}

/** The days a period counts, as of `day`. */
function periodOf(
  period: SubjectPeriod,
  day: string,
): Result.Result<SubjectDetail["period"], SubjectRefused> {
  if (period === "all") {
    return Result.succeed({ kind: "all", from: null, to: day });
  }

  const { year } = period;

  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    return refused("period");
  }

  return Result.succeed({
    kind: "year",
    year,
    from: `${year}-01-01`,
    to: earlier(`${year}-12-31`, day),
  });
}

async function showIn(
  transaction: UserTransaction,
  subjectId: string,
  currency: string,
  period: SubjectDetail["period"],
  day: string,
): Promise<Result.Result<SubjectDetail, SubjectNotFound>> {
  const rows = await subjectRows(transaction);
  const row = isId(subjectId) ? rows.find((each) => each.id === subjectId) : undefined;

  if (row === undefined) {
    return Result.fail(new SubjectNotFound({ subjectId }));
  }

  const nodes = nodesOf(rows);
  const subtree = subtreeOf(nodes, row.id);
  const accountRows = await accountsOf(transaction);
  const accounts = new Map(accountRows.map((each) => [each.id, each]));
  const record = recordOf(row, rows, accounts, await linksOf(transaction));
  const counted = countedIn(await costsIn(transaction, [...subtree], day), subtree);

  const inPeriod = counted.filter(
    (cost) =>
      (period.from === null || cost.happenedOn >= period.from) && cost.happenedOn <= period.to,
  );

  const sums = sumsOf(inPeriod, currency);
  const own = inPeriod.filter((cost) => cost.currency === currency);

  const months = monthsOf(
    period.from?.slice(0, 7) ?? null,
    earlier(period.to.slice(0, 7), day.slice(0, 7)),
    firstMonthOf(counted),
  ).map((month) => ({
    month,
    spent: money(
      own.reduce((sum, cost) => (cost.happenedOn.startsWith(month) ? sum + cost.minor : sum), 0),
      currency,
    ),
  }));

  const byCategory = new Map<string, number>();

  for (const cost of own) {
    byCategory.set(cost.categoryId, (byCategory.get(cost.categoryId) ?? 0) + cost.minor);
  }

  const categoryIds = [...byCategory.keys()];

  const categoryRows =
    categoryIds.length === 0
      ? []
      : await transaction
          .select({
            id: category.id,
            name: category.name,
            kind: category.kind,
            parentName: parent.name,
          })
          .from(category)
          .leftJoin(parent, eq(parent.id, category.parentId))
          .where(inArray(category.id, categoryIds));

  const categories = categoryRows
    .map((each) => ({ category: each, spent: money(byCategory.get(each.id) ?? 0, currency) }))
    .filter((each) => each.spent.minor !== 0)
    .toSorted(
      (a, b) => b.spent.minor - a.spent.minor || a.category.name.localeCompare(b.category.name),
    );

  const children = treeOrder(nodes).flatMap((node) => {
    const child = rows.find((each) => each.id === node.id);

    if (child === undefined || child.parentId !== row.id) {
      return [];
    }

    const childSums = sumsOf(countedIn(inPeriod, subtreeOf(nodes, child.id)), currency);

    return [
      {
        id: child.id,
        name: child.name,
        archived: child.archivedAt !== null,
        total: money(childSums.own, currency),
        elsewhere: moneyElsewhere(childSums.elsewhere),
      },
    ];
  });

  const linked = record.accounts.flatMap((each) => {
    const found = accounts.get(each.id);

    return found === undefined ? [] : [found];
  });

  const loanRow = row.loanAccountId === null ? undefined : accounts.get(row.loanAccountId);

  const balances = await balancesOf(
    transaction,
    loanRow === undefined ? linked : [...linked, loanRow],
    day,
  );

  const newestFirst = [...new Set(inPeriod.toReversed().map((cost) => cost.entryId))];

  const netOf = (entryId: string) => {
    const found = inPeriod.find((cost) => cost.entryId === entryId);

    return money(found?.minor ?? 0, found?.currency ?? currency);
  };

  const latest = await expensesOf(transaction, newestFirst.slice(0, SUBJECT_EXPENSES_SHOWN), netOf);

  return Result.succeed({
    ...record,
    currency,
    today: day,
    period,
    total: money(sums.own, currency),
    elsewhere: moneyElsewhere(sums.elsewhere),
    months,
    categories,
    accounts: balances.filter((each) => linked.some((link) => link.id === each.id)),
    loan: balances.find((each) => each.id === loanRow?.id) ?? null,
    children,
    expenses: { latest, count: newestFirst.length },
    proposals:
      row.startsOn === null
        ? null
        : await proposalsOf(transaction, { ...row, startsOn: row.startsOn }, subtree, day),
  });
}

/** What a subject's settings are once `edit` changed `row`'s (or a new one's, with no row). */
type Settings = {
  readonly name: string;
  readonly parentId: string | null;
  readonly valueMinor: number | null;
  readonly valueCurrency: string | null;
  readonly loanAccountId: string | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
};

type SettingsProblem = SubjectRefused | SubjectNameTaken;

/**
 * What is wrong with `settings` for the subject `id` (null for a new one), against the user's
 * subjects and accounts; null when nothing. `changed` says which fields were given: those left out
 * stay as they were, and were checked when set.
 */
function problemOf(
  settings: Settings,
  id: string | null,
  changed: ReadonlySet<keyof Settings | "accountIds">,
  rows: ReadonlyArray<SubjectRow>,
  accounts: ReadonlyMap<string, AccountRow>,
  accountIds: ReadonlyArray<string>,
): SettingsProblem | null {
  const name = settings.name.trim();

  if (
    changed.has("name") &&
    (name === "" || name.length > MAX_SUBJECT_NAME || name.includes(">"))
  ) {
    return refusal("name");
  }

  if (changed.has("parentId") && settings.parentId !== null) {
    const parentRow = isId(settings.parentId)
      ? rows.find((each) => each.id === settings.parentId)
      : undefined;

    if (parentRow === undefined) {
      return refusal("parent_missing", { subjectId: settings.parentId });
    }

    if (id !== null && makesCycle(nodesOf(rows), id, parentRow.id)) {
      return refusal("cycle", { subjectId: parentRow.id });
    }

    if (parentRow.archivedAt !== null) {
      return refusal("parent_archived", { subjectId: parentRow.id });
    }
  }

  if (changed.has("name") || changed.has("parentId")) {
    const taken = rows.some(
      (each) =>
        each.id !== id &&
        each.parentId === settings.parentId &&
        comparable(each.name) === comparable(name),
    );

    if (taken) {
      return new SubjectNameTaken({ name });
    }
  }

  if (changed.has("valueMinor") || changed.has("valueCurrency")) {
    const { valueMinor, valueCurrency } = settings;

    if (
      (valueMinor === null) !== (valueCurrency === null) ||
      (valueMinor !== null && (!Number.isSafeInteger(valueMinor) || valueMinor < 0)) ||
      (valueCurrency !== null && !CURRENCY.test(valueCurrency))
    ) {
      return refusal("value");
    }
  }

  if (changed.has("loanAccountId") && settings.loanAccountId !== null) {
    if (accounts.get(settings.loanAccountId)?.kind !== "loan") {
      return refusal("loan", { accountId: settings.loanAccountId });
    }
  }

  if (changed.has("startsOn") || changed.has("endsOn")) {
    const { startsOn, endsOn } = settings;

    if (
      (startsOn !== null && !isDay(startsOn)) ||
      (endsOn !== null && !isDay(endsOn)) ||
      (endsOn !== null && (startsOn === null || endsOn < startsOn))
    ) {
      return refusal("dates");
    }
  }

  const foreign = accountIds.find((each) => !accounts.has(each));

  if (changed.has("accountIds") && foreign !== undefined) {
    return refusal("account", { accountId: foreign });
  }

  return null;
}

/** The fields of an edit or an input that were given. */
function givenOf(edit: SubjectEdit): ReadonlySet<keyof Settings | "accountIds"> {
  const given = new Set<keyof Settings | "accountIds">();

  for (const field of [
    "name",
    "parentId",
    "valueMinor",
    "valueCurrency",
    "loanAccountId",
    "startsOn",
    "endsOn",
    "accountIds",
  ] as const) {
    if (edit[field] !== undefined) {
      given.add(field);
    }
  }

  return given;
}

/** Writes `accountIds` as the subject's links, all of them. */
async function writeLinks(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  accountIds: ReadonlyArray<string>,
): Promise<void> {
  await transaction.delete(subjectAccount).where(eq(subjectAccount.subjectId, subjectId));

  const distinct = [...new Set(accountIds)];

  if (distinct.length > 0) {
    await transaction
      .insert(subjectAccount)
      .values(distinct.map((accountId) => ({ userId: owner, subjectId, accountId })));
  }
}

/** The subject just written, as the user set it up. */
async function recordIn(transaction: UserTransaction, subjectId: string): Promise<SubjectRecord> {
  const rows = await subjectRows(transaction);
  const row = rows.find((each) => each.id === subjectId);

  if (row === undefined) {
    throw new Error("The subject just written could not be read back.");
  }

  const accounts = new Map((await accountsOf(transaction)).map((each) => [each.id, each]));

  return recordOf(row, rows, accounts, await linksOf(transaction));
}

type CreateProblem = SettingsProblem;

async function createIn(
  transaction: UserTransaction,
  owner: string,
  input: SubjectInput,
): Promise<Result.Result<SubjectRecord, CreateProblem>> {
  await takeSubjectTurn(transaction, owner);

  const rows = await subjectRows(transaction);
  const accounts = new Map((await accountsOf(transaction)).map((each) => [each.id, each]));

  const settings: Settings = {
    name: input.name,
    parentId: input.parentId ?? null,
    valueMinor: input.valueMinor ?? null,
    valueCurrency: input.valueCurrency ?? null,
    loanAccountId: input.loanAccountId ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
  };

  // Everything is checked for a new subject, the name above all.
  const problem = problemOf(
    settings,
    null,
    new Set([...givenOf(input), "name", "parentId"]),
    rows,
    accounts,
    input.accountIds ?? [],
  );

  if (problem !== null) {
    return Result.fail(problem);
  }

  if (rows.length >= MAX_SUBJECTS) {
    return refused("too_many");
  }

  const [made] = await transaction
    .insert(subject)
    .values({
      userId: owner,
      name: settings.name.trim(),
      parentId: settings.parentId,
      estimatedValueMinor: settings.valueMinor,
      valueCurrency: settings.valueCurrency,
      loanAccountId: settings.loanAccountId,
      startsOn: settings.startsOn,
      endsOn: settings.endsOn,
    })
    .returning({ id: subject.id });

  if (made === undefined) {
    throw new Error("The insert returned no row.");
  }

  await writeLinks(transaction, owner, made.id, input.accountIds ?? []);

  return Result.succeed(await recordIn(transaction, made.id));
}

async function editIn(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  edit: SubjectEdit,
): Promise<Result.Result<SubjectRecord, SubjectNotFound | SettingsProblem>> {
  await takeSubjectTurn(transaction, owner);

  const rows = await subjectRows(transaction);
  const row = isId(subjectId) ? rows.find((each) => each.id === subjectId) : undefined;

  if (row === undefined) {
    return Result.fail(new SubjectNotFound({ subjectId }));
  }

  const accounts = new Map((await accountsOf(transaction)).map((each) => [each.id, each]));

  const settings: Settings = {
    name: edit.name ?? row.name,
    parentId: edit.parentId === undefined ? row.parentId : edit.parentId,
    valueMinor: edit.valueMinor === undefined ? row.estimatedValueMinor : edit.valueMinor,
    valueCurrency: edit.valueCurrency === undefined ? row.valueCurrency : edit.valueCurrency,
    loanAccountId: edit.loanAccountId === undefined ? row.loanAccountId : edit.loanAccountId,
    startsOn: edit.startsOn === undefined ? row.startsOn : edit.startsOn,
    endsOn: edit.endsOn === undefined ? row.endsOn : edit.endsOn,
  };

  const given = new Set(givenOf(edit));

  // A parent or a loan kept as it is stays, archived since or not.
  if (settings.parentId === row.parentId) {
    given.delete("parentId");
  }

  if (settings.loanAccountId === row.loanAccountId) {
    given.delete("loanAccountId");
  }

  const problem = problemOf(settings, row.id, given, rows, accounts, edit.accountIds ?? []);

  if (problem !== null) {
    return Result.fail(problem);
  }

  await transaction
    .update(subject)
    .set({
      name: settings.name.trim(),
      parentId: settings.parentId,
      estimatedValueMinor: settings.valueMinor,
      valueCurrency: settings.valueCurrency,
      loanAccountId: settings.loanAccountId,
      startsOn: settings.startsOn,
      endsOn: settings.endsOn,
      archivedAt:
        edit.archived === undefined
          ? row.archivedAt
          : edit.archived
            ? (row.archivedAt ?? new Date())
            : null,
    })
    .where(eq(subject.id, row.id));

  if (edit.accountIds !== undefined) {
    await writeLinks(transaction, owner, row.id, edit.accountIds);
  }

  return Result.succeed(await recordIn(transaction, row.id));
}

type AttachProblem = SubjectNotFound | SubjectRefused | EntryNotFound;

/**
 * The subject and the expenses an attachment names, or why they cannot be: `archived` refuses an
 * archived subject (`openOnly`), each entry must be an expense of the user's.
 */
async function attachable(
  transaction: UserTransaction,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
  openOnly: boolean,
): Promise<Result.Result<ReadonlyArray<string>, AttachProblem>> {
  if (entryIds.length > MAX_ATTACHED) {
    return refused("entries");
  }

  const [found] = isId(subjectId)
    ? await transaction
        .select({ id: subject.id, archivedAt: subject.archivedAt })
        .from(subject)
        .where(eq(subject.id, subjectId))
    : [];

  if (found === undefined) {
    return Result.fail(new SubjectNotFound({ subjectId }));
  }

  if (openOnly && found.archivedAt !== null) {
    return refused("archived", { subjectId });
  }

  const distinct = [...new Set(entryIds)];
  const invalid = distinct.find((each) => !isId(each));

  if (invalid !== undefined) {
    return Result.fail(new EntryNotFound({ entryId: invalid }));
  }

  const entries =
    distinct.length === 0
      ? []
      : await transaction
          .select({ id: entry.id, kind: entry.kind })
          .from(entry)
          .where(inArray(entry.id, distinct));

  for (const entryId of distinct) {
    const kind = entries.find((each) => each.id === entryId)?.kind;

    if (kind === undefined) {
      return Result.fail(new EntryNotFound({ entryId }));
    }

    if (kind !== "expense") {
      return refused("not_an_expense", { entryId });
    }
  }

  return Result.succeed(distinct);
}

async function attachIn(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
  remove: boolean,
): Promise<Result.Result<SubjectAttachment, AttachProblem>> {
  // A split remakes a line's expenses with their subjects in its own turn: the two take turns.
  await takeCategoryTurn(transaction, owner);

  const checked = await attachable(transaction, subjectId, entryIds, true);

  if (Result.isFailure(checked)) {
    return Result.fail(checked.failure);
  }

  const ids = checked.success;

  if (ids.length === 0) {
    return Result.succeed({ subjectId, entries: 0, changed: 0 });
  }

  const ofThese = and(eq(entrySubject.subjectId, subjectId), inArray(entrySubject.entryId, ids));

  if (remove) {
    const removed = await transaction
      .delete(entrySubject)
      .where(ofThese)
      .returning({ entryId: entrySubject.entryId });

    return Result.succeed({ subjectId, entries: ids.length, changed: removed.length });
  }

  const attached = await transaction
    .insert(entrySubject)
    .values(ids.map((entryId) => ({ userId: owner, entryId, subjectId })))
    .onConflictDoNothing()
    .returning({ entryId: entrySubject.entryId });

  // Attached by hand, an expense refused before is the subject's after all.
  await transaction
    .delete(subjectEntryRefused)
    .where(
      and(eq(subjectEntryRefused.subjectId, subjectId), inArray(subjectEntryRefused.entryId, ids)),
    );

  return Result.succeed({ subjectId, entries: ids.length, changed: attached.length });
}

async function refuseIn(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
): Promise<Result.Result<SubjectAttachment, AttachProblem>> {
  const checked = await attachable(transaction, subjectId, entryIds, false);

  if (Result.isFailure(checked)) {
    return Result.fail(checked.failure);
  }

  const ids = checked.success;

  if (ids.length === 0) {
    return Result.succeed({ subjectId, entries: 0, changed: 0 });
  }

  const written = await transaction
    .insert(subjectEntryRefused)
    .values(ids.map((entryId) => ({ userId: owner, subjectId, entryId })))
    .onConflictDoNothing()
    .returning({ entryId: subjectEntryRefused.entryId });

  return Result.succeed({ subjectId, entries: ids.length, changed: written.length });
}

/**
 * The user's subjects in tree order (each parent before its children, siblings by name, archived
 * ones marked), each with its options and its figure, in the user's `currency`: without dates, what
 * it cost this year and per month; with dates, its dates and what it cost in all.
 */
export const listSubjects = (owner: string, currency: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const day = yield* today;

    return yield* userData.transaction(owner, (transaction) => listIn(transaction, currency, day));
  });

/**
 * One subject's page, in the user's `currency`, for a year (the current one by default) or all
 * time: what it and its descendants cost (each expense once, by the day it happened, other
 * currencies apart), month by month, by category; its accounts and its loan with their balances
 * today, its value, its children, its latest expenses, and with dates the expenses of its period
 * proposed, never attached unasked. Fails with `SubjectNotFound`, or `SubjectRefused` (`period`) for
 * a year that is none.
 */
export const showSubject = (
  owner: string,
  subjectId: string,
  currency: string,
  period?: SubjectPeriod,
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const day = yield* today;

    const days = yield* Effect.fromResult(
      periodOf(period ?? { year: Number(day.slice(0, 4)) }, day),
    );

    const shown = yield* userData.transaction(owner, (transaction) =>
      showIn(transaction, subjectId, currency, days, day),
    );

    return yield* Effect.fromResult(shown);
  });

/**
 * Makes a subject. Refused: a name empty, over 100 characters or holding `>` (`SubjectRefused`
 * `name`), or a sibling's already (`SubjectNameTaken`, any case); a parent missing or archived; a
 * value without its currency, or the other way; a loan that is none of the user's `loan`
 * accounts; a linked account that is none of the user's; an end before the start, or without one;
 * `MAX_SUBJECTS` reached.
 */
export const createSubject = (owner: string, input: SubjectInput) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const made = yield* userData.transaction(owner, (transaction) =>
      createIn(transaction, owner, input),
    );

    return yield* Effect.fromResult(made);
  });

/**
 * Changes a subject: each field left out stays as it is, `accountIds` replaces its links, and
 * `archived` archives or restores it (it keeps its expenses; an archived subject can no longer be
 * chosen as a parent nor get expenses). A move refuses a cycle (`SubjectRefused` `cycle`): the new
 * parent's ancestors are walked in the transaction that moves it. Refused otherwise as
 * `createSubject` refuses it, and `SubjectNotFound`.
 */
export const editSubject = (owner: string, subjectId: string, edit: SubjectEdit) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const edited = yield* userData.transaction(owner, (transaction) =>
      editIn(transaction, owner, subjectId, edit),
    );

    return yield* Effect.fromResult(edited);
  });

/**
 * Attaches the expenses `entryIds` to a subject, or with `remove` takes them off it; confirming a
 * proposal is attaching it. Repeating it changes nothing. Attaching clears a refusal of the
 * expense for that subject. Refused: a subject missing (`SubjectNotFound`) or archived
 * (`SubjectRefused` `archived`), an entry missing (`EntryNotFound`) or an income (`not_an_expense`),
 * more than `MAX_ATTACHED` entries (`entries`); nothing is changed then.
 */
export const attachSubject = (
  owner: string,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
  options: { readonly remove?: boolean } = {},
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const done = yield* userData.transaction(owner, (transaction) =>
      attachIn(transaction, owner, subjectId, entryIds, options.remove === true),
    );

    return yield* Effect.fromResult(done);
  });

/**
 * The user declines the proposals `entryIds` of a subject with dates: they are never proposed for
 * it again, until one is attached by hand. Repeating it changes nothing. Refused as
 * `attachSubject` refuses it, an archived subject aside.
 */
export const refuseProposals = (
  owner: string,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const done = yield* userData.transaction(owner, (transaction) =>
      refuseIn(transaction, owner, subjectId, entryIds),
    );

    return yield* Effect.fromResult(done);
  });

/** A condition on a line's entries: one is attached to any of `subjectIds` (`../lines`). */
export function attachedToAny(lineId: SQL, subjectIds: ReadonlyArray<string>): SQL {
  return subjectIds.length === 0
    ? sql`false`
    : sql`exists (select 1 from ${entryPart} p join ${entrySubject} s on s.entry_id = p.entry_id where p.line_id = ${lineId} and s.subject_id in (${sql.join(
        subjectIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}))`;
}

/** Every subject of the user's, as their tree reads them (`../lines`, `../month`). */
export const subjectNodesIn = async (transaction: UserTransaction) =>
  (await subjectRows(transaction)).map((row) => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    archived: row.archivedAt !== null,
  }));
