import {
  DataExport,
  Expenses,
  FundRefused,
  ImportProfiles,
  Imports,
  LinkRefused,
  Merchants,
  MonthFacts,
  NotLinked,
  RuleJobs,
  Subscriptions,
  TransferRefused,
  Transfers,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type {
  AccountRecord,
  CategoryRecord,
  Expense,
  FundedExpense,
  LineTransfer,
  MemoryCategoryRows,
  MemoryLineDetail,
  MemoryLineRows,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Runner } from "../tool";

// The lines tool through the official client, on in-memory stores of made-up lines, as a token
// allowed to read only.

const TODAY = "2026-11-23";
const reader = { userId: "ada", canWrite: false, currency: "EUR" };
const writer = { userId: "ada", canWrite: true, currency: "EUR" };

const transport = memoryCategory("expense", "Transport");
const fuelCategory = memoryCategory("expense", "Fuel", { parentId: transport.id });
const otherExpense = memoryCategory("expense", "Other", { position: 1, fallback: true });

const family = memoryCategory("expense", "Family", {
  position: 2,
  archivedAt: "2026-11-01T10:00:00.000Z",
});

const otherIncome = memoryCategory("income", "Other", { fallback: true });

const lineCategory = (category: CategoryRecord) => ({
  id: category.id,
  name: category.name,
  parentName: null,
  kind: category.kind,
});

function account(name: string, change: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: memoryId(),
    name,
    kind: "current",
    envelope: null,
    institution: "Riverside Bank",
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    settlesIntoAccountId: null,
    creditOrder: "oldest_first",
    balanceCategoryId: null,
    topUpDays: 3,
    topUpCapMinor: null,
    ...change,
  };
}

function line(
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  label: string,
  change: Partial<MemoryLineDetail> = {},
): MemoryLineDetail {
  return {
    id: memoryId(),
    accountId,
    bookedOn,
    valueOn: null,
    amountMinor,
    label,
    memo: null,
    counterpartyName: null,
    ...change,
  };
}

const current = account("Current account");
const livret = account("Livret A", { kind: "savings", envelope: "livret_a" });
const otherLivret = account("Livret A", { kind: "savings", institution: "Northbank" });
const brokerage = account("US brokerage", { currency: "USD", institution: "Harbor Securities" });

const OCTOBER = {
  id: memoryId(),
  accountId: current.id,
  status: "done",
  periodTo: "2026-10-31",
  fileName: "october-statement.xml",
  format: "camt053",
  importedAt: "2026-11-02T08:30:00.000Z",
  periodFrom: "2026-10-01",
} as const;

const salary = line(current.id, "2026-10-01", 250_000, "SALARY EXAMPLE CORP", {
  importId: OCTOBER.id,
  counterpartyName: "Example Corp",
  category: lineCategory(otherIncome),
});

const fuel = line(current.id, "2026-10-12", -4290, "CB FUELSTOP 0412 RIVERTON", {
  importId: OCTOBER.id,
  valueOn: "2026-10-13",
  memo: "Pump 4",
  category: lineCategory(otherExpense),
});

const cafe = line(current.id, "2026-11-03", -2380, "CB CORNER CAFE", {
  originalAmountMinor: -2600,
  originalCurrency: "USD",
});

const heldCafe = line(current.id, "2026-11-04", -2380, "CB CORNER CAFE", {
  state: "held",
  duplicateOfLineId: cafe.id,
});

const interest = line(livret.id, "2026-10-31", 1520, "INTERESTS 2026");
const deposit = line(brokerage.id, "2026-10-05", 100_000, "DEPOSIT");
const future = line(current.id, "2026-12-01", -1000, "CB CORNER CAFE");

const ROWS: MemoryLineRows = {
  accounts: [current, livret, otherLivret, brokerage],
  lines: [salary, fuel, cafe, heldCafe, interest, deposit, future],
  imports: [OCTOBER],
};

/** A line's one entry, in `category`, as an import leaves it. */
const entry = (of: MemoryLineDetail, category: CategoryRecord) => ({
  id: memoryId(),
  kind: category.kind,
  happenedOn: of.bookedOn,
  categoryId: category.id,
  classifiedBy: "default" as const,
  parts: [
    {
      lineId: of.id,
      role: "payment" as const,
      amountMinor: Math.abs(of.amountMinor),
      currency: "EUR",
    },
  ],
});

/** The entries of the lines above, each in its kind's fallback. */
function categoryRows(): MemoryCategoryRows {
  return {
    categories: [transport, fuelCategory, otherExpense, family, otherIncome],
    entries: [entry(fuel, otherExpense), entry(salary, otherIncome)],
    lines: [fuel, salary, heldCafe].map((each) => ({ id: each.id, amountMinor: each.amountMinor })),
  };
}

/** No line of these is a transfer; transfers are tried end to end (#26, lines-transfers.spec). */
const NO_TRANSFER = Layer.mock(Transfers, {
  ofLine: () => Effect.succeed({ paired: null, candidates: [] }),
});

// A line paid through an intermediary (#30), apart from `ROWS` so that their searches stay as they
// are; who was paid behind it is tried end to end (intermediaries-mcp.spec).
const paypal = line(current.id, "2026-11-05", -1999, "CB PAYPAL *PIXELPLAY 05/11");
const PAYPAL = { id: memoryId(), name: "PayPal" };

const WITH_PAYPAL: MemoryLineRows = {
  ...ROWS,
  lines: [salary, fuel, cafe, heldCafe, interest, deposit, future, paypal],
};

/** Every line pays no one known but `paypal`, whose merchant is asked of the user. */
const PAID = Layer.mock(Merchants, {
  ofLine: (_owner, lineId) =>
    Effect.succeed(
      lineId === paypal.id
        ? { merchant: null, intermediary: PAYPAL, asks: true }
        : { merchant: null, intermediary: null, asks: false },
    ),
});

/**
 * No line of these is part of an expense of several lines; those are tried end to end (#27,
 * expenses-mcp.spec).
 */
const NO_EXPENSE = Layer.mock(Expenses, {
  ofLine: () => Effect.succeed({ expenses: [], role: null, proposals: [], funding: null }),
});

function onToday(
  rows: MemoryLineRows,
  categories: Map<string, MemoryCategoryRows> = new Map(),
  transfers = NO_TRANSFER,
  expenses = NO_EXPENSE,
): Runner<GoussetServices> {
  const byOwner = new Map([[reader.userId, rows]]);

  const layer = Layer.mergeAll(
    memoryAccountStore(byOwner),
    memoryLineStore(byOwner),
    memoryCategoryStore(categories),
    // lines never reaches the imports.
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    PAID,
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Subscriptions, {}),
    Layer.mock(MonthFacts, {}),
    transfers,
    expenses,
    TestClock.layer(),
  );

  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

        return yield* effect;
      }).pipe(Effect.provide(layer)),
    );
}

type Arguments = { readonly [key: string]: string | number | boolean };

async function lines(
  args: Arguments,
  rows: MemoryLineRows = ROWS,
  caller = reader,
  categories: Map<string, MemoryCategoryRows> = new Map([[reader.userId, categoryRows()]]),
) {
  const client = await connectInProcess(
    goussetServer,
    { run: onToday(rows, categories) },
    caller,
    "2025-11-25",
  );

  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const Written = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);

/** The arguments of a call a result writes after `before` (`lines {…}`), read back. */
function writtenCall(text: string, before: string): Arguments | undefined {
  const at = text.indexOf(`${before}lines {`);

  if (at === -1) {
    return undefined;
  }

  const json = text.slice(at + before.length + "lines ".length).split("\n")[0] ?? "";

  return Schema.decodeUnknownSync(Written)(JSON.parse(json));
}

/** The handles a search result gives, in order. */
const handlesOf = (text: string) => [...text.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id);

/** A refusal: under the error limit, with a valid call that answers. */
async function expectValidExample(text: string, rows: MemoryLineRows = ROWS) {
  expect(text.length).toBeLessThan(ERROR_LIMIT);

  const example = writtenCall(text, "A valid call: ");

  expect(example, text).toBeDefined();

  const answered = await lines(example ?? {}, rows);

  expect(answered.isError, answered.text).toBe(false);
}

describe("lines search", () => {
  test("gives every counted line newest first, with its account, amount, label and handle", async () => {
    const { text, isError } = await lines({ action: "search" });

    expect(isError).toBe(false);
    expect(text).toContain(
      "5 line(s) match: every line counted (add to_review: true for the lines to review).",
    );
    expect(text).toContain(
      `- 2026-11-03, Current account (Riverside Bank): -23.80 EUR, "CB CORNER CAFE"; line: ${cafe.id}`,
    );
    expect(text).toContain(
      `- 2026-10-05, US brokerage (Harbor Securities): 1,000.00 USD, "DEPOSIT"; line: ${deposit.id}`,
    );
    // Each line's category, as a person names it.
    expect(text).toContain(`"CB FUELSTOP 0412 RIVERTON", in Other; line: ${fuel.id}`);
    expect(handlesOf(text)).toEqual([cafe.id, interest.id, fuel.id, deposit.id, salary.id]);
    // Held and future lines are not counted ones; accounts are named, never by id.
    expect(text).not.toContain(heldCafe.id);
    expect(text).not.toContain(future.id);
    expect(text).not.toContain(current.id);
    expect(text).not.toContain("More lines remain");
  });

  test("finds by text and account, and says the filters it understood", async () => {
    const { text, isError } = await lines({
      action: "search",
      text: "fuelstop",
      account: "current account",
      from: "2026-10-01",
      to: "2026-10-31",
    });

    expect(isError).toBe(false);
    expect(text).toContain(
      '1 line(s) match: lines counted (add to_review: true for the lines to review), containing "fuelstop", in Current account (Riverside Bank), booked from 2026-10-01, booked until 2026-10-31.',
    );
    expect(handlesOf(text)).toEqual([fuel.id]);
  });

  test("finds by the counterparty's name too", async () => {
    const { text } = await lines({ action: "search", text: "example corp" });

    expect(handlesOf(text)).toEqual([salary.id]);
  });

  test("names each line's subjects, by name, and nothing for a line of none", async () => {
    const forVan = line(current.id, "2026-10-20", -5200, "CB FUELSTOP 2010 RIVERTON", {
      subjects: [
        { id: memoryId(), name: "Van" },
        { id: memoryId(), name: "Alps 2026" },
      ],
    });

    const { text, isError } = await lines(
      { action: "search", text: "fuelstop" },
      { ...ROWS, lines: [salary, fuel, cafe, heldCafe, interest, deposit, future, forVan] },
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("(booked on, account: amount, label, category, subjects if any;");
    expect(text).toContain(
      `"CB FUELSTOP 2010 RIVERTON"; subjects: Van, Alps 2026; line: ${forVan.id}`,
    );
    expect(text).toContain(`"CB FUELSTOP 0412 RIVERTON", in Other; line: ${fuel.id}`);
  });

  test("compares amounts with the absolute amount in each account's currency", async () => {
    const { text, isError } = await lines({
      action: "search",
      amount_min: "40",
      amount_max: "45.50",
    });

    expect(isError).toBe(false);
    expect(text).toContain("an absolute amount between 40 and 45.50 in the account's currency");
    expect(handlesOf(text)).toEqual([fuel.id]);
  });

  test("lists the lines to review when asked, marked so", async () => {
    const { text, isError } = await lines({ action: "search", to_review: true });

    expect(isError).toBe(false);
    expect(text).toContain(
      "1 line(s) match: every line to review (near duplicates held, transfers whose other side the user chooses, and counted lines still classified by default: not classified yet).",
    );
    expect(text).toContain(
      `- 2026-11-04, Current account (Riverside Bank): -23.80 EUR, "CB CORNER CAFE", to review; line: ${heldCafe.id}`,
    );
  });

  test("says when nothing matches", async () => {
    const { text, isError } = await lines({ action: "search", text: "no such shop" });

    expect(isError).toBe(false);
    expect(text).toContain("0 line(s) match");
    expect(text).toContain("No line on this page.");
  });

  test("reads every page with the next call it writes, never a line twice", async () => {
    const busy = account("Busy account");

    const many = Array.from({ length: 23 }, (_, index) =>
      line(
        busy.id,
        `2026-${String(1 + (index % 10)).padStart(2, "0")}-15`,
        -(index + 1) * 100,
        "CB GREENMARKET",
      ),
    );

    const rows = { accounts: [busy], lines: many };
    const seen: Array<string | undefined> = [];
    let next: Arguments | undefined = { action: "search", text: "greenmarket", limit: 10 };
    let pages = 0;

    while (next !== undefined) {
      const { text, isError } = await lines(next, rows);

      expect(isError, text).toBe(false);
      expect(text).toContain("23 line(s) match");

      seen.push(...handlesOf(text));
      next = writtenCall(text, "More lines remain. Read them with: ");
      pages += 1;

      if (next !== undefined) {
        expect(next).toMatchObject({ action: "search", text: "greenmarket", limit: 10 });
      }
    }

    expect(pages).toBe(3);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
  });

  test(`stays under ${RESULT_LIMIT} characters, in one part, at the most lines with long labels`, async () => {
    const busy = account("Joint current account", { institution: "Riverside Cooperative Bank" });

    // A long card label as banks write them, and six-figure amounts.
    const many = Array.from({ length: 150 }, (_, index) =>
      line(
        busy.id,
        `2026-${String(1 + (index % 10)).padStart(2, "0")}-15`,
        -(index + 1) * 100_000,
        "CB GREENMARKET 2110 RIVERTON SUPERSTORE 15/10 CARD 4412 XXXX",
      ),
    );

    const { text, isError } = await lines(
      { action: "search", limit: 100 },
      { accounts: [busy], lines: many },
    );

    expect(isError).toBe(false);
    expect(text.length).toBeLessThan(RESULT_LIMIT);
    expect(text).not.toContain("Part 1 of");
    expect(handlesOf(text)).toHaveLength(100);
    expect(text).toContain("More lines remain. Read them with:");
  });

  test("refuses more lines than it gives, with a valid call", async () => {
    const { text, isError } = await lines({ action: "search", limit: 500 });

    expect(isError).toBe(true);
    await expectValidExample(text);
  });
});

describe("lines search refusals", () => {
  test("an unknown account: the user's accounts, and a call that answers", async () => {
    const { text, isError } = await lines({ action: "search", account: "Joint account" });

    expect(isError).toBe(true);
    expect(text).toContain('No account of the user\'s is named "Joint account".');
    expect(text).toContain("Current account (Riverside Bank), Livret A (Riverside Bank)");
    await expectValidExample(text);
  });

  test("a name two accounts share, until the institution tells them apart", async () => {
    const { text, isError } = await lines({ action: "search", account: "Livret A" });

    expect(isError).toBe(true);
    expect(text).toContain("Livret A (Riverside Bank), Livret A (Northbank). Add institution");
    await expectValidExample(text);

    const apart = await lines({
      action: "search",
      account: "livret a",
      institution: "riverside bank",
    });

    expect(apart.isError).toBe(false);
    expect(handlesOf(apart.text)).toEqual([interest.id]);
  });

  test("an institution without an account", async () => {
    const { text, isError } = await lines({ action: "search", institution: "Northbank" });

    expect(isError).toBe(true);
    expect(text).toContain("give account too");
    await expectValidExample(text);
  });

  test.each([
    ["an amount that is no decimal", { amount_min: "forty" }, "amount_min and amount_max"],
    ["a minimum above the maximum", { amount_min: "50", amount_max: "40" }, "at most the maximum"],
    ["a day that is no day", { from: "2026-13-01" }, "YYYY-MM-DD"],
    [
      "a period that ends before it starts",
      { from: "2026-11-01", to: "2026-10-01" },
      "on or before",
    ],
    ["a made-up cursor", { text: "cafe", after: "page-2" }, "after is a handle"],
  ])("%s", async (_, wrong, said) => {
    const { text, isError } = await lines({ action: "search", ...wrong });

    expect(isError).toBe(true);
    expect(text).toContain(said);
    await expectValidExample(text);
  });

  test("a made-up cursor's example keeps the search's other arguments", async () => {
    const { text } = await lines({ action: "search", text: "cafe", after: "page-2" });

    expect(writtenCall(text, "A valid call: ")).toEqual({ action: "search", text: "cafe" });
  });
});

describe("lines show", () => {
  test("gives an imported line with its days, memo and the import it came from", async () => {
    const { text, isError } = await lines({ action: "show", line: fuel.id });

    expect(isError).toBe(false);
    expect(text).toBe(
      [
        "Line of Current account (Riverside Bank), booked on 2026-10-12, value on 2026-10-13.",
        "Amount: -42.90 EUR.",
        'Label: "CB FUELSTOP 0412 RIVERTON"',
        "Memo: Pump 4",
        "Category: Other (expense)",
        'Imported from "october-statement.xml" (CAMT.053) on 2026-11-02, covering 2026-10-01 to 2026-10-31.',
      ].join("\n"),
    );
  });

  test("gives the counterparty, the original amount and how a line was made", async () => {
    const paid = await lines({ action: "show", line: salary.id });

    expect(paid.text).toContain("Counterparty: Example Corp");

    const { text } = await lines({ action: "show", line: cafe.id });

    expect(text).toContain("Amount: -23.80 EUR (originally -26.00 USD).");
    expect(text).toContain("Entered by hand.");
  });

  test("gives a held line, and the line it looks like with its handle", async () => {
    const { text, isError } = await lines({ action: "show", line: heldCafe.id });

    expect(isError).toBe(false);
    expect(text).toContain(
      `To review: held as a near duplicate of the line of 2026-11-03, -23.80 EUR, "CB CORNER CAFE" (line: ${cafe.id}); not counted until the user decides.`,
    );
  });

  test("gives a benefit account's expiry", async () => {
    const meal = account("MealCard", { kind: "benefit", institution: "MealCard" });

    const credit = line(meal.id, "2026-11-02", 18_000, "MEALCARD CREDIT", {
      expiresOn: "2027-12-31",
    });

    const { text } = await lines(
      { action: "show", line: credit.id },
      { accounts: [meal], lines: [credit] },
    );

    expect(text).toContain("Expires on: 2027-12-31");
  });

  test("refuses a handle no search gave, and a line booked after today", async () => {
    for (const handle of ["not-a-line", future.id]) {
      const { text, isError } = await lines({ action: "show", line: handle });

      expect(isError).toBe(true);
      expect(text).toContain("Handles come from search");
      await expectValidExample(text);
    }
  });

  test("asks for the handle when show is called without one", async () => {
    const { text, isError } = await lines({ action: "show" });

    expect(isError).toBe(true);
    expect(text).toContain("show needs the line's handle");
    await expectValidExample(text);
  });

  test("an intermediary's line says through whom it was paid, and the call that sets who", async () => {
    const { text, isError } = await lines({ action: "show", line: paypal.id }, WITH_PAYPAL);

    expect(isError, text).toBe(false);
    expect(text).toContain("Paid through PayPal, a payment intermediary: who was paid is not set.");
    expect(text).toContain(
      `merchants {"action":"assign","line":"${paypal.id}","merchant":"<who was paid>"}`,
    );
  });
});

/** A classify call on rows of its own, and those rows after it. */
async function classify(line: string, category: string, caller = writer) {
  const categories = new Map([[writer.userId, categoryRows()]]);
  const answer = await lines({ action: "classify", line, category }, ROWS, caller, categories);

  return { ...answer, categories: categories.get(writer.userId) };
}

const entryOf = (rows: MemoryCategoryRows | undefined, of: MemoryLineDetail) =>
  rows?.entries.find((each) => each.parts.some((part) => part.lineId === of.id));

describe("lines classify", () => {
  test("puts a line in a category named by its path, as the user's choice, and proposes a rule", async () => {
    const { text, isError, categories } = await classify(fuel.id, "transport > fuel");

    expect(isError, text).toBe(false);
    expect(text).toBe(
      [
        'The line of 2026-10-12, -42.90 EUR, "CB FUELSTOP 0412 RIVERTON", is now in Transport > Fuel (expense). Kept as the user\'s choice: no rule changes it unasked.',
        'To classify lines like it this way from now on, propose this rule to the user: rules {"action":"create","conditions":[{"field":"label","operator":"contains","value":"FUELSTOP"}],"category":"Transport > Fuel","from_correction":true}',
      ].join("\n"),
    );
    expect(entryOf(categories, fuel)).toMatchObject({
      categoryId: fuelCategory.id,
      classifiedBy: "user",
    });
  });

  test("an intermediary's line proposes a rule on who was paid, never on the intermediary", async () => {
    const rows = categoryRows();

    rows.entries.push(entry(paypal, otherExpense));
    rows.lines.push({ id: paypal.id, amountMinor: paypal.amountMinor });

    const { text, isError } = await lines(
      { action: "classify", line: paypal.id, category: "Transport" },
      WITH_PAYPAL,
      writer,
      new Map([[writer.userId, rows]]),
    );

    expect(isError, text).toBe(false);
    expect(text).toContain(
      '"conditions":[{"field":"label","operator":"contains","value":"PAYPAL *PIXELPLAY"}]',
    );
  });

  test("reads a shared name in the line's own kind", async () => {
    const { text, isError, categories } = await classify(salary.id, "Other");

    expect(isError, text).toBe(false);
    expect(entryOf(categories, salary)?.categoryId).toBe(otherIncome.id);
  });

  test("a name alone is the top-level category of that name, the child's is its path", async () => {
    const rows = categoryRows();
    const travel = memoryCategory("expense", "Travel", { position: 3 });
    const leisure = memoryCategory("expense", "Leisure", { position: 4 });
    const leisureTravel = memoryCategory("expense", "Travel", { parentId: leisure.id });

    rows.categories.push(travel, leisure, leisureTravel);

    const categories = new Map([[writer.userId, rows]]);

    const top = await lines(
      { action: "classify", line: fuel.id, category: "Travel" },
      ROWS,
      writer,
      categories,
    );

    expect(top.isError, top.text).toBe(false);
    expect(top.text).toContain("is now in Travel (expense).");
    expect(entryOf(categories.get(writer.userId), fuel)?.categoryId).toBe(travel.id);

    const child = await lines(
      { action: "classify", line: fuel.id, category: "Leisure > Travel" },
      ROWS,
      writer,
      categories,
    );

    expect(child.text).toContain("is now in Leisure > Travel (expense).");
  });

  test("refuses an unknown or archived category, and a held line, saying what to do", async () => {
    const unknown = await classify(fuel.id, "Salary");

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('No expense category of the user\'s is named "Salary"');
    expect(unknown.text).toContain('A valid call: categories {"action":"list"}');

    const archived = await classify(fuel.id, "Family");

    expect(archived.isError).toBe(true);
    expect(archived.text).toContain('"Family" is archived');
    expect(archived.text.length).toBeLessThan(ERROR_LIMIT);
    expect(entryOf(archived.categories, fuel)?.categoryId).toBe(otherExpense.id);

    const held = await classify(heldCafe.id, "Transport");

    expect(held.isError).toBe(true);
    expect(held.text).toContain("no category to change: it is held for review");
    await expectValidExample(held.text);

    const gone = await classify("not-a-line", "Transport");

    expect(gone.isError).toBe(true);
    expect(gone.text).toContain("Handles come from search");
    await expectValidExample(gone.text);
  });

  test("refuses a read-only token, saying how to get write", async () => {
    const { text, isError, categories } = await classify(fuel.id, "Transport > Fuel", reader);

    expect(isError).toBe(true);
    expect(text).toContain("choose Read and write on Gousset's consent page");
    expect(entryOf(categories, fuel)?.categoryId).toBe(otherExpense.id);
  });

  test("classifies a line as an expense, in the category named of that kind", async () => {
    const categories = new Map([[writer.userId, categoryRows()]]);

    const { text, isError } = await lines(
      { action: "classify", line: fuel.id, kind: "expense", category: "Fuel" },
      ROWS,
      writer,
      categories,
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("is now in Transport > Fuel (expense).");
    expect(entryOf(categories.get(writer.userId), fuel)).toMatchObject({
      categoryId: fuelCategory.id,
      classifiedBy: "user",
    });
  });

  test("with a kind and no category, puts the line in that kind's fallback, as the user's choice", async () => {
    const categories = new Map([[writer.userId, categoryRows()]]);

    const { text, isError } = await lines(
      { action: "classify", line: salary.id, kind: "income" },
      ROWS,
      writer,
      categories,
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("is now in Other (income).");
    expect(entryOf(categories.get(writer.userId), salary)).toMatchObject({
      categoryId: otherIncome.id,
      classifiedBy: "user",
    });

    // Money in is no expense: the kind says what the line is, and must be its own.
    const wrong = await lines(
      { action: "classify", line: salary.id, kind: "expense" },
      ROWS,
      writer,
      categories,
    );

    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain(
      "This line is an income (money in), not an expense: give kind income",
    );
  });

  test("refuses a category for a transfer: it has none", async () => {
    const { text, isError } = await lines(
      { action: "classify", line: fuel.id, kind: "transfer", category: "Fuel" },
      ROWS,
      writer,
    );

    expect(isError).toBe(true);
    expect(text).toContain("it has no category");
  });

  test("asks for the line and the category", async () => {
    const { text, isError } = await lines({ action: "classify", line: fuel.id }, ROWS, writer);

    expect(isError).toBe(true);
    expect(text).toContain("classify needs the line's handle");
    await expectValidExample(text);
  });
});

const giftCard = account("Gift card", {
  kind: "benefit",
  mode: "balance",
  institution: "Northbank",
});

/** The movement Gousset made of a balance noted on the gift card: no label of its own. */
const movement = line(giftCard.id, "2026-10-31", -9000, "", {
  source: "balance",
  category: { id: memoryId(), name: "Meal vouchers", parentName: "Food", kind: "expense" },
});

const KEPT: MemoryLineRows = {
  ...ROWS,
  accounts: [current, livret, otherLivret, brokerage, giftCard],
  lines: [salary, fuel, movement],
};

/** The gift card's side of the fuel line, as Gousset makes it. */
const madeSide: LineTransfer = {
  paired: {
    direction: "out",
    other: {
      id: memoryId(),
      bookedOn: fuel.bookedOn,
      label: fuel.label,
      amount: { minor: 4290, currency: "EUR" },
      account: { id: giftCard.id, name: giftCard.name, institution: giftCard.institution },
      madeByApp: true,
    },
    setAside: false,
    pairedBy: "user",
  },
  candidates: [],
};

/** A pair call on `KEPT` as a writer, the transfers answering each pairing with an account. */
async function pairWithAccount(args: Arguments) {
  const pairings: Array<{ lineId: string; accountId: string }> = [];

  const transfers = Layer.mock(Transfers, {
    ofLine: () => Effect.succeed({ paired: null, candidates: [] }),
    pairWithAccount: (_owner, lineId, accountId) => {
      pairings.push({ lineId, accountId });

      return accountId === giftCard.id
        ? Effect.succeed(madeSide)
        : Effect.fail(new TransferRefused({ reason: "account_kept_by_lines", lineId }));
    },
  });

  const client = await connectInProcess(
    goussetServer,
    { run: onToday(KEPT, new Map(), transfers) },
    writer,
    "2025-11-25",
  );

  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return {
    text: first?.type === "text" ? first.text : "",
    isError: result.isError === true,
    pairings,
  };
}

describe("lines and the accounts kept by their balance", () => {
  test("search and show name a movement of a noted balance, which has no label", async () => {
    const found = await lines({ action: "search", account: "gift card" }, KEPT);

    expect(found.isError, found.text).toBe(false);
    expect(found.text).toContain(
      `- 2026-10-31, Gift card (Northbank): -90.00 EUR, (movement of the noted balance), in Food > Meal vouchers; line: ${movement.id}`,
    );

    const shown = await lines({ action: "show", line: movement.id }, KEPT);

    expect(shown.isError, shown.text).toBe(false);
    expect(shown.text).toContain("Label: (movement of the noted balance)");
    expect(shown.text).toContain("Made by Gousset from a balance the user noted.");
    expect(shown.text).not.toContain("(no label)");
  });

  test("pairs a line with an account kept by its balance, whose side Gousset makes", async () => {
    const { text, isError, pairings } = await pairWithAccount({
      action: "pair",
      line: fuel.id,
      account: "gift card",
      institution: "Northbank",
    });

    expect(isError, text).toBe(false);
    expect(pairings).toEqual([{ lineId: fuel.id, accountId: giftCard.id }]);
    expect(text).toContain("Paired as a transfer.");
    expect(text).toContain(
      "Transfer to Gift card (Northbank), paired by the user: never counted as spending.",
    );
    expect(text).toContain("made by Gousset as that account's statement does not show it");
    expect(text).toContain(
      "The movements of Gift card (Northbank)'s noted balances leave it out from now on.",
    );
    expect(text).not.toContain(giftCard.id);
  });

  test("refuses an account kept by its lines, saying to pair with its line", async () => {
    const { text, isError } = await pairWithAccount({
      action: "pair",
      line: fuel.id,
      account: "Livret A",
      institution: "Riverside Bank",
    });

    expect(isError).toBe(true);
    expect(text).toContain("That account is kept by its lines");
    expect(text.length).toBeLessThan(ERROR_LIMIT);
  });

  test("refuses an unknown account, other and account together, and account without a line", async () => {
    const unknown = await pairWithAccount({ action: "pair", line: fuel.id, account: "Joint card" });

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('No account of the user\'s is named "Joint card"');
    expect(unknown.text).toContain('A valid call: accounts {"action":"list"}');
    expect(unknown.pairings).toEqual([]);

    const wrong: ReadonlyArray<Arguments> = [
      { action: "pair", line: fuel.id, other: salary.id, account: "Gift card" },
      { action: "pair", account: "Gift card" },
    ];

    for (const args of wrong) {
      const refused = await pairWithAccount(args);

      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("account names the other side of one line's transfer");
      expect(refused.text).toContain('"account":"Gift card"}');
      expect(refused.pairings).toEqual([]);
    }
  });
});

// A works council refund (#29): PerksHub, a benefit account, refunds 80.00 of the fuel line's
// expense to the current account. What the database does is tried end to end
// (works-council-refunds.spec); here, what `lines` says and which of the logic's calls it makes.
const perksHub = account("PerksHub", { kind: "benefit", institution: "PerksHub" });
const perksOut = line(perksHub.id, "2026-10-20", -3000, "PERKSHUB REFUND 0042");

const PERKS: MemoryLineRows = {
  ...ROWS,
  accounts: [current, livret, otherLivret, brokerage, perksHub],
  lines: [salary, fuel, perksOut],
};

const fuelPart = {
  lineId: fuel.id,
  bookedOn: fuel.bookedOn,
  label: fuel.label,
  account: { id: current.id, name: current.name, institution: current.institution },
  amount: { minor: 4290, currency: "EUR" },
};

const fuelExpense: FundedExpense = {
  id: memoryId(),
  happenedOn: fuel.bookedOn,
  category: lineCategory(otherExpense),
  net: { minor: 4290, currency: "EUR" },
  line: fuelPart,
};

const fundedFuel: Expense = {
  id: fuelExpense.id,
  kind: "expense",
  happenedOn: fuel.bookedOn,
  category: lineCategory(otherExpense),
  classifiedBy: "default",
  payments: [fuelPart],
  refunds: [],
  net: { minor: 4290, currency: "EUR" },
  fundings: [
    {
      outLineId: perksOut.id,
      inLineId: memoryId(),
      bookedOn: perksOut.bookedOn,
      label: perksOut.label,
      amount: { minor: 3000, currency: "EUR" },
      account: { id: perksHub.id, name: perksHub.name, institution: perksHub.institution },
    },
  ],
  funded: { minor: 3000, currency: "EUR" },
  subjects: [],
};

/** A call on `PERKS` as a writer, the logic answering as a works council refund's side would. */
async function refundCall(args: Arguments, funded = false) {
  const calls: Array<string> = [];

  const expenses = Layer.mock(Expenses, {
    ofLine: (_owner, lineId) =>
      Effect.succeed({
        expenses: [],
        role: null,
        proposals: [],
        funding:
          lineId === perksOut.id
            ? { funds: funded ? fuelExpense : null, candidates: funded ? [] : [fuelExpense] }
            : null,
      }),
    link: (_owner, lineId) => Effect.fail(new LinkRefused({ reason: "transfer", lineId })),
    fund: (_owner, transferLineId, expenseLineId) => {
      calls.push(`fund ${transferLineId} ${expenseLineId}`);

      return expenseLineId === fuel.id
        ? Effect.succeed(fundedFuel)
        : Effect.fail(new FundRefused({ reason: "over_cost", lineId: expenseLineId }));
    },
    unlink: (_owner, lineId) => Effect.fail(new NotLinked({ lineId })),
    unfund: (_owner, transferLineId) => {
      calls.push(`unfund ${transferLineId}`);

      return Effect.succeed({ expenses: [], role: null, proposals: [], funding: null });
    },
  });

  const client = await connectInProcess(
    goussetServer,
    { run: onToday(PERKS, new Map(), NO_TRANSFER, expenses) },
    writer,
    "2025-11-25",
  );

  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return {
    text: first?.type === "text" ? first.text : "",
    isError: result.isError === true,
    calls,
  };
}

describe("lines and works council refunds", () => {
  test("show offers a refund's side the expenses it may fund, with the call that funds one", async () => {
    const { text, isError } = await refundCall({ action: "show", line: perksOut.id });

    expect(isError, text).toBe(false);
    expect(text).toContain("A works council refund (a transfer from a benefit account)");
    expect(text).toContain(
      `- the expense of 2026-10-12 in Other, costing 42.90 EUR, paid by 42.90 EUR on 2026-10-12, Current account (Riverside Bank), "CB FUELSTOP 0412 RIVERTON"; line: ${fuel.id}`,
    );
    expect(writtenCall(text, "Fund one with: ")).toEqual({
      action: "link",
      line: perksOut.id,
      into: fuel.id,
    });

    const funding = await refundCall({ action: "show", line: perksOut.id }, true);

    expect(funding.text).toContain("A works council refund: it funds the expense of 2026-10-12");
    expect(writtenCall(funding.text, "To unfund it: ")).toEqual({
      action: "unlink",
      line: perksOut.id,
    });
  });

  test("link with a refund's side funds the expense, which keeps its cost; unlink unfunds", async () => {
    const funded = await refundCall({ action: "link", line: perksOut.id, into: fuel.id });

    expect(funded.isError, funded.text).toBe(false);
    expect(funded.calls).toEqual([`fund ${perksOut.id} ${fuel.id}`]);
    expect(funded.text).toContain("which keeps its cost of 42.90 EUR");
    expect(funded.text).toContain(
      `- 30.00 EUR on 2026-10-20 from PerksHub (PerksHub), "PERKSHUB REFUND 0042"; line: ${perksOut.id}`,
    );

    const unfunded = await refundCall({ action: "unlink", line: perksOut.id });

    expect(unfunded.isError, unfunded.text).toBe(false);
    expect(unfunded.calls).toEqual([`unfund ${perksOut.id}`]);
    expect(unfunded.text).toContain("Unfunded: the line stays a side of its transfer");
  });

  test("refuses a funding past the expense's cost, with a valid call", async () => {
    const refused = await refundCall({ action: "link", line: perksOut.id, into: salary.id });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("would fund more than the expense");
    await expectValidExample(refused.text, PERKS);
  });
});

describe("the lines tool", () => {
  test("pairs, classifies and unpairs only with the write scope, and says how to get it", async () => {
    for (const action of ["pair", "classify", "unpair"]) {
      const { text, isError } = await lines({ action, line: salary.id, kind: "transfer" });

      expect(isError, action).toBe(true);
      expect(text, action).toContain("choose Read and write on Gousset's consent page");
    }
  });

  test("writes categories and transfers, and says so, in the fixed order", async () => {
    const client = await connectInProcess(
      goussetServer,
      { run: onToday(ROWS) },
      reader,
      "2026-07-28",
    );

    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "lines");

    expect(tools.map((each) => each.name)).toEqual([
      "month",
      "imports",
      "accounts",
      "data",
      "lines",
      "merchants",
      "categories",
      "rules",
      "review",
      "subjects",
    ]);
    expect(tool?.title).toBe("Lines");

    // classify and to_review, as they are: what a caller needs to call them right.
    const description = tool?.description ?? "";

    for (const said of [
      '"transfer", "expense" or "income"',
      'its one child; "Parent > Child" names a child',
      "Without `category`, the kind's fallback",
      "every counted line still classified by default",
      "held, discarded or of no amount",
      "unpair it first",
      "split across several",
      "an archived category",
      "an unknown or ambiguous category name",
      '{"action":"classify","line":"<a handle search gave>","kind":"expense","category":"Groceries > Bakery"}',
      '{"action":"pair","line":"<a handle search gave>","account":"Gift card"}',
    ]) {
      expect(description, said).toContain(said);
    }

    expect(description).not.toContain("(Other)");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
