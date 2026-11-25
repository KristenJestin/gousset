import { UserData } from "@gousset/db/user-data";
import type { QueryFailed } from "@gousset/db/user-data";
import { Context, Effect, Layer } from "effect";

import type { AccountKind, AccountMode, CreditOrder } from "./account-values";
import { statementsUntil } from "./accounts";
import { averageWindow, benchmarksOf, lastDayOf, monthsCounted } from "./benchmarks";
import type { CategoryInMonth } from "./benchmarks";
import type { CategoryRecord, EntryKind, LineCategory, MonthlySpending } from "./category-store";
import type { CountedLine } from "./credits";
import type { LineAccount } from "./lines";
import { merchantKey } from "./merchants/labels";
import { monthRowsIn } from "./month-rows";
import { reviewQueue } from "./review-queue";
import {
  detectSubscriptions,
  subscriptionId,
  subscriptionsOfMonth,
} from "./subscriptions/detection";
import type { Charge } from "./subscriptions/detection";
import {
  chargeRange,
  checkedToday,
  expiringCreditsOf,
  followsCredits,
} from "./subscriptions/subscriptions";
import { addMonths } from "./values";

// The month read (#32; docs/data-model.md, "v0.4: Monthly review", "The month read"): what came in,
// what was spent, set aside and left, where the money went, what moved, what waits for the user and
// what is flagged, for the review and the MCP door alike. One transaction of the user's reads the
// raw rows (`MonthFacts`); everything else is computed here, on read: nothing is stored.

/** An amount in minor units (cents) of its currency: never a float. */
export type Money = { minor: number; currency: string };

type Range = { readonly from: string; readonly to: string };

/** An account as the month reads it. */
export type MonthAccount = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly kind: AccountKind;
  readonly currency: string;
  readonly mode: AccountMode;
  readonly openingBalanceMinor: number;
  readonly openedOn: string | null;
  readonly closedOn: string | null;
  readonly creditOrder: CreditOrder;
};

/** One part of an entry (a payment or a refund), with its entry and its line. */
export type MonthPart = {
  readonly entryId: string;
  readonly kind: EntryKind;
  readonly happenedOn: string;
  readonly categoryId: string;
  /** The entry's own merchant (a rule's, or the user's behind an intermediary); null for none. */
  readonly entryMerchantId: string | null;
  readonly role: "payment" | "refund";
  /** Positive, the way its role says. */
  readonly amountMinor: number;
  readonly lineId: string;
  readonly label: string;
  readonly counterpartyName: string | null;
  readonly accountId: string;
};

/** A transfer, both sides: the side out is negative, the side in positive. */
export type MonthTransfer = {
  readonly outAccountId: string;
  readonly outBookedOn: string;
  readonly outMinor: number;
  readonly inAccountId: string;
  readonly inBookedOn: string;
  readonly inMinor: number;
};

export type MonthMerchant = {
  readonly id: string;
  readonly name: string;
  readonly intermediary: boolean;
};

/** A counted line of a benefit account. */
export type BenefitLine = CountedLine & { readonly accountId: string };

/** How far an account's statements go: its done imports' last day, its latest statement balance. */
export type StatementReach = {
  readonly accountId: string;
  readonly importedTo: string | null;
  readonly statementTo: string | null;
};

/** What one read of the month asks for, every range decided by the logic. */
export type MonthScope = {
  /** The entries that happened in it: the six months an average reads, and the month. */
  readonly entries: Range;
  /** The transfers with a side booked in it: the month. */
  readonly transfers: Range;
  /** The counted lines of benefit accounts booked up to this day, oldest first. */
  readonly benefitTo: string;
  /** The statement balances given for this day or before: today. */
  readonly statementsTo: string;
  /** The charges subscriptions are detected from (#34), or none. */
  readonly charges: Range | null;
};

/** The raw rows of a month, read in one transaction of the user's. */
export type MonthRows = {
  readonly accounts: ReadonlyArray<MonthAccount>;
  readonly categories: ReadonlyArray<CategoryRecord>;
  readonly parts: ReadonlyArray<MonthPart>;
  readonly transfers: ReadonlyArray<MonthTransfer>;
  readonly merchants: ReadonlyArray<MonthMerchant>;
  /** Each cleaned label that names a merchant. */
  readonly aliases: ReadonlyArray<{ readonly alias: string; readonly merchantId: string }>;
  /** The day the user's first entry happened, expense or income; null with none. */
  readonly firstDay: string | null;
  readonly benefitLines: ReadonlyArray<BenefitLine>;
  readonly reach: ReadonlyArray<StatementReach>;
  /** Empty when the scope asked for none. */
  readonly charges: ReadonlyArray<Charge>;
};

/** Where a month's rows are read. The live layer (`monthFactsLayer`) goes through `UserData`. */
export class MonthFacts extends Context.Service<
  MonthFacts,
  {
    readonly read: (owner: string, scope: MonthScope) => Effect.Effect<MonthRows, QueryFailed>;
  }
>()("@gousset/core/MonthFacts") {}

/** `MonthFacts` on the database: one transaction of the user's per read. */
export const monthFactsLayer = Layer.effect(
  MonthFacts,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      read: (owner, scope) =>
        userData.transaction(owner, (transaction) => monthRowsIn(transaction, scope)),
    };
  }),
);

/** The months a figure is held against: the average's and the one before. */
type Against = {
  /** `YYYY-MM`. */
  readonly previousMonth: string;
  /** None before the user's first entry. */
  readonly previousCounted: boolean;
  readonly averageFrom: string;
  readonly averageTo: string;
  /** How many months the average counts (#33): 0, and no average, with none. */
  readonly monthsAveraged: number;
};

/** The summary of a month: what came in, what went, what was put aside, what is left. */
export type MonthSummary = Against & {
  readonly month: string;
  /** The user's currency: the one every figure is in; the others are given apart. */
  readonly currency: string;
  /** The income entries that happened in the month, each at its net. */
  readonly received: Money;
  /** Where it came from: the incomes' categories, the largest first. */
  readonly receivedFrom: ReadonlyArray<{
    readonly categoryId: string;
    /** "Parent > Child" for a child. */
    readonly name: string;
    readonly amount: Money;
  }>;
  /** The expense entries, each at its net cost (a works council's funding does not lower it). */
  readonly spent: Money;
  /** The monthly mean of the months averaged; null when none counts. */
  readonly averageSpent: Money | null;
  /** The month before's; null before the user's first entry. */
  readonly previousSpent: Money | null;
  /** What moved, net, onto savings and investment accounts from accounts of any other kind. */
  readonly setAside: Money;
  /** Received less spent less set aside; negative when the month cost more than it brought. */
  readonly left: Money;
  /** The part of left on benefit accounts: never more than left, never less than nothing. */
  readonly restricted: Money;
  /** The same figures in every other currency the month holds, never converted. */
  readonly elsewhere: ReadonlyArray<{
    readonly currency: string;
    readonly received: Money;
    readonly spent: Money;
    readonly setAside: Money;
    readonly left: Money;
  }>;
};

/** A row of "where the money goes", against the average and the month before. */
type SpendingFigures = {
  /** In the user's currency. */
  readonly spent: Money;
  /** In other currencies, never converted nor compared. */
  readonly elsewhere: ReadonlyArray<Money>;
  /** The month before's; null before the user's first entry. */
  readonly previous: Money | null;
  /** The monthly mean of the months averaged; null when none counts. */
  readonly average: Money | null;
};

/** An expense category in the month, a top-level one with its children's spending. */
export type CategorySpending = Omit<CategoryInMonth, "children" | "spent" | "elsewhere"> &
  SpendingFigures & {
    /** Its children, the largest first; empty for a child. */
    readonly children: ReadonlyArray<CategorySpending>;
  };

/** Who was paid in the month. */
export type MerchantSpending = SpendingFigures & {
  /** Null for the row of the expenses that name several merchants or none. */
  readonly id: string | null;
  readonly name: string | null;
  /** A payment intermediary (#30), kept as what is known of who was paid. */
  readonly intermediary: boolean;
};

type SpendingHeader = Against & { readonly month: string; readonly currency: string };

/** Where the money went in a month, by category: the top-level ones, the largest first. */
export type CategorySpendingRead = SpendingHeader & {
  readonly by: "category";
  readonly rows: ReadonlyArray<CategorySpending>;
};

/** Where the money went in a month, by merchant: the largest first, the row of none last. */
export type MerchantSpendingRead = SpendingHeader & {
  readonly by: "merchant";
  readonly rows: ReadonlyArray<MerchantSpending>;
};

export type MonthSpending = CategorySpendingRead | MerchantSpendingRead;

/** What a row of "where the money goes" groups by. */
export type SpendingBy = MonthSpending["by"];

/** One day of a row's spending, a running total in minor units of the user's currency. */
export type SpendingDay = {
  readonly date: string;
  /** Null after today. */
  readonly current: number | null;
  /** The month before's on the same day; null before the user's first entry or past its end. */
  readonly previous: number | null;
};

/** A row's spending, day by day, against the month before's. */
export type SpendingDays = {
  readonly month: string;
  readonly currency: string;
  readonly by: SpendingBy;
  readonly id: string | null;
  /** The row's name; null for the merchants' row of none, or an id that names nothing. */
  readonly name: string | null;
  readonly days: ReadonlyArray<SpendingDay>;
};

/** Money that came in from outside, or moved from one account of the user's to another. */
export type Movement = {
  readonly kind: "income" | "transfer";
  /** An income's day, or the day the side in was booked. */
  readonly day: string;
  /** Who paid (an income), or the account the money left. */
  readonly from: string;
  /** The account it arrived on: the name, the institution too when two share a name. */
  readonly to: string;
  /** An income's category ("Parent > Child"); null for a transfer. */
  readonly note: string | null;
  readonly amount: Money;
};

export type MonthMovements = {
  readonly month: string;
  /** Oldest first. */
  readonly movements: ReadonlyArray<Movement>;
};

/** A line to review, as the review lists the first few. */
export type LineToReview = {
  readonly id: string;
  readonly day: string;
  readonly label: string;
  readonly category: LineCategory | null;
  readonly account: LineAccount;
  readonly amount: Money;
};

/** The lines to review (#35's queue), booked in the month. */
export type MonthLinesToReview = {
  readonly month: string;
  readonly from: string;
  readonly to: string;
  readonly count: number;
  /** The first few, newest first, as the search gives them. */
  readonly lines: ReadonlyArray<LineToReview>;
};

/** An account whose statements stop before the day they should reach. */
export type PartialImport = {
  readonly accountId: string;
  readonly account: string;
  /** How far its statements go; null when none was imported. */
  readonly reached: string | null;
};

/** How far the month's statements were imported. */
export type ImportState = {
  readonly month: string;
  /** The day they should reach: the month's last, or today in the month under way. */
  readonly expected: string;
  /** The open accounts kept by their lines that existed in the month. */
  readonly accounts: number;
  /** Those whose statements reach `expected`. */
  readonly imported: number;
  readonly partial: ReadonlyArray<PartialImport>;
};

/** Something the review points out, in this order of kinds. */
export type MonthFlag =
  | {
      readonly kind: "drift";
      readonly categoryId: string;
      /** "Parent > Child" for a child. */
      readonly name: string;
      readonly spent: Money;
      readonly benchmark: Money;
    }
  | {
      readonly kind: "price-rise";
      /** Its subscription's (`subscriptionId`): one merchant may have several. */
      readonly subscriptionId: string;
      readonly merchant: string;
      readonly from: Money;
      readonly to: Money;
    }
  | {
      readonly kind: "stopped";
      /** Its subscription's (`subscriptionId`): one merchant may have several. */
      readonly subscriptionId: string;
      readonly merchant: string;
      /** The day it was due and did not come. */
      readonly expectedOn: string;
      readonly lastOn: string;
      readonly last: Money;
    }
  | {
      readonly kind: "expiring";
      readonly accountId: string;
      readonly account: string;
      readonly day: string;
      /** What is left on the credits that expire that day. */
      readonly amount: Money;
    }
  | {
      readonly kind: "not-imported";
      readonly accountId: string;
      readonly account: string;
      readonly reached: string | null;
    };

export type MonthFlags = { readonly month: string; readonly flags: ReadonlyArray<MonthFlag> };

/** Every block of the month at once, for the review's page. */
export type MonthReview = {
  readonly month: string;
  readonly currency: string;
  /** The day it was read on. */
  readonly today: string;
  readonly summary: MonthSummary;
  readonly categories: CategorySpendingRead;
  readonly merchants: MerchantSpendingRead;
  readonly movements: MonthMovements;
  readonly linesToReview: MonthLinesToReview;
  readonly importState: ImportState;
  readonly flags: MonthFlags;
};

/** How many lines to review the month lists. */
export const LINES_TO_REVIEW_SHOWN = 3;

/** One entry's net in one currency (an entry's parts share one), with who it names. */
type EntryNet = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly happenedOn: string;
  readonly month: string;
  readonly categoryId: string;
  /** Who was paid, or who paid: its own merchant, else its payment lines'; null for several or none. */
  readonly merchantId: string | null;
  readonly currency: string;
  /** Payments less refunds, positive the entry's way. */
  readonly minor: number;
  /** Its first payment's line, for an income's movement. */
  readonly accountId: string;
  readonly label: string;
  readonly counterpartyName: string | null;
};

/** The rows of a month, with what every block is computed from. */
type Reading = Against & {
  readonly month: string;
  readonly currency: string;
  readonly today: string;
  readonly currentMonth: string;
  readonly rows: MonthRows;
  readonly accounts: ReadonlyMap<string, MonthAccount>;
  readonly merchants: ReadonlyMap<string, MonthMerchant>;
  readonly entries: ReadonlyArray<EntryNet>;
};

const money = (minor: number, currency: string): Money => ({ minor, currency });

const earlier = (a: string, b: string) => (a < b ? a : b);

/** Savings and investments: what the month sets aside. */
const keepsMoney = (kind: AccountKind) => kind === "savings" || kind === "investment";

/**
 * Who an entry names: its own merchant when it is no intermediary, else the one its payment lines'
 * cleaned labels name, an intermediary then kept as what is known of who was paid; null for an
 * entry whose lines name several merchants, or none.
 */
function merchantOf(
  entryMerchantId: string | null,
  payments: ReadonlyArray<MonthPart>,
  merchants: ReadonlyMap<string, MonthMerchant>,
  lineMerchant: (part: MonthPart) => string | null,
): string | null {
  const own = entryMerchantId === null ? undefined : merchants.get(entryMerchantId);

  if (own !== undefined && !own.intermediary) {
    return own.id;
  }

  const named = new Set(payments.map(lineMerchant));
  const [only = null] = named;

  return named.size === 1 ? only : null;
}

/**
 * The merchant a line's cleaned label names, cleaned once per label: a month's lines repeat the
 * same few shops, and cleaning a label is most of what a read computes.
 */
function lineMerchants(rows: MonthRows): (part: MonthPart) => string | null {
  const aliases = new Map(rows.aliases.map((row) => [row.alias, row.merchantId]));
  const known = new Map<string, string | null>();

  return (part) => {
    const text = JSON.stringify([part.label, part.counterpartyName]);
    const cached = known.get(text);

    if (cached !== undefined) {
      return cached;
    }

    const key = merchantKey(part.label, part.counterpartyName);
    const found = key === null ? null : (aliases.get(key) ?? null);

    known.set(text, found);

    return found;
  };
}

/** Each entry's net per currency of its lines' accounts. */
function entriesOf(
  rows: MonthRows,
  accounts: ReadonlyMap<string, MonthAccount>,
  merchants: ReadonlyMap<string, MonthMerchant>,
): ReadonlyArray<EntryNet> {
  const lineMerchant = lineMerchants(rows);
  const byEntry = new Map<string, Array<MonthPart>>();

  for (const part of rows.parts) {
    const known = byEntry.get(part.entryId);

    if (known === undefined) {
      byEntry.set(part.entryId, [part]);
    } else {
      known.push(part);
    }
  }

  return [...byEntry.values()].flatMap((parts): ReadonlyArray<EntryNet> => {
    const payments = parts
      .filter((part) => part.role === "payment")
      .toSorted((a, b) => a.lineId.localeCompare(b.lineId));

    const [first = parts[0]] = payments;

    if (first === undefined) {
      return [];
    }

    const merchantId = merchantOf(first.entryMerchantId, payments, merchants, lineMerchant);
    const nets = new Map<string, number>();

    for (const part of parts) {
      const currency = accounts.get(part.accountId)?.currency;

      if (currency !== undefined) {
        const signed = part.role === "payment" ? part.amountMinor : -part.amountMinor;

        nets.set(currency, (nets.get(currency) ?? 0) + signed);
      }
    }

    return [...nets].map(([currency, minor]) => ({
      id: first.entryId,
      kind: first.kind,
      happenedOn: first.happenedOn,
      month: first.happenedOn.slice(0, 7),
      categoryId: first.categoryId,
      merchantId,
      currency,
      minor,
      accountId: first.accountId,
      label: first.label,
      counterpartyName: first.counterpartyName,
    }));
  });
}

/** The rows, with what every block is computed from. */
function readingOf(rows: MonthRows, month: string, currency: string, today: string): Reading {
  const currentMonth = today.slice(0, 7);
  const previousMonth = addMonths(month, -1);
  const { averageFrom, averageTo } = averageWindow(month, currentMonth);
  const accounts = new Map(rows.accounts.map((account) => [account.id, account]));
  const merchants = new Map(rows.merchants.map((merchant) => [merchant.id, merchant]));

  return {
    month,
    currency,
    today,
    currentMonth,
    previousMonth,
    previousCounted: rows.firstDay !== null && previousMonth >= rows.firstDay.slice(0, 7),
    averageFrom,
    averageTo,
    monthsAveraged: monthsCounted(rows.firstDay, averageFrom, averageTo),
    rows,
    accounts,
    merchants,
    entries: entriesOf(rows, accounts, merchants),
  };
}

const againstOf = (reading: Reading): Against => ({
  previousMonth: reading.previousMonth,
  previousCounted: reading.previousCounted,
  averageFrom: reading.averageFrom,
  averageTo: reading.averageTo,
  monthsAveraged: reading.monthsAveraged,
});

/** Adds `minor` to `currency`'s sum. */
function add(sums: Map<string, number>, currency: string, minor: number) {
  sums.set(currency, (sums.get(currency) ?? 0) + minor);
}

/** A category's name, "Parent > Child" for a child. */
function categoryPath(categories: ReadonlyArray<CategoryRecord>, id: string): string | null {
  const found = categories.find((each) => each.id === id);

  if (found === undefined) {
    return null;
  }

  const parent = categories.find((each) => each.id === found.parentId);

  return parent === undefined ? found.name : `${parent.name} > ${found.name}`;
}

/** An account's name, with its institution when another account shares the name. */
function accountName(reading: Reading, id: string): string {
  const found = reading.accounts.get(id);

  if (found === undefined) {
    return "";
  }

  const shared = reading.rows.accounts.some(
    (other) => other.id !== found.id && other.name === found.name,
  );

  return shared && found.institution !== null ? `${found.name} (${found.institution})` : found.name;
}

/** What the month's figures need from what was read: spent and received by currency. */
function sumsOf(reading: Reading, kind: EntryKind, month: string): Map<string, number> {
  const sums = new Map<string, number>();

  for (const entry of reading.entries) {
    if (entry.kind === kind && entry.month === month) {
      add(sums, entry.currency, entry.minor);
    }
  }

  return sums;
}

/**
 * What moved, net, between a savings or investment account and an account of any other kind, by
 * the booking day of the side on the savings or investment account: in counts, out counts against.
 */
function setAsideOf(reading: Reading): Map<string, number> {
  const sums = new Map<string, number>();

  for (const transfer of reading.rows.transfers) {
    const out = reading.accounts.get(transfer.outAccountId);
    const into = reading.accounts.get(transfer.inAccountId);

    if (out !== undefined && into !== undefined && keepsMoney(out.kind) !== keepsMoney(into.kind)) {
      const side = keepsMoney(into.kind)
        ? { account: into, day: transfer.inBookedOn, minor: transfer.inMinor }
        : { account: out, day: transfer.outBookedOn, minor: transfer.outMinor };

      if (side.day.slice(0, 7) === reading.month) {
        add(sums, side.account.currency, side.minor);
      }
    }
  }

  return sums;
}

function summaryOf(reading: Reading): MonthSummary {
  const { month, currency } = reading;
  const received = sumsOf(reading, "income", month);
  const spent = sumsOf(reading, "expense", month);
  const setAside = setAsideOf(reading);
  const own = (sums: ReadonlyMap<string, number>) => sums.get(currency) ?? 0;
  const left = own(received) - own(spent) - own(setAside);
  let onBenefit = 0;

  for (const line of reading.rows.benefitLines) {
    if (
      line.bookedOn.slice(0, 7) === month &&
      reading.accounts.get(line.accountId)?.currency === currency
    ) {
      onBenefit += line.amountMinor;
    }
  }

  const sources = new Map<string, number>();

  for (const entry of reading.entries) {
    if (entry.kind === "income" && entry.month === month && entry.currency === currency) {
      add(sources, entry.categoryId, entry.minor);
    }
  }

  const receivedFrom = [...sources]
    .flatMap(([categoryId, minor]) => {
      const name = categoryPath(reading.rows.categories, categoryId);

      return name === null || minor === 0
        ? []
        : [{ categoryId, name, amount: money(minor, currency) }];
    })
    .toSorted((a, b) => b.amount.minor - a.amount.minor || a.name.localeCompare(b.name));

  const spentIn = (from: string, to: string) =>
    reading.entries.reduce(
      (sum, entry) =>
        entry.kind === "expense" &&
        entry.currency === currency &&
        entry.month >= from &&
        entry.month <= to
          ? sum + entry.minor
          : sum,
      0,
    );

  const others = [...new Set([...received.keys(), ...spent.keys(), ...setAside.keys()])]
    .filter((other) => other !== currency)
    .toSorted();

  return {
    month,
    currency,
    ...againstOf(reading),
    received: money(own(received), currency),
    receivedFrom,
    spent: money(own(spent), currency),
    averageSpent:
      reading.monthsAveraged === 0
        ? null
        : money(
            Math.round(spentIn(reading.averageFrom, reading.averageTo) / reading.monthsAveraged),
            currency,
          ),
    previousSpent: reading.previousCounted
      ? money(spentIn(reading.previousMonth, reading.previousMonth), currency)
      : null,
    setAside: money(own(setAside), currency),
    left: money(left, currency),
    restricted: money(Math.max(0, Math.min(left, onBenefit)), currency),
    elsewhere: others.flatMap((other) => {
      const figures = [received, spent, setAside].map((sums) => sums.get(other) ?? 0);
      const [inMinor = 0, outMinor = 0, asideMinor = 0] = figures;

      return figures.every((minor) => minor === 0)
        ? []
        : [
            {
              currency: other,
              received: money(inMinor, other),
              spent: money(outMinor, other),
              setAside: money(asideMinor, other),
              left: money(inMinor - outMinor - asideMinor, other),
            },
          ];
    }),
  };
}

/** The month's expenses as the benchmarks sum them: by category, month and currency. */
function historyOf(reading: Reading): ReadonlyArray<MonthlySpending> {
  const sums = new Map<string, MonthlySpending>();

  for (const entry of reading.entries) {
    if (entry.kind === "expense") {
      const key = JSON.stringify([entry.categoryId, entry.month, entry.currency]);
      const known = sums.get(key);

      sums.set(key, {
        categoryId: entry.categoryId,
        month: entry.month,
        currency: entry.currency,
        minor: (known?.minor ?? 0) + entry.minor,
      });
    }
  }

  return [...sums.values()];
}

/** A row's average and month before, from the expenses `counts` keeps, in the user's currency. */
function againstFigures(reading: Reading, counts: (entry: EntryNet) => boolean) {
  let window = 0;
  let before = 0;

  for (const entry of reading.entries) {
    if (entry.kind === "expense" && entry.currency === reading.currency && counts(entry)) {
      if (entry.month >= reading.averageFrom && entry.month <= reading.averageTo) {
        window += entry.minor;
      }

      if (entry.month === reading.previousMonth) {
        before += entry.minor;
      }
    }
  }

  return {
    previous: reading.previousCounted ? money(before, reading.currency) : null,
    average:
      reading.monthsAveraged === 0
        ? null
        : money(Math.round(window / reading.monthsAveraged), reading.currency),
  };
}

/** The ids a category's row counts: its own, and its children's for a top-level one. */
function idsOf(categories: ReadonlyArray<CategoryRecord>, id: string): ReadonlySet<string> {
  return new Set([id, ...categories.flatMap((each) => (each.parentId === id ? [each.id] : []))]);
}

const largestFirst = <Row extends { readonly spent: Money }>(rows: ReadonlyArray<Row>) =>
  rows.toSorted((a, b) => b.spent.minor - a.spent.minor);

function categorySpendingOf(reading: Reading) {
  const benchmarks = benchmarksOf({
    month: reading.month,
    currency: reading.currency,
    currentMonth: reading.currentMonth,
    categories: reading.rows.categories,
    history: historyOf(reading),
    firstDay: reading.rows.firstDay,
  });

  const rowOf = (row: CategoryInMonth): CategorySpending => {
    const ids = idsOf(reading.rows.categories, row.id);

    return {
      ...row,
      ...againstFigures(reading, (entry) => ids.has(entry.categoryId)),
      children: largestFirst(row.children.map(rowOf)),
    };
  };

  const read: CategorySpendingRead = {
    month: reading.month,
    currency: reading.currency,
    ...againstOf(reading),
    by: "category",
    rows: largestFirst(benchmarks.categories.map(rowOf)),
  };

  return { read, drifting: benchmarks.drifting };
}

function merchantSpendingOf(reading: Reading): MerchantSpendingRead {
  const named = new Map<string | null, Map<string, number>>();

  for (const entry of reading.entries) {
    if (entry.kind === "expense" && entry.month === reading.month) {
      const sums = named.get(entry.merchantId) ?? new Map<string, number>();

      add(sums, entry.currency, entry.minor);
      named.set(entry.merchantId, sums);
    }
  }

  const rows = [...named].map(([id, sums]): MerchantSpending => {
    const merchant = id === null ? undefined : reading.merchants.get(id);

    return {
      id,
      name: merchant?.name ?? null,
      intermediary: merchant?.intermediary ?? false,
      spent: money(sums.get(reading.currency) ?? 0, reading.currency),
      elsewhere: [...sums]
        .filter(([other, minor]) => other !== reading.currency && minor !== 0)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([other, minor]) => money(minor, other)),
      ...againstFigures(reading, (entry) => entry.merchantId === id),
    };
  });

  return {
    month: reading.month,
    currency: reading.currency,
    ...againstOf(reading),
    by: "merchant",
    rows: rows.toSorted(
      (a, b) =>
        Number(a.id === null) - Number(b.id === null) ||
        b.spent.minor - a.spent.minor ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    ),
  };
}

/** How many days a month `YYYY-MM` has. */
const daysIn = (month: string) => Number(lastDayOf(month).slice(8, 10));

/** A row's expenses in `month`, a running total by day (index 0 is the 1st). */
function runningTotal(
  reading: Reading,
  month: string,
  counts: (entry: EntryNet) => boolean,
): ReadonlyArray<number> {
  const byDay = Array.from({ length: daysIn(month) }, () => 0);

  for (const entry of reading.entries) {
    if (
      entry.kind === "expense" &&
      entry.month === month &&
      entry.currency === reading.currency &&
      counts(entry)
    ) {
      const index = Number(entry.happenedOn.slice(8, 10)) - 1;

      byDay[index] = (byDay[index] ?? 0) + entry.minor;
    }
  }

  let total = 0;

  return byDay.map((minor) => (total += minor));
}

function daysOf(reading: Reading, by: SpendingBy, id: string | null): SpendingDays {
  const categories = reading.rows.categories;
  const ids = id === null ? new Set<string>() : idsOf(categories, id);

  const counts =
    by === "category"
      ? (entry: EntryNet) => ids.has(entry.categoryId)
      : (entry: EntryNet) => entry.merchantId === id;

  const name =
    id === null
      ? null
      : by === "category"
        ? categoryPath(categories, id)
        : (reading.merchants.get(id)?.name ?? null);

  const current = runningTotal(reading, reading.month, counts);

  const previous = reading.previousCounted
    ? runningTotal(reading, reading.previousMonth, counts)
    : [];

  return {
    month: reading.month,
    currency: reading.currency,
    by,
    id,
    name,
    days: current.map((total, index) => {
      const date = `${reading.month}-${String(index + 1).padStart(2, "0")}`;

      return {
        date,
        current: date > reading.today ? null : total,
        previous: previous[index] ?? null,
      };
    }),
  };
}

function movementsOf(reading: Reading): MonthMovements {
  const incomes = reading.entries.flatMap((entry): ReadonlyArray<Movement> => {
    if (entry.kind !== "income" || entry.month !== reading.month) {
      return [];
    }

    const merchant =
      entry.merchantId === null ? undefined : reading.merchants.get(entry.merchantId);

    return [
      {
        kind: "income",
        day: entry.happenedOn,
        from: merchant?.name ?? entry.counterpartyName ?? entry.label,
        to: accountName(reading, entry.accountId),
        note: categoryPath(reading.rows.categories, entry.categoryId),
        amount: money(entry.minor, entry.currency),
      },
    ];
  });

  const transfers = reading.rows.transfers.flatMap((transfer): ReadonlyArray<Movement> => {
    const into = reading.accounts.get(transfer.inAccountId);

    return into === undefined || transfer.inBookedOn.slice(0, 7) !== reading.month
      ? []
      : [
          {
            kind: "transfer",
            day: transfer.inBookedOn,
            from: accountName(reading, transfer.outAccountId),
            to: accountName(reading, into.id),
            note: null,
            amount: money(transfer.inMinor, into.currency),
          },
        ];
  });

  return {
    month: reading.month,
    movements: [...incomes, ...transfers].toSorted(
      (a, b) =>
        a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from),
    ),
  };
}

function importStateOf(reading: Reading): ImportState {
  const first = `${reading.month}-01`;
  const last = lastDayOf(reading.month);
  const expected = earlier(last, reading.today);
  const reach = new Map(reading.rows.reach.map((row) => [row.accountId, row]));

  // The open accounts kept by their lines, opened by the month's end and not closed before it.
  const counted = reading.rows.accounts.filter(
    (account) =>
      account.mode === "lines" &&
      (account.openedOn === null || account.openedOn <= last) &&
      (account.closedOn === null || account.closedOn >= first),
  );

  const partial = counted
    .flatMap((account): ReadonlyArray<PartialImport> => {
      const known = reach.get(account.id);

      const statementTo = known?.statementTo ?? null;

      const until = statementsUntil({
        importedTo: known?.importedTo ?? null,
        statements: statementTo === null ? [] : [{ day: statementTo }],
      });

      const reached = until?.day ?? null;
      // An account closed during the month has no statement after its closing day.
      const due = account.closedOn === null ? expected : earlier(account.closedOn, expected);

      return reached !== null && reached >= due
        ? []
        : [{ accountId: account.id, account: accountName(reading, account.id), reached }];
    })
    .toSorted((a, b) => a.account.localeCompare(b.account));

  return {
    month: reading.month,
    expected,
    accounts: counted.length,
    imported: counted.length - partial.length,
    partial,
  };
}

function flagsOf(
  reading: Reading,
  drifting: ReadonlyArray<CategoryInMonth>,
  importState: ImportState,
): MonthFlags {
  const drifts = drifting.flatMap((row): ReadonlyArray<MonthFlag> => {
    const mark = row.benchmark.mode === "none" ? null : row.benchmark.amount;

    return mark === null
      ? []
      : [
          {
            kind: "drift",
            categoryId: row.id,
            name: categoryPath(reading.rows.categories, row.id) ?? row.name,
            spent: row.spent,
            benchmark: mark,
          },
        ];
  });

  const asOf = earlier(lastDayOf(reading.month), reading.today);

  const detected = subscriptionsOfMonth(
    detectSubscriptions(reading.rows.charges, asOf),
    reading.month,
    asOf,
  );

  const rises = detected.rises.flatMap((each): ReadonlyArray<MonthFlag> =>
    each.priceRise === null
      ? []
      : [
          {
            kind: "price-rise",
            subscriptionId: subscriptionId(each),
            merchant: each.merchant,
            from: money(each.priceRise.fromMinor, each.currency),
            to: money(each.priceRise.toMinor, each.currency),
          },
        ],
  );

  const stopped = detected.stopped.map((each): MonthFlag => ({
    kind: "stopped",
    subscriptionId: subscriptionId(each),
    merchant: each.merchant,
    expectedOn: each.stoppedOn ?? each.nextOn,
    lastOn: each.lastOn,
    last: money(each.lastMinor, each.currency),
  }));

  const next = addMonths(reading.month, 1);
  const range = { from: `${reading.month}-01`, to: lastDayOf(next) };
  const expiringAsOf = earlier(range.to, reading.today);

  const expiring = reading.rows.accounts
    .filter(followsCredits)
    .flatMap((account) =>
      expiringCreditsOf(
        account,
        reading.rows.benefitLines.filter(
          (line) => line.accountId === account.id && line.bookedOn <= expiringAsOf,
        ),
        range,
      ),
    )
    .toSorted((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
    .map((credit): MonthFlag => ({
      kind: "expiring",
      accountId: credit.accountId,
      account: accountName(reading, credit.accountId),
      day: credit.day,
      amount: credit.amount,
    }));

  const notImported = importState.partial.map((partial): MonthFlag => ({
    kind: "not-imported",
    ...partial,
  }));

  return {
    month: reading.month,
    flags: [...drifts, ...rises, ...stopped, ...expiring, ...notImported],
  };
}

/** Reads `month`'s rows in one transaction, after refusing a month to come. */
const readMonth = (owner: string, month: string, currency: string, withCharges: boolean) =>
  Effect.gen(function* () {
    const day = yield* checkedToday(month);
    const facts = yield* MonthFacts;
    const { averageFrom } = averageWindow(month, day.slice(0, 7));
    const last = lastDayOf(month);

    const rows = yield* facts.read(owner, {
      entries: { from: `${averageFrom}-01`, to: last },
      transfers: { from: `${month}-01`, to: last },
      benefitTo: earlier(lastDayOf(addMonths(month, 1)), day),
      statementsTo: day,
      charges: withCharges ? chargeRange(earlier(last, day)) : null,
    });

    return readingOf(rows, month, currency, day);
  });

/**
 * The month in one bar (`month`, `YYYY-MM`, in the user's `currency`): received and from what,
 * spent against the average and the month before, set aside, left and its restricted part, the
 * other currencies apart. A month to come is refused (`FutureMonthRefused`).
 */
export const monthSummary = (owner: string, month: string, currency: string) =>
  Effect.map(readMonth(owner, month, currency, false), summaryOf);

/**
 * Where the money went in the month, by category (with benchmarks and drifts, #33) or by merchant,
 * each row against the average and the month before. A month to come is refused.
 */
export const monthSpending = (owner: string, month: string, currency: string, by: SpendingBy) =>
  Effect.map(readMonth(owner, month, currency, false), (reading): MonthSpending =>
    by === "category" ? categorySpendingOf(reading).read : merchantSpendingOf(reading),
  );

/**
 * A row's spending, day by day, against the month before's: a category's id (a top-level one with
 * its children), a merchant's, or null for the merchants' row of none. A month to come is refused.
 */
export const spendingDays = (
  owner: string,
  month: string,
  currency: string,
  by: SpendingBy,
  id: string | null,
) => Effect.map(readMonth(owner, month, currency, false), (reading) => daysOf(reading, by, id));

/** The month's incomes and the transfers whose side in it booked, oldest first. */
export const monthMovements = (owner: string, month: string, currency: string) =>
  Effect.map(readMonth(owner, month, currency, false), movementsOf);

/**
 * The lines to review booked in the month: #35's review queue (`reviewQueue`), how many and the
 * first few. A month to come is refused.
 */
export const monthLinesToReview = (owner: string, month: string) =>
  Effect.gen(function* () {
    yield* checkedToday(month);

    const from = `${month}-01`;
    const to = lastDayOf(month);

    // A month's first and last days always read: the search refuses no such period.
    const page = yield* reviewQueue(owner, { from, to, limit: LINES_TO_REVIEW_SHOWN }).pipe(
      Effect.catchTag("LineSearchRefused", Effect.die),
    );

    const read: MonthLinesToReview = {
      month,
      from,
      to,
      count: page.total,
      lines: page.lines.map(({ line }) => ({
        id: line.id,
        day: line.bookedOn,
        label: line.label,
        category: line.category,
        account: line.account,
        amount: line.amount,
      })),
    };

    return read;
  });

/** How far the month's statements were imported, account by account. */
export const monthImportState = (owner: string, month: string, currency: string) =>
  Effect.map(readMonth(owner, month, currency, false), importStateOf);

/**
 * What the review points out, in this order: the categories that drift, the subscriptions whose
 * price rose and those that stopped (#34), the benefit credits that expire in the month or the next
 * with something left, the accounts not imported. A month to come is refused.
 */
export const monthFlags = (owner: string, month: string, currency: string) =>
  Effect.map(readMonth(owner, month, currency, true), (reading) =>
    flagsOf(reading, categorySpendingOf(reading).drifting, importStateOf(reading)),
  );

/**
 * Every block of the month at once, for the review's page: one transaction for the month's rows,
 * and the search of the lines to review. A month to come is refused.
 */
export const monthReview = (owner: string, month: string, currency: string) =>
  Effect.gen(function* () {
    const reading = yield* readMonth(owner, month, currency, true);
    const linesToReview = yield* monthLinesToReview(owner, month);
    const categories = categorySpendingOf(reading);
    const importState = importStateOf(reading);

    const review: MonthReview = {
      month,
      currency,
      today: reading.today,
      summary: summaryOf(reading),
      categories: categories.read,
      merchants: merchantSpendingOf(reading),
      movements: movementsOf(reading),
      linesToReview,
      importState,
      flags: flagsOf(reading, categories.drifting, importState),
    };

    return review;
  });
