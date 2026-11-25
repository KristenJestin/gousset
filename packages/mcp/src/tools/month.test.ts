import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Today,
  Transfers,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
  merchantKey,
} from "@gousset/core";
import type {
  AccountRecord,
  CategoryRecord,
  Charge,
  MemoryLineRows,
  MonthAccount,
  MonthPart,
  MonthRows,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { callText, connectInProcess } from "../test-client";
import type { Caller } from "../tool";

// The month tool: its subscriptions, detected from the charges `Subscriptions` reads (core's tests
// hold the detection's own rules), and the month read (#32) from the rows `MonthFacts` gives (core's
// tests hold every figure's rules): what each action writes, by name, and what it refuses.

const TODAY = "2026-11-24";
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };

let made = 0;

function charge(merchant: string, day: string, amountMinor: number): Charge {
  made += 1;

  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, "0")}`,
    merchantId: `merchant-${merchant}`,
    merchant,
    day,
    amountMinor,
    currency: "EUR",
  };
}

/** Made-up charges: a monthly price that rose this month, one that stopped, a bill that varies. */
const CHARGES: ReadonlyArray<Charge> = [
  ...["2026-07-08", "2026-08-08", "2026-09-08", "2026-10-08"].map((day) =>
    charge("Streamly", day, 949),
  ),
  charge("Streamly", "2026-11-08", 1099),
  ...["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map((day) =>
    charge("Fitclub", day, 2900),
  ),
  charge("Wavely Mobile", "2026-08-30", 1600),
  charge("Wavely Mobile", "2026-09-30", 2340),
  charge("Wavely Mobile", "2026-10-30", 1875),
];

type Range = { readonly from: string; readonly to: string };

/** A month of the user's: its rows, with how to add to them. */
type Month = {
  accounts: Array<MonthAccount>;
  categories: Array<CategoryRecord>;
  parts: Array<MonthPart>;
  transfers: Array<MonthRows["transfers"][number]>;
  merchants: Array<MonthRows["merchants"][number]>;
  aliases: Array<MonthRows["aliases"][number]>;
  firstDay: string | null;
  benefitLines: Array<MonthRows["benefitLines"][number]>;
  reach: Array<MonthRows["reach"][number]>;
  charges: Array<Charge>;
  maybeRefunds: Array<string>;
};

const empty = (): Month => ({
  accounts: [],
  categories: [],
  parts: [],
  transfers: [],
  merchants: [],
  aliases: [],
  firstDay: null,
  benefitLines: [],
  reach: [],
  charges: [],
  maybeRefunds: [],
});

type Connection = {
  readonly charges?: ReadonlyArray<Charge>;
  readonly asked?: Array<Range>;
  readonly month?: Month;
  readonly lines?: MemoryLineRows;
};

/** A client of the server on the charges and the month's rows given. */
function connect(given: Connection = {}) {
  const charges = given.charges ?? CHARGES;
  const asked = given.asked ?? [];
  const rows = given.month ?? empty();

  return connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              memoryAccountStore(),
              memoryLineStore(new Map([["ada", given.lines ?? {}]])),
              memoryCategoryStore(),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              Layer.mock(DataExport, {}),
              // The review queue's proposals for the lines to review: no merchant known.
              Layer.mock(Merchants, {
                ofLine: () => Effect.succeed({ merchant: null, intermediary: null, asks: false }),
              }),
              Layer.mock(Transfers, {}),
              Layer.mock(Expenses, {}),
              Layer.mock(UserData, {}),
              Layer.mock(RuleJobs, {}),
              Layer.succeed(Subscriptions, {
                charges: (_owner, range) =>
                  Effect.sync(() => {
                    asked.push(range);

                    return charges.filter((each) => each.day >= range.from && each.day <= range.to);
                  }),
              }),
              Layer.succeed(MonthFacts, {
                read: (_owner, scope) =>
                  Effect.succeed({
                    ...rows,
                    charges:
                      scope.charges === null
                        ? []
                        : rows.charges.filter(
                            (each) =>
                              scope.charges !== null &&
                              each.day >= scope.charges.from &&
                              each.day <= scope.charges.to,
                          ),
                  }),
              }),
              Layer.succeed(Today, { day: Effect.succeed(TODAY) }),
            ),
          ),
        ),
    },
    reader,
    "2025-11-25",
  );
}

async function month(args: { [key: string]: string }, given: Connection = {}) {
  return callText(await connect(given), "month", args);
}

describe("month subscriptions", () => {
  test("gives the month's recurring payments, those that stopped and the prices that rose, by name", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "2026-11" });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Subscriptions of 2026-11, detected from the user's expenses up to 2026-11-24.",
    );
    expect(text).toContain(
      "- Streamly: monthly, usually 9.49 EUR; last paid 2026-11-08, 10.99 EUR; next expected 2026-12-08.",
    );
    expect(text).toContain(
      "- Fitclub: monthly, expected 2026-11-03, did not come; last paid 2026-10-03, 29.00 EUR.",
    );
    expect(text).toContain("Price rises (1):\n- Streamly: from 9.49 EUR to 10.99 EUR.");
    expect(text).not.toContain("Wavely Mobile");
    expect(text).not.toContain("merchant-");
    expect(text).not.toContain("00000000-");
    expect(text).toContain(
      'merchants {"action":"edit","merchant":"Streamly","subscription":false}; subscription true proposes it again.',
    );
  });

  test("reads the current month when none is given, from the three years of charges up to today", async () => {
    const asked: Array<Range> = [];
    const { text, isError } = await month({ action: "subscriptions" }, { asked });

    expect(isError, text).toBe(false);
    expect(text).toContain("Subscriptions of 2026-11");
    expect(asked).toEqual([{ from: "2023-11-24", to: TODAY }]);
  });

  test("reads a month gone by as it stood on its last day", async () => {
    const asked: Array<Range> = [];
    const { text, isError } = await month({ action: "subscriptions", month: "2026-10" }, { asked });

    expect(isError, text).toBe(false);
    expect(text).toContain("up to 2026-10-31.");
    expect(text).toContain(
      "- Streamly: monthly, usually 9.49 EUR; last paid 2026-10-08, 9.49 EUR; next expected 2026-11-08.",
    );
    expect(text).toContain("- Fitclub: monthly, usually 29.00 EUR");
    expect(text).not.toContain("Price rises");
    expect(text).not.toContain("Stopped");
    expect(asked).toEqual([{ from: "2023-10-31", to: "2026-10-31" }]);
  });

  test("says when nothing recurs", async () => {
    const { text, isError } = await month({ action: "subscriptions" }, { charges: [] });

    expect(isError, text).toBe(false);
    expect(text).toContain("No recurring payment detected.");
  });

  test("refuses a month to come, with a valid call", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "2026-12" });

    expect(isError).toBe(true);
    expect(text).toContain("2026-12 is a month to come");
    expect(text).toContain('A valid call: month {"action":"subscriptions","month":"2026-11"}');
    expect(text.length).toBeLessThan(ERROR_LIMIT);

    const answered = await month({ action: "subscriptions", month: "2026-11" });

    expect(answered.isError).toBe(false);
  });

  test("refuses a month not written YYYY-MM, with a valid call", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "November" });

    expect(isError).toBe(true);
    expect(text).toContain("The arguments of month are not valid");
    expect(text).toContain('A valid call: month {"action":"subscriptions"}');
  });
});

function account(rows: Month, name: string, kind: MonthAccount["kind"]): MonthAccount {
  const opened: MonthAccount = {
    id: memoryId(),
    name,
    institution: null,
    kind,
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    creditOrder: "oldest_first",
  };

  rows.accounts.push(opened);

  return opened;
}

function category(rows: Month, kind: "expense" | "income", name: string, change = {}) {
  const created = memoryCategory(kind, name, { position: rows.categories.length, ...change });

  rows.categories.push(created);

  return created;
}

function merchant(rows: Month, name: string, intermediary = false) {
  const known = { id: memoryId(), name, intermediary };

  rows.merchants.push(known);
  rows.aliases.push({ alias: merchantKey(name.toUpperCase(), null) ?? name, merchantId: known.id });

  return known;
}

function spend(
  rows: Month,
  where: { category: CategoryRecord; account: MonthAccount },
  day: string,
  minor: number,
  label = "CARD PAYMENT",
  kind: "expense" | "income" = "expense",
) {
  rows.parts.push({
    entryId: memoryId(),
    kind,
    happenedOn: day,
    categoryId: where.category.id,
    entryMerchantId: null,
    role: "payment",
    amountMinor: minor,
    lineId: memoryId(),
    label,
    counterpartyName: null,
    accountId: where.account.id,
  });
}

/**
 * Ada's months: a salary, groceries at Greenmarket and a bakery under them, a purchase through
 * PayPal, a transfer to her savings; September for the month before, her data from April on.
 */
function ada() {
  const rows = empty();
  const current = account(rows, "Current account", "current");
  const savings = account(rows, "Savings book", "savings");
  const salary = category(rows, "income", "Salary");
  const groceries = category(rows, "expense", "Groceries");
  const bakery = category(rows, "expense", "Bakery", { parentId: groceries.id });

  const leisure = category(rows, "expense", "Leisure", {
    benchmark: { mode: "fixed", minor: 5000 },
  });

  category(rows, "expense", "Travel");
  merchant(rows, "Greenmarket");
  merchant(rows, "PayPal", true);

  rows.firstDay = "2026-04-02";
  spend(
    rows,
    { category: salary, account: current },
    "2026-10-01",
    250_000,
    "ACME PAYROLL",
    "income",
  );
  spend(rows, { category: groceries, account: current }, "2026-09-12", 20_000, "GREENMARKET");
  spend(rows, { category: groceries, account: current }, "2026-10-03", 24_000, "GREENMARKET");
  spend(rows, { category: bakery, account: current }, "2026-10-04", 1500, "CARD 0410 CRUSTY");
  spend(rows, { category: leisure, account: current }, "2026-10-06", 9000, "PAYPAL");

  rows.transfers.push({
    outAccountId: current.id,
    outBookedOn: "2026-10-05",
    outMinor: -50_000,
    inAccountId: savings.id,
    inBookedOn: "2026-10-05",
    inMinor: 50_000,
  });

  rows.reach.push(
    { accountId: current.id, importedTo: "2026-10-31", statementTo: null },
    { accountId: savings.id, importedTo: null, statementTo: "2026-10-15" },
  );

  return { rows, current, groceries };
}

/** The line to review of Ada's, as the review queue finds it. */
function toReview(current: MonthAccount): MemoryLineRows {
  const record: AccountRecord = {
    ...current,
    envelope: null,
    settlesIntoAccountId: null,
    balanceCategoryId: null,
    topUpDays: 3,
    topUpCapMinor: null,
  };

  return {
    accounts: [record],
    lines: [
      {
        id: memoryId(),
        accountId: current.id,
        bookedOn: "2026-10-04",
        valueOn: null,
        amountMinor: -1500,
        label: "CARD 0410 CRUSTY",
        memo: null,
        counterpartyName: null,
        classifiedBy: "default",
        category: { id: "other", name: "Other", parentName: null, kind: "expense" },
      },
    ],
  };
}

describe("month summary", () => {
  test("reads the user's own month: received, spent, set aside, left, movements, lines to review, imports, flags", async () => {
    const { rows, current } = ada();

    const { text, isError } = await month(
      { action: "summary", month: "2026-10" },
      { month: rows, lines: toReview(current) },
    );

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "The month 2026-10, in EUR, read on 2026-11-24: averages over 6 month(s) of 2026-04 to 2026-09; the previous month is 2026-09.",
    );
    expect(text).toContain("Received 2,500.00 EUR, from Salary 2,500.00 EUR.");
    expect(text).toContain("Spent 345.00 EUR; average 33.33 EUR; previous month 200.00 EUR.");
    expect(text).toContain("Set aside 500.00 EUR (net, onto savings and investment accounts).");
    expect(text).toContain("Left 1,655.00 EUR.");
    expect(text).toContain(
      "- 2026-10-01, income: ACME PAYROLL → Current account, 2,500.00 EUR (Salary)",
    );
    expect(text).toContain("- 2026-10-05, transfer: Current account → Savings book, 500.00 EUR");
    expect(text).toContain("Lines to review: 1 booked in the month; the newest:");
    expect(text).toContain(
      '- 2026-10-04, Current account: "CARD 0410 CRUSTY", -15.00 EUR, in Other',
    );
    expect(text).toContain(
      'List them with their proposals, to accept or correct each: review {"action":"list"} (every month\'s, newest first).',
    );
    expect(text).toContain("Imported: 1 of 2 account(s) have statements reaching 2026-10-31.");
    expect(text).toContain("- Savings book: reaches 2026-10-15.");
    expect(text).toContain(
      "Flagged (3):\n- Groceries drifts above its benchmark: spent 255.00 EUR, benchmark 33.33 EUR.\n- Leisure drifts above its benchmark: spent 90.00 EUR, benchmark 50.00 EUR.",
    );
    expect(text).toContain("- Savings book: its statements reach 2026-10-15 only.");
    expect(text).not.toMatch(/[\da-f]{8}-[\da-f]{4}-/);
    expect(text.length).toBeLessThan(RESULT_LIMIT);
  });

  test("a line coming back that may be a refund is not received: counted apart, and flagged among the movements", async () => {
    const { rows, current } = ada();
    const other = category(rows, "income", "Other");
    const back = memoryId();

    rows.parts.push({
      entryId: memoryId(),
      kind: "income",
      happenedOn: "2026-10-04",
      categoryId: other.id,
      entryMerchantId: null,
      role: "payment",
      amountMinor: 3000,
      lineId: back,
      label: "CARD PIXELPLAY STORE",
      counterpartyName: null,
      accountId: current.id,
    });
    rows.maybeRefunds.push(back);

    const { text, isError } = await month({ action: "summary", month: "2026-10" }, { month: rows });

    expect(isError, text).toBe(false);
    expect(text).toContain("Received 2,500.00 EUR, from Salary 2,500.00 EUR.");
    expect(text).toContain(
      "Not in received: 1 line(s) coming back that may be refunds, 30.00 EUR in all, waiting for the user's answer (each among the movements below). Show one with lines, then link it as a refund or refuse_refund.",
    );
    expect(text).toContain("Left 1,655.00 EUR.");
    expect(text).toContain(
      "Incomes and transfers in, and lines that may be refunds (3, oldest first):",
    );
    expect(text).toContain(
      `- 2026-10-04, maybe a refund, not counted as income until the user answers: CARD PIXELPLAY STORE → Current account, 30.00 EUR; lines {"action":"show","line":"${back}"}`,
    );
    expect(text).not.toContain("income: CARD PIXELPLAY STORE");
  });

  test("without a maybe refund, the summary says nothing of them", async () => {
    const { rows } = ada();
    const { text } = await month({ action: "summary", month: "2026-10" }, { month: rows });

    expect(text).toContain("Incomes and transfers in (2, oldest first):");
    expect(text).not.toContain("may be refunds");
    expect(text).not.toContain("maybe a refund");
  });

  test("a user with nothing yet reads an empty month", async () => {
    const { text, isError } = await month({ action: "summary" });

    expect(isError, text).toBe(false);
    expect(text).toContain("The month 2026-11, in EUR");
    expect(text).toContain("no average yet");
    expect(text).toContain("Received 0.00 EUR.");
    expect(text).toContain("No line of the month waits to be reviewed.");
    expect(text).toContain("Nothing flagged.");
  });
});

describe("month spending", () => {
  test("by category: against the average and the month before, with benchmarks, children indented", async () => {
    const { rows } = ada();

    const { text, isError } = await month(
      { action: "spending", month: "2026-10" },
      { month: rows },
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("Where the money went in 2026-10, by category, in EUR");
    expect(text).toContain(
      "\n- Groceries: spent 255.00 EUR; average 33.33 EUR; previous month 200.00 EUR; benchmark 33.33 EUR (automatic); DRIFTS, 221.67 EUR above\n  - Bakery: spent 15.00 EUR; average 0.00 EUR; previous month 0.00 EUR; benchmark: none yet",
    );
    expect(text).toContain(
      "\n- Leisure: spent 90.00 EUR; average 0.00 EUR; previous month 0.00 EUR; benchmark 50.00 EUR (set); DRIFTS, 40.00 EUR above",
    );
    // Nothing spent in Travel, ever: left out.
    expect(text).not.toContain("Travel");
    expect(text).toContain("1 category with nothing spent in these months left out.");
    expect(text).toContain(
      'month {"action":"days","by":"category","name":"Groceries","month":"2026-10"}',
    );
  });

  test("by merchant: who was paid, an intermediary said so, the expenses naming none last", async () => {
    const { rows } = ada();

    const { text, isError } = await month(
      { action: "spending", by: "merchant", month: "2026-10" },
      { month: rows },
    );

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Merchants, the largest first:\n- Greenmarket: spent 240.00 EUR; average 33.33 EUR; previous month 200.00 EUR\n- PayPal (a payment intermediary: who was paid behind it is not known): spent 90.00 EUR",
    );
    expect(text).toContain(
      "- no merchant: spent 15.00 EUR; average 0.00 EUR; previous month 0.00 EUR (expenses naming several merchants, or none)",
    );
  });

  test("a long list of merchants is cut, saying what the rest holds and how to read it", async () => {
    const { rows, current, groceries } = ada();

    for (let index = 0; index < 110; index += 1) {
      const stall = merchant(rows, `Stall ${String(index).padStart(3, "0")}`);

      // The expense's own merchant: no cleaned label needed.
      rows.parts.push({
        entryId: memoryId(),
        kind: "expense",
        happenedOn: "2026-10-20",
        categoryId: groceries.id,
        entryMerchantId: stall.id,
        role: "payment",
        amountMinor: 100 + index,
        lineId: memoryId(),
        label: "MARKET STALL",
        counterpartyName: null,
        accountId: current.id,
      });
    }

    const { text } = await month(
      { action: "spending", by: "merchant", month: "2026-10" },
      { month: rows },
    );

    expect(text).toContain("And 12 more merchants,");
    expect(text).toContain(
      'read their lines with lines {"action":"search","from":"2026-10-01","to":"2026-10-31"}.',
    );
    expect(text.length).toBeLessThan(RESULT_LIMIT);
  });
});

describe("month days", () => {
  test("follows a row day by day, named as spending names it, in any case", async () => {
    const { rows } = ada();

    const { text, isError } = await month(
      { action: "days", month: "2026-10", name: "groceries>bakery" },
      { month: rows },
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("Groceries > Bakery (category) in 2026-10, in EUR");
    expect(text).toContain("2026-10-03: 0.00 EUR; previous month 0.00 EUR");
    expect(text).toContain("2026-10-04: 15.00 EUR; previous month 0.00 EUR");
    expect(text).toContain("2026-10-31: 15.00 EUR");
  });

  test("days to come are said so, in the month under way", async () => {
    const { rows, current, groceries } = ada();

    spend(rows, { category: groceries, account: current }, "2026-11-02", 3000, "GREENMARKET");

    const { text } = await month(
      { action: "days", by: "merchant", name: "Greenmarket" },
      { month: rows },
    );

    expect(text).toContain("Greenmarket (merchant) in 2026-11");
    expect(text).toContain("2026-11-02: 30.00 EUR; previous month 0.00 EUR");
    expect(text).toContain("2026-11-03: 30.00 EUR; previous month 240.00 EUR");
    expect(text).toContain("From 2026-11-25 on: days to come.");
  });

  test("an unknown row is refused, naming the month's rows, with a valid call", async () => {
    const { rows } = ada();

    const { text, isError } = await month(
      { action: "days", month: "2026-10", name: "Gardening" },
      { month: rows },
    );

    expect(isError).toBe(true);
    expect(text).toContain('No row of 2026-10 by category is named "Gardening".');
    expect(text).toContain("Groceries > Bakery");
    expect(text).toContain(
      'A valid call: month {"action":"days","by":"category","name":"Groceries","month":"2026-10"}',
    );
    expect(text.length).toBeLessThan(ERROR_LIMIT);

    const unnamed = await month({ action: "days" }, { month: rows });

    expect(unnamed.isError).toBe(true);
    expect(unnamed.text).toContain("days needs name");
  });
});

describe("month", () => {
  test.each(["summary", "spending", "days"])(
    "%s refuses a month to come, with a valid call",
    async (action) => {
      const { text, isError } = await month({ action, month: "2027-01", name: "Groceries" });

      expect(isError).toBe(true);
      expect(text).toContain("2027-01 is a month to come");
      expect(text).toContain(`A valid call: month {"action":"${action}","month":"2026-11"`);
    },
  );

  test("an unknown action is refused with a valid call", async () => {
    const { text, isError } = await month({ action: "review" });

    expect(isError).toBe(true);
    expect(text).toContain('month {"action":"subscriptions"}');
  });

  test("reads only, says so, and comes first in the fixed order", async () => {
    const { tools } = await (await connect()).listTools();
    const [first] = tools;

    expect(first?.name).toBe("month");
    expect(first?.title).toBe(
      "Monthly review (summary, spending, days, subscriptions, benchmarks)",
    );
    // benchmarks reads a month to come (#33): the description claims the refusal only for the others.
    expect(first?.description).toContain(
      "summary, spending, days and subscriptions refuse a month to come",
    );
    expect(first?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
