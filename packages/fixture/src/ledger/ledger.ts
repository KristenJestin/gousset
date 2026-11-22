import { monthSeed, seededRandom } from "./random";

// The made-up money of one person, month by month: accounts, the lines of their statements, the
// expenses those lines make, the transfers between the accounts and an investment. Every name and
// number is invented. The shapes are kept minimal and close to the words of docs/vision.md until
// the data model (docs/data-model.md) is written.

/** The seed of the shared made-up data: change it and every story, test and screen changes. */
export const FIXTURE_SEED = 20_261_122;

export type AccountKind = "current" | "savings" | "benefit" | "investment";

export type Account = {
  id: string;
  name: string;
  bank: string;
  kind: AccountKind;
  /** One currency per account (ISO 4217). */
  currency: string;
};

/** What a line is (docs/vision.md, "Kinds of money movement"). */
export type LineKind = "expense" | "income" | "transfer" | "purchase" | "refund";

/** One line of an account's statement, as imported, with what the rules made of it. */
export type Line = {
  /** Unique across months: `2026-10-l07`. */
  id: string;
  accountId: string;
  /** `YYYY-MM-DD`. */
  bookedOn: string;
  /** In minor units of the account's currency: negative for money out, positive for money in. */
  amountMinor: number;
  /** The bank's raw label. */
  label: string;
  kind: LineKind;
  /** Who was paid or who paid, cleaned from the label; `null` for a transfer. */
  merchant: string | null;
  /** The category the rules proposed; `null` for a transfer or a purchase of securities. */
  category: string | null;
  /** The other side of a transfer, on another of the person's accounts. */
  counterpartLineId: string | null;
  /** `false`: the rules were not sure, and the line waits in the monthly review. */
  reviewed: boolean;
};

/** What happened, at its net cost: its payments, less its refunds. */
export type Expense = {
  /** Unique across months: `2026-10-e03`. */
  id: string;
  bookedOn: string;
  merchant: string;
  category: string;
  paymentLineIds: ReadonlyArray<string>;
  refundLineIds: ReadonlyArray<string>;
  /** Positive, in minor units: what the expense cost once refunded. */
  netMinor: number;
};

/** A position of an investment account at the end of the month. */
export type Investment = {
  accountId: string;
  name: string;
  /** An invented identifier in the shape of an ISIN; no real security. */
  isin: string;
  /** What came out of the person's pocket into it so far, in minor units. */
  netContributionsMinor: number;
  valueMinor: number;
};

/** One month of the person's money. */
export type MadeUpMonth = {
  /** `YYYY-MM`. */
  month: string;
  accounts: ReadonlyArray<Account>;
  lines: ReadonlyArray<Line>;
  expenses: ReadonlyArray<Expense>;
  investments: ReadonlyArray<Investment>;
};

export const madeUpAccounts: ReadonlyArray<Account> = [
  {
    id: "current",
    name: "Current account",
    bank: "Riverside Bank",
    kind: "current",
    currency: "EUR",
  },
  { id: "livret-a", name: "Livret A", bank: "Riverside Bank", kind: "savings", currency: "EUR" },
  { id: "mealcard", name: "MealCard", bank: "MealCard", kind: "benefit", currency: "EUR" },
  { id: "pea", name: "Northbank PEA", bank: "Northbank", kind: "investment", currency: "EUR" },
];

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The investment's first month: its contributions are counted from there. */
const FIRST_INVESTED_MONTH = { year: 2025, month: 1 };

const MONTHLY_CONTRIBUTION_MINOR = 35_000;

/** `2026-10` as its year and month, or an error that says the expected form. */
export function monthParts(month: string) {
  const match = MONTH.exec(month);

  if (match === null) {
    throw new Error(`A month is written YYYY-MM, as 2026-10; got "${month}".`);
  }

  return { year: Number(match[1]), month: Number(match[2]) };
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type Draft = Omit<Line, "id" | "counterpartLineId" | "reviewed"> & {
  counterpartIndex?: number;
  /** A refund names the payment it cancels part of, by its index among the drafts. */
  refundsIndex?: number;
};

/**
 * The made-up data of one month, the same for the same month and seed. The person is paid at the
 * start of the month, pays rent, shops, sets money aside on a savings account and an investment
 * account, and leaves six lines for the monthly review.
 */
export function madeUpMonth(month: string, seed: number = FIXTURE_SEED): MadeUpMonth {
  const { year, month: monthNumber } = monthParts(month);
  const random = seededRandom(monthSeed(seed, month));
  const lastDay = daysIn(year, monthNumber);
  const day = (date: number) => `${month}-${String(Math.min(date, lastDay)).padStart(2, "0")}`;
  const anyDay = () => day(random.between(1, lastDay));
  const drafts: Array<Draft> = [];

  const spend = (
    accountId: string,
    date: string,
    label: string,
    merchant: string,
    category: string,
    amountMinor: number,
  ) => {
    drafts.push({
      accountId,
      bookedOn: date,
      amountMinor: -amountMinor,
      label,
      kind: "expense",
      merchant,
      category,
    });

    return drafts.length - 1;
  };

  const transfer = (from: string, to: string, date: string, label: string, amountMinor: number) => {
    const out = drafts.length;

    drafts.push(
      {
        accountId: from,
        bookedOn: date,
        amountMinor: -amountMinor,
        label,
        kind: "transfer",
        merchant: null,
        category: null,
        counterpartIndex: out + 1,
      },
      {
        accountId: to,
        bookedOn: date,
        amountMinor,
        label,
        kind: "transfer",
        merchant: null,
        category: null,
        counterpartIndex: out,
      },
    );
  };

  drafts.push(
    {
      accountId: "current",
      bookedOn: day(random.between(1, 3)),
      amountMinor: 290_000 + random.between(0, 40) * 100,
      label: "SEPA TRF ACME CONSULTING SALARY",
      kind: "income",
      merchant: "Acme Consulting",
      category: "Salary",
    },
    {
      accountId: "mealcard",
      bookedOn: day(2),
      amountMinor: 22_000,
      label: "MEALCARD CREDIT EMPLOYER",
      kind: "income",
      merchant: "Acme Consulting",
      category: "Meal vouchers",
    },
  );

  spend("current", day(5), "DIRECT DEBIT GLYCINE HOMES RENT", "Glycine Homes", "Housing", 69_000);

  const variable: Array<number> = [];

  for (let count = random.between(6, 9); count > 0; count--) {
    const merchant = random.pick(["Greenmarket", "Corner Grocer", "Fresh Basket"]);
    const onMealCard = random.next() < 0.3;

    variable.push(
      spend(
        onMealCard ? "mealcard" : "current",
        anyDay(),
        `${onMealCard ? "MEALCARD" : "CB"} ${merchant.toUpperCase()} RIVERTON`,
        merchant,
        "Groceries",
        random.between(1500, 9000),
      ),
    );
  }

  for (let count = random.between(2, 4); count > 0; count--) {
    const merchant = random.pick(["Little Bistro", "Noodle Bar"]);

    variable.push(
      spend(
        "mealcard",
        anyDay(),
        `MEALCARD ${merchant.toUpperCase()}`,
        merchant,
        "Restaurants",
        random.between(1200, 4500),
      ),
    );
  }

  for (let count = random.between(2, 3); count > 0; count--) {
    variable.push(
      spend(
        "current",
        anyDay(),
        "CB FUELSTOP 0412 RIVERTON",
        "Fuelstop",
        "Transport",
        random.between(4000, 7000),
      ),
    );
  }

  for (let count = random.between(0, 2); count > 0; count--) {
    variable.push(
      spend(
        "current",
        anyDay(),
        "CB HILLSIDE PHARMACY",
        "Hillside Pharmacy",
        "Health",
        random.between(800, 3000),
      ),
    );
  }

  spend("current", day(15), "DIRECT DEBIT STREAMLY SUBSCRIPTION", "Streamly", "Subscriptions", 949);

  const pixelplay = spend("current", anyDay(), "PAYLINK *PIXELPLAY", "Pixelplay", "Leisure", 1499);
  const gymDay = random.between(1, lastDay - 1);
  const gym = spend("current", day(gymDay), "CB RIVERSIDE GYM", "Riverside Gym", "Leisure", 3500);

  drafts.push({
    accountId: "current",
    bookedOn: day(random.between(gymDay + 1, lastDay)),
    amountMinor: 2650,
    label: "SEPA TRF PERKSHUB REFUND",
    kind: "refund",
    merchant: "PerksHub",
    category: "Leisure",
    refundsIndex: gym,
  });

  const refund = drafts.length - 1;

  transfer("current", "livret-a", day(10), "SEPA TRF TO LIVRET A", 25_000);
  transfer("current", "pea", day(12), "SEPA TRF TO NORTHBANK PEA", MONTHLY_CONTRIBUTION_MINOR);
  drafts.push({
    accountId: "pea",
    bookedOn: day(14),
    amountMinor: -(33_500 + random.between(0, 10) * 10),
    label: "BUY WORLD INDEX ETF",
    kind: "purchase",
    merchant: null,
    category: null,
  });

  // Six lines the rules were not sure of: the intermediary, the refund, and four others.
  const toReview = new Set([pixelplay, refund]);

  while (toReview.size < 6) {
    toReview.add(random.pick(variable));
  }

  return assemble(month, year, monthNumber, drafts, toReview);
}

function assemble(
  month: string,
  year: number,
  monthNumber: number,
  drafts: ReadonlyArray<Draft>,
  toReview: ReadonlySet<number>,
): MadeUpMonth {
  // Booked in date order, as a statement lists them; ids follow that order.
  const order = drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => a.draft.bookedOn.localeCompare(b.draft.bookedOn) || a.index - b.index);

  const idOf = new Map(
    order.map(({ index }, position) => [
      index,
      `${month}-l${String(position + 1).padStart(2, "0")}`,
    ]),
  );

  const lineId = (index: number) => idOf.get(index) ?? "";

  const lines: Array<Line> = order.map(({ draft, index }) => ({
    id: lineId(index),
    accountId: draft.accountId,
    bookedOn: draft.bookedOn,
    amountMinor: draft.amountMinor,
    label: draft.label,
    kind: draft.kind,
    merchant: draft.merchant,
    category: draft.category,
    counterpartLineId: draft.counterpartIndex === undefined ? null : lineId(draft.counterpartIndex),
    reviewed: !toReview.has(index),
  }));

  const refundsOf = new Map<number, Array<number>>();

  for (const [index, draft] of drafts.entries()) {
    if (draft.refundsIndex !== undefined) {
      const refunds = refundsOf.get(draft.refundsIndex) ?? [];

      refunds.push(index);
      refundsOf.set(draft.refundsIndex, refunds);
    }
  }

  const expenses: Array<Expense> = [];

  for (const { draft, index } of order) {
    if (draft.kind !== "expense" || draft.merchant === null || draft.category === null) {
      continue;
    }

    const refunds = refundsOf.get(index) ?? [];

    const refunded = refunds.reduce(
      (sum, refundIndex) => sum + (drafts[refundIndex]?.amountMinor ?? 0),
      0,
    );

    expenses.push({
      id: `${month}-e${String(expenses.length + 1).padStart(2, "0")}`,
      bookedOn: draft.bookedOn,
      merchant: draft.merchant,
      category: draft.category,
      paymentLineIds: [lineId(index)],
      refundLineIds: refunds.map(lineId),
      netMinor: -draft.amountMinor - refunded,
    });
  }

  return {
    month,
    accounts: madeUpAccounts,
    lines,
    expenses,
    investments: [investmentAt(year, monthNumber)],
  };
}

/** The PEA's one position at the end of the month: a contribution a month, growing slowly. */
function investmentAt(year: number, month: number): Investment {
  const months = Math.max(
    0,
    (year - FIRST_INVESTED_MONTH.year) * 12 + (month - FIRST_INVESTED_MONTH.month) + 1,
  );

  const netContributionsMinor = months * MONTHLY_CONTRIBUTION_MINOR;

  return {
    accountId: "pea",
    name: "World index ETF",
    isin: "XX0000000001",
    netContributionsMinor,
    // About 0.5 % a month on what was put in, in whole minor units.
    valueMinor: Math.round(netContributionsMinor * (1 + months * 0.005)),
  };
}
