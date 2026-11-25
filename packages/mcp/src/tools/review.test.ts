import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type {
  AccountRecord,
  LineCategory,
  MemoryCategoryRows,
  MemoryLineDetail,
  MemoryLineRows,
  RefundProposal,
  TransferSide,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { callText, connectInProcess } from "../test-client";
import type { Runner } from "../tool";

// The review tool through the official client, on in-memory stores of made-up lines: the queue and
// its proposals, and what is refused before anything is written. The writes themselves go through
// the database, end to end (review-mcp.spec).

const TODAY = "2026-11-23";
const reader = { userId: "ada", canWrite: false, currency: "EUR" };
const writer = { userId: "ada", canWrite: true, currency: "EUR" };

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

const groceries: LineCategory = {
  id: memoryId(),
  name: "Groceries",
  parentName: null,
  kind: "expense",
};

const otherExpense: LineCategory = {
  id: memoryId(),
  name: "Other",
  parentName: null,
  kind: "expense",
};

const otherIncome: LineCategory = {
  id: memoryId(),
  name: "Other",
  parentName: null,
  kind: "income",
};

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
const northLivret = account("Livret A", { kind: "savings", institution: "Northbank" });

const cafe = line(current.id, "2026-11-03", -2380, "CB CORNER CAFE", {
  category: otherExpense,
  classifiedBy: "user",
});

const heldCafe = line(current.id, "2026-11-04", -2380, "CB CORNER CAFE", {
  state: "held",
  duplicateOfLineId: cafe.id,
});

// Two lines may be its other side: the user chooses.
const toSavings = line(current.id, "2026-11-10", -5000, "VIR LIVRET", {
  category: otherExpense,
  classifiedBy: "default",
});

const intoLivret = line(livret.id, "2026-11-10", 5000, "VIR RECU", { classifiedBy: "user" });
const intoNorth = line(northLivret.id, "2026-11-11", 5000, "VIR RECU", { classifiedBy: "user" });

const returned = line(current.id, "2026-11-14", 3000, "CB CORNER SHOP RETOUR", {
  category: otherIncome,
  classifiedBy: "default",
});

const shop = line(current.id, "2026-11-01", -3000, "CB CORNER SHOP", {
  category: groceries,
  classifiedBy: "user",
});

const market = line(current.id, "2026-11-18", -1250, "CB CITY MARKET", {
  category: groceries,
  classifiedBy: "default",
});

const byRule = line(current.id, "2026-11-19", -900, "CB BAKERY", {
  category: groceries,
  classifiedBy: "rule",
});

const ROWS: MemoryLineRows = {
  accounts: [current, livret, northLivret],
  lines: [cafe, heldCafe, toSavings, intoLivret, intoNorth, returned, shop, market, byRule],
};

const sideOf = (of: MemoryLineDetail, from: AccountRecord): TransferSide => ({
  id: of.id,
  bookedOn: of.bookedOn,
  label: of.label,
  amount: { minor: of.amountMinor, currency: "EUR" },
  account: { id: from.id, name: from.name, institution: from.institution },
  madeByApp: false,
});

const TRANSFERS = Layer.mock(Transfers, {
  ofLine: (_owner, lineId) =>
    Effect.succeed({
      paired: null,
      candidates:
        lineId === toSavings.id ? [sideOf(intoLivret, livret), sideOf(intoNorth, northLivret)] : [],
    }),
});

const refund: RefundProposal = {
  line: {
    lineId: shop.id,
    bookedOn: shop.bookedOn,
    label: shop.label,
    account: { id: current.id, name: current.name, institution: current.institution },
    amount: { minor: 3000, currency: "EUR" },
  },
  category: groceries,
  net: { minor: 3000, currency: "EUR" },
};

const EXPENSES = Layer.mock(Expenses, {
  ofLine: (_owner, lineId) =>
    Effect.succeed({
      expenses: [],
      role: null,
      proposals: lineId === returned.id ? [refund] : [],
      funding: null,
    }),
});

const MERCHANTS = Layer.mock(Merchants, {
  ofLine: (_owner, lineId) =>
    Effect.succeed({
      merchant:
        lineId === market.id
          ? { id: memoryId(), name: "City Market", look: { color: null, logo: null } }
          : null,
      intermediary: null,
      asks: false,
    }),
});

function onToday(
  rows: MemoryLineRows,
  categories: MemoryCategoryRows | undefined,
): Runner<GoussetServices> {
  const byOwner = new Map([[reader.userId, rows]]);

  // `UserData` is a mock with nothing: a write that reaches the database dies, and the call fails.
  const layer = Layer.mergeAll(
    memoryAccountStore(byOwner),
    memoryLineStore(byOwner),
    memoryCategoryStore(
      categories === undefined ? new Map() : new Map([[reader.userId, categories]]),
    ),
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Subscriptions, {}),
    Layer.mock(MonthFacts, {}),
    TRANSFERS,
    EXPENSES,
    MERCHANTS,
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

async function review(
  args: { [key: string]: string | number },
  caller = reader,
  rows: MemoryLineRows = ROWS,
  categories?: MemoryCategoryRows,
) {
  const client = await connectInProcess(
    goussetServer,
    { run: onToday(rows, categories) },
    caller,
    "2025-11-25",
  );

  return callText(client, "review", args);
}

/** The line of the list that ends with `lineId`'s handle. */
const rowOf = (text: string, lineId: string) =>
  text.split("\n").find((each) => each.includes(`; line: ${lineId};`)) ?? "";

describe("review list", () => {
  test("gives every line to review, newest first, each with its proposal and handles", async () => {
    const { text, isError } = await review({ action: "list" });

    expect(isError, text).toBe(false);
    expect(text.length).toBeLessThan(RESULT_LIMIT);
    expect(text).toContain("4 line(s) to review.");

    const handles = [...text.matchAll(/; line: (\S+);/g)].map(([, id]) => id);

    expect(handles).toStrictEqual([market.id, returned.id, toSavings.id, heldCafe.id]);

    expect(rowOf(text, heldCafe.id)).toContain(
      'discard it, it repeats the line of 2026-11-03, -23.80 EUR, "CB CORNER CAFE"',
    );

    expect(rowOf(text, heldCafe.id)).toContain(`proposal: duplicate:${cafe.id}`);

    expect(rowOf(text, toSavings.id)).toContain(
      'pair it as a transfer with the line of 2026-11-10, Livret A (Riverside Bank): 50.00 EUR, "VIR RECU" (1 other candidate: lines show)',
    );

    expect(rowOf(text, toSavings.id)).toContain(`proposal: transfer:${intoLivret.id}`);

    expect(rowOf(text, returned.id)).toContain(
      "link it as a refund of the expense in Groceries costing 30.00 EUR",
    );

    expect(rowOf(text, returned.id)).toContain(`proposal: refund:${shop.id}`);
    expect(rowOf(text, market.id)).toContain("keep it in Groceries (merchant: City Market)");
    expect(rowOf(text, market.id)).toContain(`proposal: category:${groceries.id}`);
  });

  test("leaves out a line a rule classified: a rule is the user's decision", async () => {
    const { text } = await review({ action: "list" });

    expect(text).not.toContain(byRule.id);
  });

  test("pages with the next call written", async () => {
    const { text } = await review({ action: "list", limit: 2 });
    const next = /Read them with: review (\{.*\})/.exec(text)?.[1] ?? "";

    expect(next, text).not.toBe("");

    const written = Schema.decodeUnknownSync(
      Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
    )(JSON.parse(next));

    const { text: second, isError } = await review(written);

    expect(isError, second).toBe(false);
    expect(second).toContain(toSavings.id);
    expect(second).toContain(heldCafe.id);
  });

  test("says so when nothing waits", async () => {
    const { text } = await review({ action: "list" }, reader, {
      accounts: [current],
      lines: [cafe],
    });

    expect(text).toBe("0 line(s) to review. Nothing waits for the user.");
  });
});

describe("review writes", () => {
  test("are refused to a token allowed to read only, saying how to allow writes", async () => {
    const { text, isError } = await review({
      action: "accept",
      line: market.id,
      proposal: `category:${groceries.id}`,
    });

    expect(isError).toBe(true);
    expect(text).toContain("allowed to read only");
  });

  test("accept refuses a proposal that is not the one listed, and does nothing", async () => {
    const { text, isError } = await review(
      { action: "accept", line: toSavings.id, proposal: `transfer:${intoNorth.id}` },
      writer,
    );

    expect(isError).toBe(true);
    expect(text.length).toBeLessThan(ERROR_LIMIT);
    expect(text).toContain("proposal changed since it was listed");
    expect(text).toContain('review {"action":"list"}');
  });

  test("accept refuses a proposal of another kind naming the same line", async () => {
    const { text, isError } = await review(
      { action: "accept", line: toSavings.id, proposal: `refund:${intoLivret.id}` },
      writer,
    );

    expect(isError).toBe(true);
    expect(text).toContain("proposal changed since it was listed");
  });

  test("accept refuses to keep a line in no category, and says to correct it", async () => {
    const bare = line(current.id, "2026-11-20", -700, "CB KIOSK", { classifiedBy: "default" });

    const listed = await review({ action: "list" }, reader, {
      accounts: [current],
      lines: [bare],
    });

    expect(rowOf(listed.text, bare.id)).toContain("classify it; line:");
    expect(rowOf(listed.text, bare.id)).toContain("proposal: category");

    const { text, isError } = await review(
      { action: "accept", line: bare.id, proposal: "category" },
      writer,
      { accounts: [current], lines: [bare] },
    );

    expect(isError).toBe(true);
    expect(text.length).toBeLessThan(ERROR_LIMIT);
    expect(text).toContain("no category to keep");
    expect(text).toContain(`review {"action":"correct","line":"${bare.id}","category":`);
  });

  test("accept refuses a line no longer to review", async () => {
    const { text, isError } = await review(
      { action: "accept", line: byRule.id, proposal: `category:${groceries.id}` },
      writer,
    );

    expect(isError).toBe(true);
    expect(text).toContain("no longer to review");
  });

  test("correct needs a category but for a held line", async () => {
    const { text, isError } = await review({ action: "correct", line: market.id }, writer);

    expect(isError).toBe(true);
    expect(text).toContain("correct needs category for this line");
  });

  test("correct refuses an archived category for a held line before keeping it: it stays held", async () => {
    const archived = memoryCategory("expense", "Old Shops", {
      archivedAt: "2026-10-01T00:00:00.000Z",
    });

    const { text, isError } = await review(
      { action: "correct", line: heldCafe.id, category: "Old Shops" },
      writer,
      ROWS,
      { categories: [archived], entries: [], lines: [] },
    );

    // Kept first, the line would have reached the database, which this test has not: the call dies.
    expect(isError, text).toBe(true);
    expect(text).toContain("That category is archived");
  });

  test("an unknown handle is refused with a call that answers", async () => {
    const { text, isError } = await review(
      { action: "accept", line: "no-such-line", proposal: "x" },
      writer,
    );

    expect(isError).toBe(true);
    expect(text).toContain('No line of the user\'s has the handle "no-such-line"');
    expect(text).toContain('review {"action":"list"}');
  });
});
