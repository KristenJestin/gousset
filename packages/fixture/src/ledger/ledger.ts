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

/**
 * What a line is (docs/vision.md, "Kinds of money movement"): a `purchase` of securities, a
 * `dividend` and a `fee` move money inside an investment account.
 */
export type LineKind =
  | "expense"
  | "income"
  | "transfer"
  | "purchase"
  | "refund"
  | "dividend"
  | "fee";

/** A security the person holds: an invented ISIN, with its check digit, and no real one. */
export type Security = {
  /** In the country code `XX`, which no country has. */
  isin: string;
  name: string;
  /** The currency it is quoted in (ISO 4217). */
  currency: string;
};

/**
 * What a line of an investment account was, as its broker says (docs/data-model.md, v0.6): the
 * line keeps the day and the amount, the operation the rest.
 */
export type LineOperation = {
  kind: "deposit" | "withdrawal" | "purchase" | "sale" | "dividend" | "fee";
  /** A purchase's, a sale's and a dividend's security; a fee's when it names one. */
  isin: string | null;
  /** A purchase's and a sale's, exact decimals as a broker writes them (`2.9800`). */
  quantity: string | null;
  /** In the account's currency. */
  unitPrice: string | null;
  /** In minor units: its fees, or a dividend's withholding tax. */
  feesMinor: number;
};

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
  /** A line of an investment account: what its broker says it was; `null` for any other. */
  operation: LineOperation | null;
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
  /** What the money was spent for (docs/vision.md, "Subjects"); most expenses have none. */
  subjects: ReadonlyArray<string>;
};

/** An account's statement for the month, as imported: it covers the month up to `coveredTo`. */
export type ImportedStatement = {
  accountId: string;
  /** `YYYY-MM-DD`: the last day the imported statement covers. */
  coveredTo: string;
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
  /** One per account, in the accounts' order. */
  statements: ReadonlyArray<ImportedStatement>;
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

/** The invented ISINs of the two ETFs, with their check digits. */
const WORLD_INDEX = "XX0000000002";
const EMERGING_MARKETS = "XX0000000010";

/** The two ETFs the PEA buys a fraction of each month. */
export const madeUpSecurities: ReadonlyArray<Security> = [
  { isin: WORLD_INDEX, name: "World Index ETF", currency: "EUR" },
  { isin: EMERGING_MARKETS, name: "Emerging Markets ETF", currency: "EUR" },
];

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The investment's first month: its contributions are counted from there. */
const FIRST_INVESTED_MONTH = { year: 2025, month: 1 };

const MONTHLY_CONTRIBUTION_MINOR = 35_000;

/** What the PEA spends on the emerging markets each month, its custody fee, its dividend. */
const EMERGING_MINOR = 1200;
const CUSTODY_FEE_MINOR = 150;
const DIVIDEND_MINOR = 412;

/** The subscription's price goes up in October 2026, so that the review has a change to flag. */
const SUBSCRIPTION_RISE = "2026-10";

/** What a merchant's expenses are spent for; the same every month. */
const SUBJECTS_OF_MERCHANT: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["Fuelstop", ["Van"]],
  ["Glycine Homes", ["Home"]],
]);

/**
 * A unit's price in a month, in ten-thousandths of a euro: a few euro cents more each month from
 * January 2025, never below 10 €.
 */
function priceIn(year: number, month: number, january2025: number, rise: number): number {
  return Math.max(january2025 + ((year - 2025) * 12 + (month - 1)) * rise, 100_000);
}

/** Ten-thousandths as a decimal of four places: 1124519 is `112.4519`. */
function fourPlaces(tenThousandths: number): string {
  return `${String(Math.floor(tenThousandths / 10_000))}.${String(tenThousandths % 10_000).padStart(4, "0")}`;
}

/**
 * A purchase of what `cashMinor` buys at `price` (ten-thousandths of a euro), its fees taken off
 * first: a fraction of a unit to four places, as a broker rounds it.
 */
function purchaseOf(
  isin: string,
  cashMinor: number,
  price: number,
  feesMinor: number,
): LineOperation {
  return {
    kind: "purchase",
    isin,
    quantity: fourPlaces(Math.round(((cashMinor - feesMinor) * 1_000_000) / price)),
    unitPrice: fourPlaces(price),
    feesMinor,
  };
}

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

type Draft = Omit<Line, "id" | "counterpartLineId" | "reviewed" | "operation"> & {
  operation?: LineOperation | undefined;
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

  const transfer = (
    from: string,
    to: string,
    date: string,
    label: string,
    amountMinor: number,
    intoOperation?: LineOperation,
  ) => {
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
        operation: intoOperation,
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

  spend(
    "current",
    day(15),
    "DIRECT DEBIT STREAMLY SUBSCRIPTION",
    "Streamly",
    "Subscriptions",
    month < SUBSCRIPTION_RISE ? 899 : 949,
  );

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
  transfer("current", "pea", day(12), "SEPA TRF TO NORTHBANK PEA", MONTHLY_CONTRIBUTION_MINOR, {
    kind: "deposit",
    isin: null,
    quantity: null,
    unitPrice: null,
    feesMinor: 0,
  });

  // The month's contribution buys a fraction of the world index, fees included, and a little of
  // the emerging markets; a custody fee is charged at the month's end, and the emerging markets
  // pay a dividend each quarter. The cash left stays above zero.
  const worldMinor = 33_500 + random.between(0, 10) * 10;

  drafts.push(
    {
      accountId: "pea",
      bookedOn: day(14),
      amountMinor: -worldMinor,
      label: "BUY WORLD INDEX ETF",
      kind: "purchase",
      merchant: null,
      category: null,
      operation: purchaseOf(
        WORLD_INDEX,
        worldMinor,
        priceIn(year, monthNumber, 1_124_519, 3700),
        99,
      ),
    },
    {
      accountId: "pea",
      bookedOn: day(14),
      amountMinor: -EMERGING_MINOR,
      label: "BUY EMERGING MARKETS ETF",
      kind: "purchase",
      merchant: null,
      category: null,
      operation: purchaseOf(
        EMERGING_MARKETS,
        EMERGING_MINOR,
        priceIn(year, monthNumber, 245_310, 1100),
        0,
      ),
    },
    {
      accountId: "pea",
      bookedOn: day(28),
      amountMinor: -CUSTODY_FEE_MINOR,
      label: "CUSTODY FEE",
      kind: "fee",
      merchant: null,
      category: null,
      operation: { kind: "fee", isin: null, quantity: null, unitPrice: null, feesMinor: 0 },
    },
  );

  if (monthNumber % 3 === 0) {
    drafts.push({
      accountId: "pea",
      bookedOn: day(25),
      amountMinor: DIVIDEND_MINOR,
      label: "DIVIDEND EMERGING MARKETS ETF",
      kind: "dividend",
      merchant: null,
      category: null,
      operation: {
        kind: "dividend",
        isin: EMERGING_MARKETS,
        quantity: null,
        unitPrice: null,
        feesMinor: 0,
      },
    });
  }

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
    operation: draft.operation ?? null,
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
      subjects: SUBJECTS_OF_MERCHANT.get(draft.merchant) ?? [],
    });
  }

  return {
    month,
    accounts: madeUpAccounts,
    lines,
    expenses,
    investments: [investmentAt(year, monthNumber)],
    statements: statementsOf(month, year, monthNumber, lines),
  };
}

/**
 * Every statement covers the whole month, but the benefit account's: its statement was downloaded
 * the day of its last line, so the review has an account not imported to the month's end.
 */
function statementsOf(
  month: string,
  year: number,
  monthNumber: number,
  lines: ReadonlyArray<Line>,
): Array<ImportedStatement> {
  const monthEnd = `${month}-${String(daysIn(year, monthNumber)).padStart(2, "0")}`;

  return madeUpAccounts.map((account) => {
    const last = lines.findLast((line) => line.accountId === account.id)?.bookedOn;

    return {
      accountId: account.id,
      coveredTo: account.kind === "benefit" && last !== undefined ? last : monthEnd,
    };
  });
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
    name: "World Index ETF",
    isin: WORLD_INDEX,
    netContributionsMinor,
    // About 0.5 % a month on what was put in, in whole minor units.
    valueMinor: Math.round(netContributionsMinor * (1 + months * 0.005)),
  };
}
