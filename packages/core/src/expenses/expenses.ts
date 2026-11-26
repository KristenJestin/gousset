import {
  account,
  category,
  entry,
  entryPart,
  entrySubject,
  merchantAlias,
  statementLine,
  subject,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { minorDigits } from "@gousset/import";
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Result } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { entriesForLines, settleEntries } from "../entries";
import {
  CategoryNotFound,
  FundRefused,
  LineNotFound,
  LinkRefused,
  NotFunding,
  NotLinked,
  SplitRefused,
} from "../errors";
import { isId } from "../imports/rows";
import type { LineAccount } from "../lines";
import { merchantKey } from "../merchants/labels";
import type { Money } from "../month";
import { today } from "../today";
import { shiftDay } from "../transfers/pairing";
import { FUND_DAYS, fundDecision, fundingCandidates, fundsFromBenefit } from "./funding";
import type { FundingTarget, FundingTransfer } from "./funding";
import type { SubjectName } from "../subjects/counting";
import { REFUND_DAYS, netOf, refundProposals, roleOf, sharesOf } from "./parts";
import type { EntryKind, PartRole, ProposalLine } from "./parts";

// Expenses paid in several parts, and refunds (#27; docs/vision.md, "An expense is not a bank
// line"), as the operations page and the MCP door both read and change them: a line's expense with
// its payments, its refunds and its net cost; a line linked to another line's expense, as a payment
// or a refund, or unlinked; a line split across categories; and the expenses a line coming back may
// cancel, proposed as refunds for the user to confirm. A line's parts add up to its amount: each
// change here writes a line's parts whole, in one transaction (docs/data-model.md, `entry_part`).

/** A part of an expense: the line it comes from, and what it pays or refunds. */
export type ExpensePart = {
  readonly lineId: string;
  readonly bookedOn: string;
  readonly label: string;
  readonly account: LineAccount;
  /** Positive: all of its line, or its share of a split line. */
  readonly amount: Money;
};

/**
 * A transfer out of a benefit account that funds an expense (#29), a works council refund: the
 * restricted money made available. The expense keeps its cost.
 */
export type Funding = {
  /** Its side out, on the benefit account. */
  readonly outLineId: string;
  /** Its side in, on the account the money came to. */
  readonly inLineId: string;
  /** The day its side out was booked. */
  readonly bookedOn: string;
  /** Its side out's label. */
  readonly label: string;
  /** What it moved, positive. */
  readonly amount: Money;
  /** The benefit account it came from. */
  readonly account: LineAccount;
};

/**
 * What happened (an entry): an expense, or an income, with one category, made of payments, on one
 * or more accounts, and of refunds. Counted once, at its net cost, wherever it was paid from.
 */
export type Expense = {
  readonly id: string;
  readonly kind: EntryKind;
  /** The day it happened: its first payment's booking day, unless moved. */
  readonly happenedOn: string;
  readonly category: LineCategory;
  readonly classifiedBy: "default" | "rule" | "user";
  /** Oldest first. */
  readonly payments: ReadonlyArray<ExpensePart>;
  readonly refunds: ReadonlyArray<ExpensePart>;
  /** Its payments less its refunds, positive the kind's way (spent, or received). */
  readonly net: Money;
  /** The transfers funding it, oldest first (#29): what it costs stays `net`. */
  readonly fundings: ReadonlyArray<Funding>;
  /** What they fund together; nothing when none does. */
  readonly funded: Money;
  /** What it is for (#37): its subjects, by name; none for most, and for an income. */
  readonly subjects: ReadonlyArray<SubjectName>;
};

/** An expense a transfer funds, or may fund: its day, category and cost, and its first payment. */
export type FundedExpense = {
  readonly id: string;
  readonly happenedOn: string;
  readonly category: LineCategory;
  /** What it costs, which the funding leaves as it is. */
  readonly net: Money;
  /** Its first payment: the line that names it. */
  readonly line: ExpensePart;
};

/**
 * A side of a transfer out of a benefit account (#29): the expense it funds, or, funding none, the
 * expenses it may fund, the nearest day first, for the user to choose. Never applied unasked.
 */
export type TransferFunding = {
  readonly funds: FundedExpense | null;
  readonly candidates: ReadonlyArray<FundedExpense>;
};

/** An expense a line coming back may cancel: one of its lines, its category and its net cost. */
export type RefundProposal = {
  /** The line that paid it, its whole amount. */
  readonly line: ExpensePart;
  readonly category: LineCategory;
  readonly net: Money;
};

/** What a line is to the expenses. */
export type LineExpenses = {
  /**
   * The expenses the line is part of: none (held, of no amount, a side of a transfer), one, or one
   * per category of a split line.
   */
  readonly expenses: ReadonlyArray<Expense>;
  /** The line's part in its one expense; null with none, or split. */
  readonly role: PartRole | null;
  /**
   * A line coming back, on its own and not classified by the user: the expenses it may cancel,
   * all or part (a purchase cancelled, an order returned), the likeliest first. Never applied
   * unasked: the user confirms one by linking the line to it.
   */
  readonly proposals: ReadonlyArray<RefundProposal>;
  /** A side of a transfer out of a benefit account: what it funds, or may; null for any other. */
  readonly funding: TransferFunding | null;
};

/** A line linked to an expense: its part there, and the expense as it is now. */
export type Linked = { readonly role: PartRole; readonly expense: Expense };

/**
 * One category's share of a split line, typed in major units of the line's currency ("30.00"),
 * with its subjects (#37): given, exactly those; left out, the subjects the line's expense had.
 */
export type Share = {
  readonly categoryId: string;
  readonly amount: string;
  readonly subjectIds?: ReadonlyArray<string>;
};

type Failure = QueryFailed;

/** The expenses of the user's lines, for the user `owner` of each call. */
export class Expenses extends Context.Service<
  Expenses,
  {
    /** What a counted or held line is to the expenses. */
    readonly ofLine: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<LineExpenses, LineNotFound | Failure>;
    /**
     * Makes `lineId` a part of the expense `toLineId` is part of: a payment when its money goes the
     * expense's way, a refund otherwise. Its own entry goes, and its category with it; a payment
     * booked before the expense happened moves the expense's day to it.
     */
    readonly link: (
      owner: string,
      lineId: string,
      toLineId: string,
    ) => Effect.Effect<Linked, LineNotFound | LinkRefused | Failure>;
    /**
     * Takes a line out of an expense made of several lines: it is an expense or an income of its
     * own again, in its kind's fallback. An expense left with refunds alone gives them back theirs.
     */
    readonly unlink: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<LineExpenses, LineNotFound | NotLinked | Failure>;
    /**
     * Splits a line across categories, one expense (or income) per share, as the user's choice;
     * the shares add up to the line. One share puts the whole line back in one category.
     */
    readonly split: (
      owner: string,
      lineId: string,
      shares: ReadonlyArray<Share>,
    ) => Effect.Effect<LineExpenses, LineNotFound | SplitRefused | CategoryNotFound | Failure>;
    /**
     * Makes the transfer `transferLineId` is a side of fund the expense `expenseLineId` is part of
     * (#29): a works council refund, from a benefit account to an account of another kind, of an
     * expense of its currency happened by its day, never past what the expense costs with its other
     * fundings. The expense keeps its cost; it is answered as it is now. Funding it again changes
     * nothing.
     */
    readonly fund: (
      owner: string,
      transferLineId: string,
      expenseLineId: string,
    ) => Effect.Effect<Expense, LineNotFound | FundRefused | Failure>;
    /** The transfer `transferLineId` is a side of funds nothing any more; it stays a transfer. */
    readonly unfund: (
      owner: string,
      transferLineId: string,
    ) => Effect.Effect<LineExpenses, LineNotFound | NotFunding | Failure>;
  }
>()("@gousset/core/Expenses") {}

/** How many expenses of a transfer's days are read for the ones it may fund, the nearest first. */
const FUND_POOL = 100;

/**
 * How many lines before a line coming back are read for its proposals, those of its exact amount
 * first, then the nearest: the merchant is compared once they are read.
 */
const PROPOSAL_POOL = 500;

const parent = alias(category, "parent");

const lineColumns = {
  id: statementLine.id,
  accountId: statementLine.accountId,
  bookedOn: statementLine.bookedOn,
  amountMinor: statementLine.amountMinor,
  label: statementLine.label,
  counterpartyName: statementLine.counterpartyName,
  state: statementLine.state,
  source: statementLine.source,
  accountName: account.name,
  institution: account.institution,
  currency: account.currency,
};

type ReadLine = {
  readonly id: string;
  readonly accountId: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly label: string;
  readonly counterpartyName: string | null;
  readonly state: "counted" | "held" | "discarded";
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly accountName: string;
  readonly institution: string | null;
  readonly currency: string;
};

/** The user's counted or held line booked on or before `day`; undefined for any other. */
async function readLine(
  transaction: UserTransaction,
  lineId: string,
  day: string,
): Promise<ReadLine | undefined> {
  if (!isId(lineId)) {
    return undefined;
  }

  const [line] = await transaction
    .select(lineColumns)
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(statementLine.id, lineId),
        inArray(statementLine.state, ["counted", "held"]),
        lte(statementLine.bookedOn, day),
      ),
    );

  return line;
}

/**
 * Locks the user's lines among `lineIds`, in one order, so that two changes of the same lines take
 * turns and each decides on what the other left. Every change here locks its lines first, then its
 * entries. `no key update` rather than `update`: a line's id never changes, and a part written for a
 * line (a refund an unlink frees) takes the foreign key's `key share` on it. With `update`, an
 * unlink holding the expense would wait for a link holding that line, which waits for the expense,
 * and Postgres would end one of them as a deadlock.
 */
async function lockLines(
  transaction: UserTransaction,
  lineIds: ReadonlyArray<string>,
): Promise<void> {
  const ids = lineIds.filter(isId);

  if (ids.length > 0) {
    await transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(inArray(statementLine.id, ids))
      .orderBy(asc(statementLine.id))
      .for("no key update");
  }
}

/** Locks the user's entries among `entryIds`, in one order, as `lockLines` does their lines. */
async function lockEntries(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
): Promise<void> {
  if (entryIds.length > 0) {
    await transaction
      .select({ id: entry.id })
      .from(entry)
      .where(inArray(entry.id, [...entryIds]))
      .orderBy(asc(entry.id))
      .for("update");
  }
}

/** Whether the line is a side of a transfer, never an expense nor an income. */
async function isTransferSide(transaction: UserTransaction, lineId: string): Promise<boolean> {
  const found = await transaction
    .select({ id: transfer.id })
    .from(transfer)
    .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

  return found.length > 0;
}

/** The entries the line has a part in, in the order they were made. */
async function entryIdsOf(
  transaction: UserTransaction,
  lineId: string,
): Promise<ReadonlyArray<string>> {
  const rows = await transaction
    .selectDistinct({ entryId: entryPart.entryId })
    .from(entryPart)
    .where(eq(entryPart.lineId, lineId))
    .orderBy(asc(entryPart.entryId));

  return rows.map((row) => row.entryId);
}

/** The transfers funding each of the entries `entryIds`, oldest first (#29). */
async function fundingsOf(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<Funding>>> {
  const rows = await transaction
    .select({
      entryId: transfer.fundsEntryId,
      outLineId: transfer.outLineId,
      inLineId: transfer.inLineId,
      bookedOn: statementLine.bookedOn,
      label: statementLine.label,
      amountMinor: statementLine.amountMinor,
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      currency: account.currency,
    })
    .from(transfer)
    .innerJoin(statementLine, eq(statementLine.id, transfer.outLineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(inArray(transfer.fundsEntryId, [...entryIds]))
    .orderBy(asc(statementLine.bookedOn), asc(transfer.outLineId));

  const byEntry = new Map<string, Array<Funding>>();

  for (const row of rows) {
    if (row.entryId !== null) {
      byEntry.set(row.entryId, [
        ...(byEntry.get(row.entryId) ?? []),
        {
          outLineId: row.outLineId,
          inLineId: row.inLineId,
          bookedOn: row.bookedOn,
          label: row.label,
          amount: { minor: Math.abs(row.amountMinor), currency: row.currency },
          account: { id: row.accountId, name: row.accountName, institution: row.institution },
        },
      ]);
    }
  }

  return byEntry;
}

/** Each of the entries' subjects, by name (#37). */
export async function subjectsOfEntries(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<SubjectName>>> {
  if (entryIds.length === 0) {
    return new Map();
  }

  const rows = await transaction
    .select({ entryId: entrySubject.entryId, id: subject.id, name: subject.name })
    .from(entrySubject)
    .innerJoin(subject, eq(subject.id, entrySubject.subjectId))
    .where(inArray(entrySubject.entryId, [...entryIds]))
    .orderBy(asc(subject.name), asc(subject.id));

  const byEntry = new Map<string, Array<SubjectName>>();

  for (const row of rows) {
    byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), { id: row.id, name: row.name }]);
  }

  return byEntry;
}

/** The entries `entryIds` name, each with its category and every part, in that order. */
async function readExpenses(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<Expense>> {
  if (entryIds.length === 0) {
    return [];
  }

  const rows = await transaction
    .select({
      entryId: entry.id,
      kind: entry.kind,
      happenedOn: entry.happenedOn,
      classifiedBy: entry.classifiedBy,
      categoryId: category.id,
      categoryName: category.name,
      parentName: parent.name,
      categoryKind: category.kind,
      role: entryPart.role,
      partMinor: entryPart.amountMinor,
      lineId: statementLine.id,
      bookedOn: statementLine.bookedOn,
      label: statementLine.label,
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      currency: account.currency,
    })
    .from(entry)
    .innerJoin(category, eq(category.id, entry.categoryId))
    .leftJoin(parent, eq(parent.id, category.parentId))
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(inArray(entry.id, [...entryIds]))
    .orderBy(asc(statementLine.bookedOn), asc(statementLine.id), asc(entryPart.role));

  const fundings = await fundingsOf(transaction, entryIds);
  const subjects = await subjectsOfEntries(transaction, entryIds);

  return entryIds.flatMap((entryId) => {
    const own = rows.filter((row) => row.entryId === entryId);
    const [head] = own;

    if (head === undefined) {
      return [];
    }

    const partOf = (row: (typeof own)[number]): ExpensePart => ({
      lineId: row.lineId,
      bookedOn: row.bookedOn,
      label: row.label,
      account: { id: row.accountId, name: row.accountName, institution: row.institution },
      amount: { minor: row.partMinor, currency: row.currency },
    });

    const funding = fundings.get(entryId) ?? [];

    const expense: Expense = {
      id: entryId,
      kind: head.kind,
      happenedOn: head.happenedOn,
      category: {
        id: head.categoryId,
        name: head.categoryName,
        parentName: head.parentName,
        kind: head.categoryKind,
      },
      classifiedBy: head.classifiedBy,
      payments: own.flatMap((row) => (row.role === "payment" ? [partOf(row)] : [])),
      refunds: own.flatMap((row) => (row.role === "refund" ? [partOf(row)] : [])),
      net: {
        minor: netOf(own.map((row) => ({ role: row.role, amountMinor: row.partMinor }))),
        currency: head.currency,
      },
      fundings: funding,
      funded: {
        minor: funding.reduce((sum, each) => sum + each.amount.minor, 0),
        currency: head.currency,
      },
      subjects: subjects.get(entryId) ?? [],
    };

    return [expense];
  });
}

const lineIdsOf = (expense: Expense) =>
  new Set([...expense.payments, ...expense.refunds].map((part) => part.lineId));

/** The merchant each cleaned label names, by its alias. */
async function merchantsOf(
  transaction: UserTransaction,
  keys: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> {
  const distinct = [...new Set(keys)];

  if (distinct.length === 0) {
    return new Map();
  }

  const rows = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias)
    .where(inArray(merchantAlias.alias, distinct));

  return new Map(rows.map((row) => [row.alias, row.merchantId]));
}

/** The expenses a line coming back may cancel (`refundProposals`), read with their category. */
async function proposalsFor(
  transaction: UserTransaction,
  line: ReadLine,
  day: string,
): Promise<ReadonlyArray<RefundProposal>> {
  const back = Math.abs(line.amountMinor);

  const pool = await transaction
    .select(lineColumns)
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(statementLine.state, "counted"),
        ne(statementLine.source, "balance"),
        ne(statementLine.id, line.id),
        eq(account.currency, line.currency),
        lt(statementLine.amountMinor, 0),
        sql`abs(${statementLine.amountMinor}) >= ${back}`,
        gte(statementLine.bookedOn, shiftDay(line.bookedOn, -REFUND_DAYS)),
        lte(statementLine.bookedOn, line.bookedOn),
        lte(statementLine.bookedOn, day),
        // A payment of an expense: no side of a transfer, no refund of another one.
        sql`exists (select 1 from entry_part p where p.line_id = ${statementLine.id} and p.role = 'payment')`,
      ),
    )
    // The exact amount first, as `refundProposals` orders them, so that a cancellation is read
    // whatever the user paid since; then the nearest day.
    .orderBy(
      sql`abs(${statementLine.amountMinor}) = ${back} desc`,
      desc(statementLine.bookedOn),
      desc(statementLine.id),
    )
    .limit(PROPOSAL_POOL);

  if (pool.length === 0) {
    return [];
  }

  // Each line's entries; a split line, or a side of a transfer (which has none), is no purchase.
  const parts = await transaction
    .selectDistinct({ lineId: entryPart.lineId, entryId: entryPart.entryId })
    .from(entryPart)
    .where(
      inArray(
        entryPart.lineId,
        pool.map((each) => each.id),
      ),
    );

  const entriesOf = new Map<string, Array<string>>();

  for (const part of parts) {
    entriesOf.set(part.lineId, [...(entriesOf.get(part.lineId) ?? []), part.entryId]);
  }

  const entryOf = new Map(
    [...entriesOf].flatMap(([lineId, ids]) => {
      const [only, ...others] = ids;

      return only === undefined || others.length > 0 ? [] : [[lineId, only] as const];
    }),
  );

  const expenses = await readExpenses(transaction, [...new Set(entryOf.values())]);
  const expenseOf = new Map(expenses.map((expense) => [expense.id, expense]));

  const keyOf = (each: ReadLine) => merchantKey(each.label, each.counterpartyName);

  const merchants = await merchantsOf(
    transaction,
    [line, ...pool].flatMap((each) => keyOf(each) ?? []),
  );

  const proposalLine = (each: ReadLine, netMinor: number): ProposalLine => {
    const key = keyOf(each);

    return {
      id: each.id,
      currency: each.currency,
      bookedOn: each.bookedOn,
      amountMinor: each.amountMinor,
      merchantId: key === null ? null : (merchants.get(key) ?? null),
      key,
      netMinor,
    };
  };

  const candidates = pool.flatMap((each) => {
    const expense = expenseOf.get(entryOf.get(each.id) ?? "");

    // The line pays an expense: a purchase, not a refund of one, nor an income.
    return expense === undefined ||
      expense.kind !== "expense" ||
      roleOf(expense.kind, each.amountMinor) !== "payment"
      ? []
      : [proposalLine(each, expense.net.minor)];
  });

  const lineOf = new Map(pool.map((each) => [each.id, each]));

  return refundProposals(proposalLine(line, 0), candidates).flatMap((proposed) => {
    const paid = lineOf.get(proposed.id);
    const expense = expenseOf.get(entryOf.get(proposed.id) ?? "");

    return paid === undefined || expense === undefined
      ? []
      : [
          {
            line: {
              lineId: paid.id,
              bookedOn: paid.bookedOn,
              label: paid.label,
              account: {
                id: paid.accountId,
                name: paid.accountName,
                institution: paid.institution,
              },
              amount: { minor: Math.abs(paid.amountMinor), currency: paid.currency },
            },
            category: expense.category,
            net: expense.net,
          },
        ];
  });
}

const outLine = alias(statementLine, "out_line");
const outAccount = alias(account, "out_account");
const inLine = alias(statementLine, "in_line");
const inAccount = alias(account, "in_account");

/** The transfer `lineId` is a side of, with what funding reads of its two sides; if any. */
async function transferOfSide(transaction: UserTransaction, lineId: string) {
  const [found] = await transaction
    .select({
      id: transfer.id,
      outLineId: transfer.outLineId,
      inLineId: transfer.inLineId,
      fundsEntryId: transfer.fundsEntryId,
      bookedOn: outLine.bookedOn,
      outAmountMinor: outLine.amountMinor,
      outKind: outAccount.kind,
      currency: outAccount.currency,
      inKind: inAccount.kind,
    })
    .from(transfer)
    .innerJoin(outLine, eq(outLine.id, transfer.outLineId))
    .innerJoin(outAccount, eq(outAccount.id, outLine.accountId))
    .innerJoin(inLine, eq(inLine.id, transfer.inLineId))
    .innerJoin(inAccount, eq(inAccount.id, inLine.accountId))
    .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

  return found;
}

type SideRead = NonNullable<Awaited<ReturnType<typeof transferOfSide>>>;

const fundingTransferOf = (found: SideRead): FundingTransfer => ({
  outKind: found.outKind,
  inKind: found.inKind,
  bookedOn: found.bookedOn,
  amountMinor: Math.abs(found.outAmountMinor),
  currency: found.currency,
  fundsEntryId: found.fundsEntryId,
});

/** An expense as funding weighs it: its cost, and what transfers but `outLineId`'s fund of it. */
const targetOf = (expense: Expense, outLineId: string | null): FundingTarget => ({
  id: expense.id,
  kind: expense.kind,
  happenedOn: expense.happenedOn,
  currency: expense.net.currency,
  netMinor: expense.net.minor,
  fundedByOthersMinor: expense.fundings.reduce(
    (sum, each) => (each.outLineId === outLineId ? sum : sum + each.amount.minor),
    0,
  ),
});

/** An expense, as a transfer funds it: none without a payment, which never happens. */
function fundedOf(expense: Expense): ReadonlyArray<FundedExpense> {
  const [first] = expense.payments;

  return first === undefined
    ? []
    : [
        {
          id: expense.id,
          happenedOn: expense.happenedOn,
          category: expense.category,
          net: expense.net,
          line: first,
        },
      ];
}

/**
 * The expenses a transfer funding none may fund (`fundingCandidates`): the expenses of its days,
 * the nearest first, of its currency, of a line split in none, costing at least its amount, read
 * with their fundings.
 */
async function candidatesToFund(
  transaction: UserTransaction,
  read: FundingTransfer,
): Promise<ReadonlyArray<FundedExpense>> {
  const pool = await transaction
    .select({ id: entry.id })
    .from(entry)
    .where(
      and(
        eq(entry.kind, "expense"),
        gte(entry.happenedOn, shiftDay(read.bookedOn, -FUND_DAYS)),
        lte(entry.happenedOn, read.bookedOn),
        sql`(select coalesce(sum(case when p.role = 'payment' then p.amount_minor else -p.amount_minor end), 0) from entry_part p where p.entry_id = ${entry.id}) >= ${read.amountMinor}`,
        sql`exists (select 1 from entry_part p join statement_line l on l.id = p.line_id join account a on a.id = l.account_id where p.entry_id = ${entry.id} and a.currency = ${read.currency})`,
        sql`not exists (select 1 from entry_part p join entry_part q on q.line_id = p.line_id and q.entry_id <> p.entry_id where p.entry_id = ${entry.id})`,
      ),
    )
    .orderBy(desc(entry.happenedOn), desc(entry.id))
    .limit(FUND_POOL);

  const expenses = await readExpenses(
    transaction,
    pool.map((each) => each.id),
  );

  return fundingCandidates(
    read,
    expenses.map((expense) => ({ ...targetOf(expense, null), expense })),
  ).flatMap((each) => fundedOf(each.expense));
}

/** What a side of a transfer out of a benefit account funds, or may; null for any other line. */
async function transferFunding(
  transaction: UserTransaction,
  lineId: string,
): Promise<TransferFunding | null> {
  const found = await transferOfSide(transaction, lineId);

  if (found === undefined) {
    return null;
  }

  // A funding made stays shown, and can be undone, whatever its accounts' kinds became since: an
  // account's kind may be edited once it has lines.
  if (found.fundsEntryId !== null) {
    const [funded] = (await readExpenses(transaction, [found.fundsEntryId])).flatMap(fundedOf);

    return { funds: funded ?? null, candidates: [] };
  }

  const read = fundingTransferOf(found);

  if (!fundsFromBenefit(read)) {
    return null;
  }

  return { funds: null, candidates: await candidatesToFund(transaction, read) };
}

/** What `line` is to the expenses, read in `transaction`. */
async function lineExpenses(
  transaction: UserTransaction,
  line: ReadLine,
  day: string,
): Promise<LineExpenses> {
  const expenses = await readExpenses(transaction, await entryIdsOf(transaction, line.id));
  const [only, ...others] = expenses;

  if (only === undefined || others.length > 0) {
    // A line of no expense may be a works council refund's side (#29).
    const funding = only === undefined ? await transferFunding(transaction, line.id) : null;

    return { expenses, role: null, proposals: [], funding };
  }

  const role = only.refunds.some((part) => part.lineId === line.id) ? "refund" : "payment";

  // A line on its own, coming back, that the user did not classify: it may cancel an expense. A
  // line going out is no refund of anything.
  const alone = lineIdsOf(only).size === 1;

  const proposals =
    alone &&
    line.amountMinor > 0 &&
    only.classifiedBy !== "user" &&
    line.state === "counted" &&
    line.source !== "balance"
      ? await proposalsFor(transaction, line, day)
      : [];

  return { expenses, role, proposals, funding: null };
}

/** Why the line cannot be part of an expense with another line, or undefined when it can. */
function lineRefusal(
  line: ReadLine,
  paired: boolean,
): "not_counted" | "zero_amount" | "made_from_balance" | "transfer" | undefined {
  if (line.state !== "counted") {
    return "not_counted";
  }

  if (line.amountMinor === 0) {
    return "zero_amount";
  }

  if (line.source === "balance") {
    return "made_from_balance";
  }

  return paired ? "transfer" : undefined;
}

const linkRefused = (reason: LinkRefused["reason"], lineId: string) =>
  Result.fail(new LinkRefused({ reason, lineId }));

/**
 * Links `lineId` into the expense of `toLineId` in `transaction`: the user's link (`by: "user"`),
 * which lifts a refusal of either line's (`link_refused`), or the matching of a top-up's (#28,
 * `./top-ups`), which runs on lines no one refused.
 */
export async function linkIn(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  toLineId: string,
  day: string,
  by: "user" | "match",
): Promise<Result.Result<Linked, LineNotFound | LinkRefused>> {
  await lockLines(transaction, [lineId, toLineId]);

  const line = await readLine(transaction, lineId, day);

  if (line === undefined) {
    return Result.fail(new LineNotFound({ lineId }));
  }

  const target = await readLine(transaction, toLineId, day);

  if (target === undefined) {
    return Result.fail(new LineNotFound({ lineId: toLineId }));
  }

  if (line.id === target.id) {
    return linkRefused("same_line", line.id);
  }

  for (const each of [line, target]) {
    const refused = lineRefusal(each, await isTransferSide(transaction, each.id));

    if (refused !== undefined) {
      return linkRefused(refused, each.id);
    }
  }

  // The expenses themselves take turns too: two links into one expense through two of its lines,
  // or a link and an unlink, each read the net the other left.
  await lockEntries(transaction, [
    ...(await entryIdsOf(transaction, target.id)),
    ...(await entryIdsOf(transaction, line.id)),
  ]);

  const [expense, ...otherShares] = await readExpenses(
    transaction,
    await entryIdsOf(transaction, target.id),
  );

  // A counted line of some amount that is no side of a transfer always has an entry.
  if (expense === undefined) {
    throw new Error("A counted line has no entry.");
  }

  if (otherShares.length > 0) {
    return linkRefused("split", target.id);
  }

  const own = await readExpenses(transaction, await entryIdsOf(transaction, line.id));

  if (lineIdsOf(expense).has(line.id)) {
    return linkRefused("already_linked", line.id);
  }

  if (own.length > 1) {
    return linkRefused("split", line.id);
  }

  if (own.some((each) => lineIdsOf(each).size > 1)) {
    return linkRefused("linked", line.id);
  }

  if (line.currency !== expense.net.currency) {
    return linkRefused("currency", line.id);
  }

  const role = roleOf(expense.kind, line.amountMinor);
  const amountMinor = Math.abs(line.amountMinor);

  if (role === "refund" && amountMinor > expense.net.minor) {
    return linkRefused("exceeds", line.id);
  }

  // The line's own entry goes, its part with it: the line is now the expense's. The transfers that
  // funded it fund that expense now (#29); an income is funded by none, and they fund nothing.
  if (own.length > 0) {
    const ownIds = own.map((each) => each.id);

    if (expense.kind === "expense") {
      await transaction
        .update(transfer)
        .set({ fundsEntryId: expense.id })
        .where(inArray(transfer.fundsEntryId, ownIds));
    }

    await transaction.delete(entry).where(inArray(entry.id, ownIds));
  }

  await transaction.insert(entryPart).values({
    userId: owner,
    entryId: expense.id,
    lineId: line.id,
    role,
    amountMinor,
  });

  if (role === "payment" && line.bookedOn < expense.happenedOn) {
    await transaction
      .update(entry)
      .set({ happenedOn: line.bookedOn })
      .where(eq(entry.id, expense.id));
  }

  if (by === "user") {
    await transaction
      .update(statementLine)
      .set({ linkRefused: false })
      .where(inArray(statementLine.id, [line.id, target.id]));
  }

  const [linked] = await readExpenses(transaction, [expense.id]);

  return linked === undefined
    ? Result.fail(new LineNotFound({ lineId: toLineId }))
    : Result.succeed({ role, expense: linked });
}

async function unlinkIn(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  day: string,
): Promise<Result.Result<LineExpenses, LineNotFound | NotLinked>> {
  await lockLines(transaction, [lineId]);

  const line = await readLine(transaction, lineId, day);

  if (line === undefined) {
    return Result.fail(new LineNotFound({ lineId }));
  }

  await lockEntries(transaction, await entryIdsOf(transaction, line.id));

  const [expense, ...others] = await readExpenses(
    transaction,
    await entryIdsOf(transaction, line.id),
  );

  if (expense === undefined || others.length > 0 || lineIdsOf(expense).size === 1) {
    return Result.fail(new NotLinked({ lineId }));
  }

  await transaction
    .delete(entryPart)
    .where(and(eq(entryPart.entryId, expense.id), eq(entryPart.lineId, line.id)));

  // The user's "not one expense" holds: the matching of top-ups never links the line again (#28).
  await transaction
    .update(statementLine)
    .set({ linkRefused: true })
    .where(eq(statementLine.id, line.id));

  // The expense loses this line: with refunds past its payments, it loses them; with no payment
  // left, it goes; either way, those refunds are each their own again. When its day came from
  // this payment, it happens on the next one's.
  const leaving = expense.payments.some((part) => part.lineId === line.id);

  await settleEntries(
    transaction,
    owner,
    leaving ? [{ entryId: expense.id, bookedOn: line.bookedOn }] : [],
  );
  await entriesForLines(transaction, owner, [line.id]);

  return Result.succeed(await lineExpenses(transaction, line, day));
}

const splitRefused = (reason: SplitRefused["reason"], index?: number) =>
  Result.fail(new SplitRefused(index === undefined ? { reason } : { reason, index }));

async function splitIn(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  shares: ReadonlyArray<Share>,
  day: string,
): Promise<Result.Result<LineExpenses, LineNotFound | SplitRefused | CategoryNotFound>> {
  // Its turn among the changes of the categories, before any row lock: the categories chosen are
  // neither archived nor merged away before it commits.
  await takeCategoryTurn(transaction, owner);
  await lockLines(transaction, [lineId]);

  const line = await readLine(transaction, lineId, day);

  if (line === undefined) {
    return Result.fail(new LineNotFound({ lineId }));
  }

  const refused = lineRefusal(line, await isTransferSide(transaction, line.id));

  if (refused === "not_counted" || refused === "zero_amount" || refused === "transfer") {
    return splitRefused(refused);
  }

  const expenses = await readExpenses(transaction, await entryIdsOf(transaction, line.id));

  if (expenses.some((each) => lineIdsOf(each).size > 1)) {
    return splitRefused("linked");
  }

  // A transfer funds this expense (#29): which share it would fund, the user says by unfunding first.
  if (expenses.some((each) => each.fundings.length > 0)) {
    return splitRefused("funded");
  }

  const amounts = sharesOf(
    line.amountMinor,
    minorDigits(line.currency),
    shares.map((share) => share.amount),
  );

  if (Result.isFailure(amounts)) {
    const why = amounts.failure;

    return splitRefused(why.reason, why.reason === "amount" ? why.index : undefined);
  }

  const ids = shares.map((share) => share.categoryId);

  const chosen = await transaction
    .select({ id: category.id, kind: category.kind, archivedAt: category.archivedAt })
    .from(category)
    .where(inArray(category.id, ids.filter(isId)));

  const kind: EntryKind = line.amountMinor < 0 ? "expense" : "income";

  for (const [index, categoryId] of ids.entries()) {
    const found = chosen.find((each) => each.id === categoryId);

    if (found === undefined) {
      return Result.fail(new CategoryNotFound({ categoryId }));
    }

    if (found.kind !== kind) {
      return splitRefused("kind", index);
    }

    if (found.archivedAt !== null) {
      return splitRefused("archived", index);
    }
  }

  const subjects = await shareSubjects(transaction, shares, kind, expenses);

  if (Result.isFailure(subjects)) {
    return Result.fail(subjects.failure);
  }

  const happenedOn = expenses.reduce(
    (first, each) => (each.happenedOn < first ? each.happenedOn : first),
    line.bookedOn,
  );

  if (expenses.length > 0) {
    await transaction.delete(entry).where(
      inArray(
        entry.id,
        expenses.map((each) => each.id),
      ),
    );
  }

  for (const [index, minor] of amounts.success.entries()) {
    const [made] = await transaction
      .insert(entry)
      .values({
        userId: owner,
        kind,
        happenedOn,
        categoryId: ids[index] ?? "",
        classifiedBy: "user",
      })
      .returning({ id: entry.id });

    if (made === undefined) {
      throw new Error("The insert returned no row.");
    }

    await transaction.insert(entryPart).values({
      userId: owner,
      entryId: made.id,
      lineId: line.id,
      role: "payment",
      amountMinor: minor,
    });

    const own = subjects.success[index] ?? [];

    if (own.length > 0) {
      await transaction
        .insert(entrySubject)
        .values(own.map((subjectId) => ({ userId: owner, entryId: made.id, subjectId })));
    }
  }

  return Result.succeed(await lineExpenses(transaction, line, day));
}

/**
 * Each share's subjects (#37): those it names, each one of the user's and not archived, or, named
 * none, the subjects the line's expenses had before the split. A share of money coming in has none.
 */
async function shareSubjects(
  transaction: UserTransaction,
  shares: ReadonlyArray<Share>,
  kind: EntryKind,
  expenses: ReadonlyArray<Expense>,
): Promise<Result.Result<ReadonlyArray<ReadonlyArray<string>>, SplitRefused>> {
  const named = [...new Set(shares.flatMap((share) => share.subjectIds ?? []))];

  const known =
    named.length === 0
      ? []
      : await transaction
          .select({ id: subject.id, archivedAt: subject.archivedAt })
          .from(subject)
          .where(inArray(subject.id, named.filter(isId)));

  for (const [index, share] of shares.entries()) {
    const ids = share.subjectIds ?? [];

    if (ids.length > 0 && kind !== "expense") {
      return splitRefused("subject_income", index);
    }

    for (const subjectId of ids) {
      const found = known.find((each) => each.id === subjectId);

      if (found === undefined) {
        return splitRefused("subject_unknown", index);
      }

      if (found.archivedAt !== null) {
        return splitRefused("subject_archived", index);
      }
    }
  }

  const before =
    expenses.length === 0
      ? []
      : await transaction
          .selectDistinct({ subjectId: entrySubject.subjectId })
          .from(entrySubject)
          .where(
            inArray(
              entrySubject.entryId,
              expenses.map((each) => each.id),
            ),
          )
          .orderBy(asc(entrySubject.subjectId));

  const kept = kind === "expense" ? before.map((each) => each.subjectId) : [];

  return Result.succeed(
    shares.map((share) => (share.subjectIds === undefined ? kept : [...new Set(share.subjectIds)])),
  );
}

/** The lines the entries `entryIds` have a part of. */
async function linesOfEntries(
  transaction: UserTransaction,
  entryIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (entryIds.length === 0) {
    return [];
  }

  const rows = await transaction
    .selectDistinct({ lineId: entryPart.lineId })
    .from(entryPart)
    .where(inArray(entryPart.entryId, [...entryIds]));

  return rows.map((row) => row.lineId);
}

const fundRefused = (reason: FundRefused["reason"], lineId: string) =>
  Result.fail(new FundRefused({ reason, lineId }));

async function fundIn(
  transaction: UserTransaction,
  owner: string,
  transferLineId: string,
  expenseLineId: string,
  day: string,
): Promise<Result.Result<Expense, LineNotFound | FundRefused>> {
  // Its turn among the changes that unpair, split or fund lines, before any row lock: the transfer
  // stays paired, and the expense's line unsplit, until it commits.
  await takeCategoryTurn(transaction, owner);

  const side = await readLine(transaction, transferLineId, day);

  if (side === undefined) {
    return Result.fail(new LineNotFound({ lineId: transferLineId }));
  }

  const target = await readLine(transaction, expenseLineId, day);

  if (target === undefined) {
    return Result.fail(new LineNotFound({ lineId: expenseLineId }));
  }

  const paired = await transferOfSide(transaction, side.id);

  if (paired === undefined) {
    return fundRefused("not_a_transfer", side.id);
  }

  // The transfer's lines and the expense's, in one order, then the expense, as a link locks them:
  // a link or an unlink of that expense waits, and reads the fundings this one leaves.
  await lockLines(transaction, [
    paired.outLineId,
    paired.inLineId,
    target.id,
    ...(await linesOfEntries(transaction, await entryIdsOf(transaction, target.id))),
  ]);

  const entryIds = await entryIdsOf(transaction, target.id);

  await lockEntries(transaction, entryIds);

  const found = (await transferOfSide(transaction, side.id)) ?? paired;
  const [only, ...others] = await readExpenses(transaction, entryIds);

  const decided = fundDecision(
    fundingTransferOf(found),
    only === undefined ? "none" : others.length > 0 ? "split" : targetOf(only, found.outLineId),
  );

  if (decided !== "fund" && decided !== "same") {
    return fundRefused(decided.reason, decided.about === "transfer" ? side.id : target.id);
  }

  // Decided on an expense: there is one.
  if (only === undefined) {
    throw new Error("A funding was decided with no expense.");
  }

  if (decided === "fund") {
    await transaction
      .update(transfer)
      .set({ fundsEntryId: only.id })
      .where(eq(transfer.id, found.id));
  }

  const [funded] = await readExpenses(transaction, [only.id]);

  return funded === undefined
    ? Result.fail(new LineNotFound({ lineId: expenseLineId }))
    : Result.succeed(funded);
}

async function unfundIn(
  transaction: UserTransaction,
  owner: string,
  transferLineId: string,
  day: string,
): Promise<Result.Result<LineExpenses, LineNotFound | NotFunding>> {
  // Its turn, as `fundIn` takes it: the two never meet on one transfer.
  await takeCategoryTurn(transaction, owner);

  const side = await readLine(transaction, transferLineId, day);

  if (side === undefined) {
    return Result.fail(new LineNotFound({ lineId: transferLineId }));
  }

  const found = await transferOfSide(transaction, side.id);

  if (found === undefined || found.fundsEntryId === null) {
    return Result.fail(new NotFunding({ lineId: side.id }));
  }

  await lockLines(transaction, [found.outLineId, found.inLineId]);

  // The transfer stays; the expense it funded keeps its cost, as it always did.
  await transaction.update(transfer).set({ fundsEntryId: null }).where(eq(transfer.id, found.id));

  return Result.succeed(await lineExpenses(transaction, side, day));
}

/** What a line is to the expenses (`Expenses.ofLine`). */
export const lineExpensesOf = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.ofLine(owner, lineId);
  });

/** Makes a line a payment or a refund of another line's expense (`Expenses.link`). */
export const linkLine = (owner: string, lineId: string, toLineId: string) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.link(owner, lineId, toLineId);
  });

/** Takes a line out of its expense of several lines (`Expenses.unlink`). */
export const unlinkLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.unlink(owner, lineId);
  });

/** Splits a line across categories (`Expenses.split`). */
export const splitLine = (owner: string, lineId: string, shares: ReadonlyArray<Share>) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.split(owner, lineId, shares);
  });

/** Makes a transfer out of a benefit account fund an expense (`Expenses.fund`). */
export const fundExpense = (owner: string, transferLineId: string, expenseLineId: string) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.fund(owner, transferLineId, expenseLineId);
  });

/** The transfer a line is a side of funds nothing any more (`Expenses.unfund`). */
export const unfundExpense = (owner: string, transferLineId: string) =>
  Effect.gen(function* () {
    const expenses = yield* Expenses;

    return yield* expenses.unfund(owner, transferLineId);
  });

/** `Expenses` on the database (`UserData`). */
export const expensesLayer = Layer.effect(
  Expenses,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      ofLine: (owner, lineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const found = yield* userData.transaction(owner, async (transaction) => {
            const line = await readLine(transaction, lineId, day);

            return line === undefined ? undefined : lineExpenses(transaction, line, day);
          });

          return found === undefined ? yield* new LineNotFound({ lineId }) : found;
        }),

      link: (owner, lineId, toLineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          return yield* userData
            .transaction(owner, (transaction) =>
              linkIn(transaction, owner, lineId, toLineId, day, "user"),
            )
            .pipe(Effect.flatMap(Effect.fromResult));
        }),

      unlink: (owner, lineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          return yield* userData
            .transaction(owner, (transaction) => unlinkIn(transaction, owner, lineId, day))
            .pipe(Effect.flatMap(Effect.fromResult));
        }),

      split: (owner, lineId, shares) =>
        Effect.gen(function* () {
          const day = yield* today;

          return yield* userData
            .transaction(owner, (transaction) => splitIn(transaction, owner, lineId, shares, day))
            .pipe(Effect.flatMap(Effect.fromResult));
        }),

      fund: (owner, transferLineId, expenseLineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          return yield* userData
            .transaction(owner, (transaction) =>
              fundIn(transaction, owner, transferLineId, expenseLineId, day),
            )
            .pipe(Effect.flatMap(Effect.fromResult));
        }),

      unfund: (owner, transferLineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          return yield* userData
            .transaction(owner, (transaction) => unfundIn(transaction, owner, transferLineId, day))
            .pipe(Effect.flatMap(Effect.fromResult));
        }),
    };
  }),
);
