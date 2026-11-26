import fc from "fast-check";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import type { AccountRecord } from "./account-store";
import { memoryId } from "./account-store-memory";
import type { LineStore } from "./line-store";
import { memoryLineStore } from "./line-store-memory";
import type { MemoryLineDetail, MemoryLineRows } from "./line-store-memory";
import { searchLines, showLine } from "./lines";
import type { LineSearch } from "./lines";

const TODAY = "2026-11-23";
const ADA = "ada";
const BOB = "bob";

/** Runs `effect` today, on a store of Ada's (and Bob's, when given) that holds `rows`. */
function inOrder<A, E>(
  rows: MemoryLineRows,
  effect: Effect.Effect<A, E, LineStore>,
  bob: MemoryLineRows = {},
) {
  const layer = Layer.mergeAll(
    memoryLineStore(
      new Map([
        [ADA, rows],
        [BOB, bob],
      ]),
    ),
    TestClock.layer(),
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

      return yield* effect;
    }).pipe(Effect.provide(layer)),
  );
}

/** Why the search is refused, or "succeeded". */
const refusal = (rows: MemoryLineRows, search: LineSearch) =>
  inOrder(
    rows,
    searchLines(ADA, search).pipe(
      Effect.map(() => "succeeded"),
      Effect.catchTag("LineSearchRefused", (refused) =>
        Effect.succeed(`LineSearchRefused:${refused.reason}`),
      ),
    ),
  );

function accountOf(name: string, currency = "EUR"): AccountRecord {
  return {
    id: memoryId(),
    name,
    kind: "current",
    envelope: null,
    institution: "Riverside Bank",
    currency,
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    settlesIntoAccountId: null,
    creditOrder: "oldest_first",
    balanceCategoryId: null,
    topUpDays: 3,
    topUpCapMinor: null,
  };
}

const line = (
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  label = "CB CORNER CAFE",
  change: Partial<MemoryLineDetail> = {},
): MemoryLineDetail => ({
  id: memoryId(),
  accountId,
  bookedOn,
  valueOn: null,
  amountMinor,
  label,
  memo: null,
  counterpartyName: null,
  ...change,
});

const search = async (rows: MemoryLineRows, asked: LineSearch) =>
  inOrder(rows, searchLines(ADA, asked));

const amounts = async (rows: MemoryLineRows, asked: LineSearch) =>
  (await search(rows, asked)).lines.map((each) => `${each.amount.minor} ${each.amount.currency}`);

describe("searchLines: amount", () => {
  const euro = accountOf("Current account");
  const yen = accountOf("Tokyo account", "JPY");
  const dinar = accountOf("Kuwait account", "KWD");

  const rows: MemoryLineRows = {
    accounts: [euro, yen, dinar],
    lines: [
      line(euro.id, "2026-11-01", 1249),
      line(euro.id, "2026-11-02", 1250),
      line(euro.id, "2026-11-03", -1251),
      line(yen.id, "2026-11-04", 12),
      line(yen.id, "2026-11-05", 13),
      line(yen.id, "2026-11-06", -13),
      line(dinar.id, "2026-11-07", 12_499),
      line(dinar.id, "2026-11-08", 12_500),
      line(dinar.id, "2026-11-09", -12_501),
    ],
  };

  test("reads the least amount in each account's currency, rounded up, sign ignored", async () => {
    expect(await amounts(rows, { amountMin: "12.5" })).toEqual([
      "-12501 KWD",
      "12500 KWD",
      "-13 JPY",
      "13 JPY",
      "-1251 EUR",
      "1250 EUR",
    ]);

    expect(await amounts(rows, { amountMin: "-12,5" })).toEqual(
      await amounts(rows, { amountMin: "12.5" }),
    );
  });

  test("reads the greatest amount in each account's currency, rounded down", async () => {
    expect(await amounts(rows, { amountMax: "12.5" })).toEqual([
      "12500 KWD",
      "12499 KWD",
      "12 JPY",
      "1250 EUR",
      "1249 EUR",
    ]);
  });

  test("leaves out a currency whose rounding puts the least above the greatest", async () => {
    expect(await amounts(rows, { amountMin: "12.5", amountMax: "12.5" })).toEqual([
      "12500 KWD",
      "1250 EUR",
    ]);

    expect(await amounts(rows, { amountMin: "12.4991", amountMax: "12.5009" })).toEqual([
      "12500 KWD",
      "1250 EUR",
    ]);
  });

  test("refuses an amount it cannot read, and a least above the greatest", async () => {
    for (const amountMin of ["abc", "1.2.3", "12.", ".5", "1 000", "123456789012"]) {
      expect(await refusal(rows, { amountMin })).toBe("LineSearchRefused:amount");
    }

    expect(await refusal(rows, { amountMin: "20", amountMax: "10" })).toBe(
      "LineSearchRefused:amount",
    );
    expect(await refusal(rows, { amountMin: "  ", amountMax: "" })).toBe("succeeded");
  });
});

describe("searchLines: text", () => {
  const euro = accountOf("Current account");

  const rows: MemoryLineRows = {
    accounts: [euro],
    lines: [
      line(euro.id, "2026-11-01", -100, "100% ORGANIC"),
      line(euro.id, "2026-11-02", -200, "A_B SHOP"),
      line(euro.id, "2026-11-03", -300, "AXB SHOP"),
      line(euro.id, "2026-11-04", -400, String.raw`PATH\TO MARKET`),
      line(euro.id, "2026-11-05", -500, "VIR SEPA", {
        memo: "Rent November",
        counterpartyName: "Oakwood Lettings",
      }),
    ],
  };

  const labels = async (text: string) =>
    (await search(rows, { text })).lines.map((each) => each.label);

  test("takes %, _ and the backslash as themselves", async () => {
    expect(await labels("%")).toEqual(["100% ORGANIC"]);
    expect(await labels("A_B")).toEqual(["A_B SHOP"]);
    expect(await labels("_")).toEqual(["A_B SHOP"]);
    expect(await labels("\\")).toEqual([String.raw`PATH\TO MARKET`]);
  });

  test("finds a piece of the memo or the counterparty's name, in any case", async () => {
    expect(await labels("rent nov")).toEqual(["VIR SEPA"]);
    expect(await labels("OAKWOOD")).toEqual(["VIR SEPA"]);
    expect(await labels("shop")).toEqual(["AXB SHOP", "A_B SHOP"]);
  });

  test("searches nothing for a blank text", async () => {
    expect(await labels("   ")).toHaveLength(5);
  });
});

describe("searchLines: period and account", () => {
  const euro = accountOf("Current account");
  const savings = accountOf("Livret A");

  const rows: MemoryLineRows = {
    accounts: [euro, savings],
    lines: [
      line(euro.id, "2026-10-31", -100),
      line(euro.id, "2026-11-01", -200),
      line(savings.id, "2026-11-15", 300),
      line(euro.id, "2026-11-30", -400),
    ],
  };

  test("keeps the days from and to, both included", async () => {
    expect(await amounts(rows, { from: "2026-11-01", to: "2026-11-15" })).toEqual([
      "300 EUR",
      "-200 EUR",
    ]);
  });

  test("refuses a day it cannot read, and a period that ends before it starts", async () => {
    for (const asked of [
      { from: "2026-13-01" },
      { to: "2026-02-30" },
      { from: "1 Nov 2026" },
      { from: "2026-11-02", to: "2026-11-01" },
    ]) {
      expect(await refusal(rows, asked)).toBe("LineSearchRefused:period");
    }
  });

  test("keeps one account's lines, and none for an id the user lacks", async () => {
    const page = await search(rows, { accountId: savings.id });

    expect(page.lines.map((each) => each.account)).toEqual([
      { id: savings.id, name: "Livret A", institution: "Riverside Bank" },
    ]);
    expect(await search(rows, { accountId: memoryId() })).toEqual({
      lines: [],
      next: null,
      total: 0,
    });
    expect((await search(rows, { accountId: "not-an-id" })).total).toBe(0);
  });

  test("never shows a line booked after today, nor another user's", async () => {
    // As on the account page: a line booked after today is not counted yet.
    expect(await amounts(rows, { to: "2026-12-31" })).toEqual(["300 EUR", "-200 EUR", "-100 EUR"]);

    const page = await inOrder({}, searchLines(ADA), rows);

    expect(page.total).toBe(0);
  });
});

describe("searchLines: to review", () => {
  const euro = accountOf("Current account");

  const rows: MemoryLineRows = {
    accounts: [euro],
    lines: [
      line(euro.id, "2026-11-01", -100),
      line(euro.id, "2026-11-02", -200, "CB CORNER CAFE", { state: "held" }),
      line(euro.id, "2026-11-03", -300, "CB CORNER CAFE", { state: "discarded" }),
    ],
  };

  test("gives the counted lines by default, the held ones to review, never the discarded", async () => {
    const counted = await search(rows, {});
    const held = await search(rows, { toReview: true });

    expect(counted.lines.map((each) => [each.amount.minor, each.toReview])).toEqual([
      [-100, false],
    ]);
    expect(held.lines.map((each) => [each.amount.minor, each.toReview])).toEqual([[-200, true]]);
    expect([counted.total, held.total]).toEqual([1, 1]);
  });
});

/** Reads every page of Ada's lines in turn, following `next`. */
const everyPage = (limit: number) =>
  Effect.gen(function* () {
    const ids: Array<string> = [];
    const totals: Array<number> = [];
    let after: string | undefined;

    for (let pages = 0; pages < 100; pages += 1) {
      const page = yield* searchLines(ADA, { limit, after });

      ids.push(...page.lines.map((each) => each.id));
      totals.push(page.total);

      if (page.next === null) {
        return { ids, totals };
      }

      after = page.next;
    }

    return { ids, totals };
  });

describe("searchLines: pages", () => {
  const euro = accountOf("Current account");
  const savings = accountOf("Livret A");

  test("give every line once, in order, whatever the page's size and the ties on a day", async () => {
    // Few days, so that many lines share one.
    const anyLine = fc.record({
      day: fc.constantFrom("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-30"),
      onSavings: fc.boolean(),
      held: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(anyLine, { maxLength: 40 }),
        fc.integer({ min: 1, max: 7 }),
        async (drawn, limit) => {
          const lines = drawn.map((each) =>
            line(each.onSavings ? savings.id : euro.id, each.day, -100, "CB CORNER CAFE", {
              state: each.held ? "held" : "counted",
            }),
          );

          const rows: MemoryLineRows = { accounts: [euro, savings], lines };

          const expected = lines
            .filter((each) => each.state === "counted" && each.bookedOn <= TODAY)
            .sort((a, b) => b.bookedOn.localeCompare(a.bookedOn) || b.id.localeCompare(a.id))
            .map((each) => each.id);

          const { ids, totals } = await inOrder(rows, everyPage(limit));

          expect(ids).toEqual(expected);
          expect(new Set(totals)).toEqual(new Set([expected.length]));
        },
      ),
    );
  });

  test("give 100 lines by default and 500 at most, and refuse a cursor no page gave", async () => {
    const lines = Array.from({ length: 501 }, () => line(euro.id, "2026-11-01", -100));
    const rows: MemoryLineRows = { accounts: [euro], lines };

    expect((await search(rows, {})).lines).toHaveLength(100);
    expect((await search(rows, { limit: 9999 })).lines).toHaveLength(500);
    expect((await search(rows, { limit: 0 })).lines).toHaveLength(1);
    expect((await search(rows, {})).total).toBe(501);

    for (const after of [
      "nope",
      "2026-11-01_nope",
      "2026-13-01_00000000-0000-7000-8000-000000000001",
    ]) {
      expect(await refusal(rows, { after })).toBe("LineSearchRefused:cursor");
    }
  });
});

describe("showLine", () => {
  const euro = accountOf("Current account");
  const importId = memoryId();
  const original = line(euro.id, "2026-11-01", -4200, "CB GREENMARKET");

  const held = line(euro.id, "2026-11-02", -4200, "CB GREENMARKET 0211", {
    state: "held",
    source: "import",
    importId,
    duplicateOfLineId: original.id,
    originalAmountMinor: -4500,
    originalCurrency: "USD",
    counterpartyIban: "FR7699999000010001234567809",
  });

  const later = line(euro.id, "2026-11-30", -100);
  const discarded = line(euro.id, "2026-11-03", -100, "CB CORNER CAFE", { state: "discarded" });

  const rows: MemoryLineRows = {
    accounts: [euro],
    lines: [original, held, later, discarded],
    imports: [
      {
        id: importId,
        accountId: euro.id,
        status: "done",
        fileName: "november.ofx",
        format: "ofx",
        importedAt: "2026-11-20T09:30:00.000Z",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-19",
      },
    ],
  };

  test("gives the line with its detail, the line it looks like and its import", async () => {
    const detail = await inOrder(rows, showLine(ADA, held.id));

    expect(detail).toEqual({
      id: held.id,
      bookedOn: "2026-11-02",
      valueOn: null,
      label: "CB GREENMARKET 0211",
      memo: null,
      counterpartyName: null,
      amount: { minor: -4200, currency: "EUR" },
      account: { id: euro.id, name: "Current account", institution: "Riverside Bank" },
      toReview: true,
      // Held, it has no entry yet: no category.
      category: null,
      fromBalance: false,
      originalAmount: { minor: -4500, currency: "USD" },
      counterpartyIban: "FR7699999000010001234567809",
      expiresOn: null,
      source: "import",
      duplicateOf: {
        id: original.id,
        bookedOn: "2026-11-01",
        label: "CB GREENMARKET",
        amount: { minor: -4200, currency: "EUR" },
      },
      import: {
        id: importId,
        fileName: "november.ofx",
        format: "ofx",
        importedAt: "2026-11-20T09:30:00.000Z",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-19",
      },
      subjects: [],
    });
  });

  test("gives the category of a line's one entry, with its parent's name", async () => {
    const classified = line(euro.id, "2026-11-04", -380, "CB LE FOURNIL", {
      category: { id: "bakery", name: "Bakery", parentName: "Groceries", kind: "expense" },
    });

    const page = await inOrder({ ...rows, lines: [classified] }, searchLines(ADA, {}));

    expect(page.lines.map((each) => each.category)).toEqual([
      { id: "bakery", name: "Bakery", parentName: "Groceries", kind: "expense" },
    ]);
  });

  const tagOf = (owner: string, lineId: string) =>
    inOrder(
      rows,
      showLine(owner, lineId).pipe(
        Effect.map(() => "found"),
        Effect.catchTag("LineNotFound", () => Effect.succeed("LineNotFound")),
      ),
    );

  test("finds no line booked after today, discarded, another user's or no uuid", async () => {
    expect(await tagOf(ADA, original.id)).toBe("found");
    expect(await tagOf(ADA, later.id)).toBe("LineNotFound");
    expect(await tagOf(ADA, discarded.id)).toBe("LineNotFound");
    expect(await tagOf(BOB, original.id)).toBe("LineNotFound");
    expect(await tagOf(ADA, "not-an-id")).toBe("LineNotFound");
  });
});

describe("searchLines: to review", () => {
  const current = accountOf("Current account");
  const savings = accountOf("Savings");
  const other = accountOf("Other savings");
  const out = line(current.id, "2026-11-10", -5000, "SEPA TRF TO SAVINGS");
  const held = line(current.id, "2026-11-12", -4200, "CB GREENMARKET", { state: "held" });
  const cafe = line(current.id, "2026-11-13", -250);

  const rows: MemoryLineRows = {
    accounts: [current, savings, other],
    lines: [
      out,
      line(savings.id, "2026-11-11", 5000, "SEPA TRF RECEIVED"),
      line(other.id, "2026-11-09", 5000, "SEPA TRF RECEIVED"),
      held,
      cafe,
    ],
  };

  test("lists the held lines and those whose transfer's other side waits for the user's choice", async () => {
    const page = await search(rows, { toReview: true });

    // The two lines in may each be out's other side: out has two candidates, each of them one.
    expect(page.lines.map((each) => each.id)).toEqual([held.id, out.id]);
    expect(page.lines.every((each) => each.toReview)).toBe(true);
    expect(page.total).toBe(2);
  });

  test("leaves them among the counted lines too", async () => {
    const page = await search(rows, {});

    expect(page.lines.map((each) => each.id)).toContain(out.id);
    expect(page.lines.find((each) => each.id === out.id)?.toReview).toBe(false);
  });

  test("lists a counted line its import left in its kind's fallback, not one the user classified", async () => {
    const current = accountOf("Classified current");
    const fallback = { id: memoryId(), name: "Other", parentName: null, kind: "expense" as const };

    const unclassified = line(current.id, "2026-11-12", -3150, "CB HILLSIDE PHARMACY", {
      category: fallback,
      classifiedBy: "default",
    });

    const classified = line(current.id, "2026-11-13", -4200, "CB GREENMARKET", {
      category: { ...fallback, id: memoryId(), name: "Groceries" },
      classifiedBy: "user",
    });

    const page = await search(
      { accounts: [current], lines: [unclassified, classified] },
      { toReview: true },
    );

    expect(page.lines.map((each) => [each.id, each.toReview])).toEqual([[unclassified.id, true]]);
    expect(page.total).toBe(1);
  });

  test("leaves out a refund linked to an expense still classified by default: it follows its expense", async () => {
    const current = accountOf("Refunded current");
    const fallback = { id: memoryId(), name: "Other", parentName: null, kind: "expense" as const };

    const expense = line(current.id, "2026-11-12", -3150, "CB HILLSIDE PHARMACY", {
      category: fallback,
      classifiedBy: "default",
    });

    const refund = line(current.id, "2026-11-14", 3150, "REFUND HILLSIDE PHARMACY", {
      category: fallback,
      classifiedBy: "default",
      role: "refund",
    });

    const page = await search(
      { accounts: [current], lines: [expense, refund] },
      { toReview: true },
    );

    expect(page.lines.map((each) => each.id)).toEqual([expense.id]);
    expect(page.total).toBe(1);
  });
});
