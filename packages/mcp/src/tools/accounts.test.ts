import {
  DataExport,
  ImportProfiles,
  Imports,
  Merchants,
  RuleJobs,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type {
  AccountRecord,
  MemoryLine,
  MemoryLineDetail,
  MemoryLineRows,
  MemoryRows,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import type { Client } from "@modelcontextprotocol/client";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Runner } from "../tool";

// The accounts tool through the official client, on an in-memory store of made-up accounts.

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
    ...change,
  };
}

function line(
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  label: string,
  expiresOn: string | null = null,
): MemoryLine {
  return {
    id: memoryId(),
    accountId,
    bookedOn,
    valueOn: null,
    amountMinor,
    label,
    memo: null,
    counterpartyName: null,
    expiresOn,
  };
}

const current = account("Current account", { openingBalanceMinor: 184_250 });

const livret = account("Livret A", {
  kind: "savings",
  envelope: "livret_a",
  openingBalanceMinor: 1_250_000,
});

const otherLivret = account("Livret A", {
  kind: "savings",
  envelope: "livret_a",
  institution: "Northbank",
});

const meal = account("MealCard", { kind: "benefit", institution: "MealCard" });

const brokerage = account("US brokerage", {
  kind: "investment",
  currency: "USD",
  institution: "Harbor Securities",
});

const loan = account("Mortgage", {
  kind: "loan",
  mode: "balance",
  openingBalanceMinor: -15_000_000,
});

const closed = account("Old savings", {
  kind: "savings",
  closedOn: "2025-06-30",
  openingBalanceMinor: 1234,
});

const ROWS: MemoryRows = {
  accounts: [current, livret, otherLivret, meal, brokerage, loan, closed],
  lines: [
    line(current.id, "2026-10-01", 250_000, "SALARY EXAMPLE CORP"),
    line(current.id, "2026-10-12", -4146, "CB FUELSTOP 0412 RIVERTON"),
    line(current.id, "2026-11-03", -2380, "CB CORNER CAFE"),
    line(meal.id, "2026-11-02", 18_000, "MEALCARD CREDIT"),
    line(brokerage.id, "2026-10-05", 100_000, "DEPOSIT"),
  ],
  balances: [
    { accountId: current.id, day: "2026-10-31", minor: 430_104, source: "statement" },
    // The bank says 7.50 EUR more than the lines Gousset has: a line is missing.
    { accountId: livret.id, day: "2026-10-31", minor: 1_250_750, source: "statement" },
    { accountId: loan.id, day: "2026-10-31", minor: -14_950_000, source: "noted" },
  ],
  imports: [{ accountId: current.id, status: "done", periodTo: "2026-10-31" }],
};

/** `lineRows`: the lines a search finds, where a noted balance's movement is looked for. */
function onToday(rows: MemoryRows, lineRows: MemoryLineRows = {}): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    memoryAccountStore(new Map([[reader.userId, rows]])),
    // accounts never reaches the imports nor the export.
    memoryLineStore(new Map([[reader.userId, lineRows]])),
    memoryCategoryStore(),
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(Merchants, {}),
    Layer.mock(Transfers, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
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

/** 2000 lines of one account, over ten months, with one label. */
function busyLines(accountId: string, label: string): ReadonlyArray<MemoryLine> {
  return Array.from({ length: 2000 }, (_, index) =>
    line(
      accountId,
      `2026-${String(1 + (index % 10)).padStart(2, "0")}-15`,
      -(index + 1) * 100,
      label,
    ),
  );
}

async function client(rows: MemoryRows = ROWS): Promise<Client> {
  return connectInProcess(goussetServer, { run: onToday(rows) }, reader, "2025-11-25");
}

async function accounts(args: { [key: string]: string | number }, rows: MemoryRows = ROWS) {
  const result = await (await client(rows)).callTool({ name: "accounts", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** Each shown line's own amount (unique in `busyLines`), as `showText` writes it. */
function amountsOf(text: string): Array<string> {
  return [...text.matchAll(/: (-[\d,.]+ EUR),/g)].map((match) => match[1] ?? "");
}

describe("accounts list", () => {
  test("gives every group in order, its accounts and its totals per currency, closed apart", async () => {
    const { text, isError } = await accounts({ action: "list" });

    expect(isError).toBe(false);
    expect(text).toContain(`balances at the end of ${TODAY}`);

    const available = text.indexOf("Available:");
    const restricted = text.indexOf("Restricted:");
    const invested = text.indexOf("Savings and investments:");
    const owed = text.indexOf("Owed:");

    expect(available).toBeGreaterThanOrEqual(0);
    expect(restricted).toBeGreaterThan(available);
    expect(invested).toBeGreaterThan(restricted);
    expect(owed).toBeGreaterThan(invested);
    expect(text).toContain(
      "- Current account (Riverside Bank), current account: 4,277.24 EUR; statements until 2026-10-31.",
    );
    expect(text).toContain("Total: 4,277.24 EUR");
    expect(text).toContain("- MealCard (MealCard), benefit account: 180.00 EUR; no statement yet.");
    // Savings and investments: euros and dollars, each totalled apart.
    expect(text).toContain("Totals per currency, not converted: 12,500.00 EUR; 1,000.00 USD");
    expect(text).toContain(
      "- Mortgage (Riverside Bank), loan, kept by a noted balance: -149,500.00 EUR; no statement yet.",
    );
    expect(text).toContain("Closed accounts, out of the totals:");
    expect(text).toContain(
      "- Old savings (Riverside Bank), savings account, closed on 2025-06-30: 12.34 EUR.",
    );
    expect(text).not.toContain(current.id);
  });

  test("says when the user has no account yet", async () => {
    const { text, isError } = await accounts({ action: "list" }, {});

    expect(isError).toBe(false);
    expect(text).toBe("The user has no account in Gousset yet.");
  });
});

describe("accounts show", () => {
  test("gives the balance, the last lines newest first and the check that agrees", async () => {
    const { text, isError } = await accounts({ action: "show", name: "current account" });

    expect(isError).toBe(false);
    expect(text).toContain(
      "Current account (Riverside Bank), current account in EUR, kept by its lines.",
    );
    expect(text).toContain(
      `Balance at the end of ${TODAY}: 4,277.24 EUR; statements until 2026-10-31.`,
    );
    expect(text).toContain(
      "Check: on 2026-10-31 the statement and Gousset agree, both 4,301.04 EUR.",
    );

    const newest = text.indexOf("- 2026-11-03: -23.80 EUR, balance 4,277.24 EUR, CB CORNER CAFE");

    const oldest = text.indexOf(
      "- 2026-10-01: 2,500.00 EUR, balance 4,342.50 EUR, SALARY EXAMPLE CORP",
    );

    expect(newest).toBeGreaterThan(0);
    expect(oldest).toBeGreaterThan(newest);
    expect(text).not.toContain(current.id);
  });

  test("gives the difference when the statement disagrees", async () => {
    const { text, isError } = await accounts({
      action: "show",
      name: "Livret A",
      institution: "Riverside Bank",
    });

    expect(isError).toBe(false);
    expect(text).toContain(
      "Check: on 2026-10-31 they disagree. The statement says 12,507.50 EUR, Gousset counts 12,500.00 EUR: a difference of -7.50 EUR (Gousset counts less).",
    );
  });

  test("names an earlier statement balance that disagrees, even once the latest agrees", async () => {
    const solo = account("Solo account", { openingBalanceMinor: 10_000 });

    const rows: MemoryRows = {
      accounts: [solo],
      lines: [line(solo.id, "2026-10-05", -1000, "CB CORNER CAFE")],
      balances: [
        // The app counts 9000 at the end of 2026-10-05 (10,000 opening minus the 1000 line); the
        // bank said 8800 that day, a difference the latest (agreeing) statement does not show.
        { accountId: solo.id, day: "2026-10-05", minor: 8800, source: "statement" },
        { accountId: solo.id, day: "2026-10-31", minor: 9000, source: "statement" },
      ],
    };

    const { text, isError } = await accounts({ action: "show", name: "Solo account" }, rows);

    expect(isError).toBe(false);
    expect(text).toContain("Check: on 2026-10-31 the statement and Gousset agree, both 90.00 EUR.");
    expect(text).toContain("Also differs on these earlier statements:");
    expect(text).toContain(
      "- 2026-10-05: the statement said 88.00 EUR, Gousset counted 90.00 EUR (Gousset counts more).",
    );
  });

  test("refuses an unknown name with the user's accounts and a valid call", async () => {
    const { text, isError } = await accounts({ action: "show", name: "Joint account" });

    expect(isError).toBe(true);
    expect(text).toContain('No account of the user\'s is named "Joint account".');
    expect(text).toContain(
      "Current account (Riverside Bank), Livret A (Riverside Bank), Livret A (Northbank)",
    );
    expect(text).toContain(
      'A valid call: accounts {"action":"show","name":"Current account","institution":"Riverside Bank"}',
    );
    expect(text.length).toBeLessThan(2000);

    // The call it suggests answers.
    expect(
      (await accounts({ action: "show", name: "Current account", institution: "Riverside Bank" }))
        .isError,
    ).toBe(false);
  });

  test("refuses a name two accounts share, until the institution tells them apart", async () => {
    const { text, isError } = await accounts({ action: "show", name: "Livret A" });

    expect(isError).toBe(true);
    expect(text).toContain("Livret A (Riverside Bank), Livret A (Northbank). Add institution");

    const apart = await accounts({ action: "show", name: "Livret A", institution: "northbank" });

    expect(apart.isError).toBe(false);
    expect(apart.text).toContain("Livret A (Northbank), Livret A in EUR");
    expect(apart.text).toContain("Check: no statement gave a balance yet");
  });

  test("asks for the name when show is called without one", async () => {
    const { text, isError } = await accounts({ action: "show" });

    expect(isError).toBe(true);
    expect(text).toContain("show needs the account's name");
    expect(text).toContain('A valid call: accounts {"action":"show","name":"Current account"}');
  });

  test("stays under the limit, in one part, with many lines and many accounts", async () => {
    const busy = account("Busy account");
    const many = Array.from({ length: 60 }, (_, index) => account(`Account ${index + 1}`));

    const rows = {
      accounts: [busy, ...many],
      lines: busyLines(busy.id, "CB GREENMARKET 2110 RIVERTON SUPERSTORE"),
    };

    const shown = await accounts({ action: "show", name: "Busy account", lines: 100 }, rows);
    const listed = await accounts({ action: "list" }, rows);

    for (const { text, isError } of [shown, listed]) {
      expect(isError).toBe(false);
      expect(text.length).toBeLessThan(RESULT_LIMIT);
      expect(text).not.toContain("Part 1 of");
    }

    expect(shown.text).toContain("Last 100 line(s), newest first");
    expect(shown.text).toContain("Older lines remain. Read them with:");
  });

  test("reaches lines beyond the newest 100 with the before it writes", async () => {
    const busy = account("Busy account");
    const rows = { accounts: [busy], lines: busyLines(busy.id, "CB GREENMARKET") };

    const first = await accounts({ action: "show", name: "Busy account", lines: 100 }, rows);

    expect(first.isError).toBe(false);
    expect(first.text).toContain('"lines":100');

    const before = /"before":"([^"]+)"/.exec(first.text)?.[1];

    if (before === undefined) {
      throw new Error("The result gave no before cursor to read on with.");
    }

    const second = await accounts(
      { action: "show", name: "Busy account", lines: 100, before },
      rows,
    );

    expect(second.isError).toBe(false);

    const firstAmounts = amountsOf(first.text);
    const secondAmounts = amountsOf(second.text);

    expect(firstAmounts).toHaveLength(100);
    expect(secondAmounts).toHaveLength(100);
    // Each line's amount is unique (busyLines): the second page's lines are the ones beyond the
    // first, never repeating one of them.
    expect(new Set([...firstAmounts, ...secondAmounts]).size).toBe(200);
  });

  test("pages a longer result, each part under the limit, writing the next call", async () => {
    const busy = account("Busy account");

    const rows = {
      accounts: [busy],
      lines: busyLines(busy.id, "CB A MERCHANT WITH A LONG LABEL ".repeat(6)),
    };

    const first = await accounts({ action: "show", name: "Busy account", lines: 100 }, rows);

    expect(first.text.length).toBeLessThanOrEqual(RESULT_LIMIT);
    expect(first.text).toContain(
      '(Part 1 of 2. Read on with: accounts {"action":"show","name":"Busy account","lines":100,"cursor":"2"})',
    );

    const second = await accounts(
      { action: "show", name: "Busy account", lines: 100, cursor: "2" },
      rows,
    );

    expect(second.isError).toBe(false);
    expect(second.text).toContain("(Part 2 of 2, the last.)");
  });

  test("refuses more lines than it gives, with a valid call", async () => {
    const { text, isError } = await accounts({
      action: "show",
      name: "Current account",
      lines: 500,
    });

    expect(isError).toBe(true);
    expect(text).toContain("A valid call: accounts");
  });
});

describe("accounts show, a benefit account", () => {
  const card = account("MealCard", { kind: "benefit", institution: "MealCard" });

  const credits = [
    line(card.id, "2026-01-05", 10_000, "MEALCARD CREDIT JANUARY", "2026-10-31"),
    line(card.id, "2026-02-05", 10_000, "MEALCARD CREDIT FEBRUARY", "2026-12-31"),
    line(card.id, "2026-03-05", 5000, "WORKS COUNCIL GIFT"),
    line(card.id, "2026-02-10", -2500, "CB GREENMARKET"),
  ];

  const rows: MemoryRows = { accounts: [card], lines: credits };

  test("says its money is restricted, the order of use, what expires when and the credits left", async () => {
    const { text, isError } = await accounts({ action: "show", name: "MealCard" }, rows);

    expect(isError).toBe(false);
    expect(text).toContain(
      "Benefit account: its money is restricted, not counted in the money available.",
    );
    expect(text).toContain("Credits are used oldest first.");
    expect(text).toContain("What expires when:");
    expect(text).toContain(
      "- 2026-10-31: 75.00 EUR expired on that day; it still counts until a line takes it out.",
    );
    expect(text).toContain("- 2026-12-31: 100.00 EUR expires.");
    expect(text).toContain("Credits left, in order of use:");

    const january = text.indexOf(
      "- credited on 2026-01-05, MEALCARD CREDIT JANUARY: 75.00 EUR left of 100.00 EUR, expired on 2026-10-31 and still counted.",
    );

    const gift = text.indexOf(
      "- credited on 2026-03-05, WORKS COUNCIL GIFT: 50.00 EUR left of 50.00 EUR, no expiry.",
    );

    expect(january).toBeGreaterThan(0);
    expect(gift).toBeGreaterThan(january);
    // A credit line of the lines list says its expiry.
    expect(text).toContain(
      "- 2026-02-05: 100.00 EUR, balance 200.00 EUR, MEALCARD CREDIT FEBRUARY, expires on 2026-12-31",
    );
  });

  test("follows the issuer's order, soonest expiry first", async () => {
    const { text } = await accounts(
      { action: "show", name: "MealCard" },
      { ...rows, accounts: [{ ...card, creditOrder: "expiring_first" }] },
    );

    expect(text).toContain("Credits are used soonest expiry first, as the issuer does.");
    expect(text).toContain("- 2026-10-31: 75.00 EUR expired on that day");
  });

  test("names the opening balance as a credit", async () => {
    const { text } = await accounts(
      { action: "show", name: "MealCard" },
      { accounts: [{ ...card, openingBalanceMinor: 4000 }] },
    );

    expect(text).toContain("- the opening balance: 40.00 EUR left of 40.00 EUR, no expiry.");
    expect(text).toContain("What expires when: no credit left has an expiry.");
  });

  test("lists at most 30 credits, then how many more and what they hold", async () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      line(
        card.id,
        `2026-0${1 + Math.floor(index / 9)}-1${index % 9}`,
        1000,
        `CREDIT ${index + 1}`,
      ),
    );

    const { text, isError } = await accounts(
      { action: "show", name: "MealCard" },
      { accounts: [card], lines: many },
    );

    expect(isError).toBe(false);
    expect(text).toContain("CREDIT 30:");
    expect(text).not.toContain("CREDIT 31:");
    expect(text).toContain(
      'and 15 more credits, used after these, 150.00 EUR left in all; "What expires when" counts them all.',
    );
  });

  test("kept by its balance, says its balance is restricted and its credits not followed", async () => {
    const { text, isError } = await accounts(
      { action: "show", name: "Gift card" },
      { accounts: [account("Gift card", { kind: "benefit", mode: "balance" })] },
    );

    expect(isError).toBe(false);
    expect(text).toContain(
      "Benefit account kept by its balance: its balance is restricted, not counted in the money available. Credits and their expiries are not followed in balance mode.",
    );
    expect(text).not.toContain("What expires when");
  });

  test("another kind of account says nothing of credits", async () => {
    const { text } = await accounts({ action: "show", name: "Current account" });

    expect(text).not.toContain("Benefit account");
    expect(text).not.toContain("Credits");
  });
});

const giftCard = account("Gift card", {
  kind: "benefit",
  mode: "balance",
  institution: "Northbank",
});

/** A movement Gousset made of the balance noted on 2026-10-31: the store is given it. */
function movementOf(amountMinor: number): MemoryLineDetail {
  return {
    id: memoryId(),
    accountId: giftCard.id,
    bookedOn: "2026-10-31",
    valueOn: null,
    amountMinor,
    label: "",
    memo: null,
    counterpartyName: null,
    source: "balance",
  };
}

const movement: MemoryLineDetail = {
  ...movementOf(-9000),
  category: { id: memoryId(), name: "Meal vouchers", parentName: "Food", kind: "expense" },
};

const NOTED: MemoryLineRows = {
  accounts: [current, livret, otherLivret, giftCard],
  balances: [{ accountId: giftCard.id, day: "2026-09-30", minor: 12_000, source: "noted" }],
};

/** A call to accounts on rows both stores hold, as `caller`: a writer unless said otherwise. */
async function noting(
  args: { [key: string]: string },
  rows: MemoryLineRows = NOTED,
  caller = writer,
) {
  const connected = await connectInProcess(
    goussetServer,
    { run: onToday(rows, rows) },
    caller,
    "2025-11-25",
  );

  const result = await connected.callTool({ name: "accounts", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const NOTE = { action: "note_balance", name: "gift card", day: "2026-10-31", balance: "80.00" };

describe("accounts note_balance", () => {
  test("notes the balance, and names the movement line Gousset made of it", async () => {
    const { text, isError } = await noting(NOTE, { ...NOTED, lines: [movement] });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Noted: Gift card (Northbank) held 80.00 EUR at the end of 2026-10-31.\nIts movement, the line Gousset made of it: -90.00 EUR, an expense in Food > Meal vouchers. It is the noted balance less the one before (or the opening balance) and less the account's other lines booked between them, such as transfers.",
    );
    expect(text).not.toContain(giftCard.id);
  });

  test("says when the balance makes no movement", async () => {
    // A movement of zero is a line of no amount, in no category.
    const { text, isError } = await noting(NOTE, { ...NOTED, lines: [movementOf(0)] });

    expect(isError, text).toBe(false);
    expect(text).toContain("No movement: the noted balance is the one before plus");
  });

  test("reads a balance owed and the currency's minor units, and says where to read its movement", async () => {
    const { text, isError } = await noting({
      action: "note_balance",
      name: "Gift card",
      institution: "northbank",
      day: "2026-11-20",
      balance: "-12.5",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Noted: Gift card (Northbank) held -12.50 EUR at the end of 2026-11-20.",
    );
    // The memory store makes no movement: the result says how to read it.
    expect(text).toContain(
      'read it with lines {"action":"search","account":"Gift card","institution":"Northbank","from":"2026-11-20","to":"2026-11-20"}',
    );
  });

  test("refuses a second balance on one day", async () => {
    const { text, isError } = await noting({ ...NOTE, day: "2026-09-30" });

    expect(isError).toBe(true);
    expect(text).toContain(
      "Gift card (Northbank) already has a balance noted on 2026-09-30: one a day.",
    );
    expect(text).toContain(
      'A valid call: accounts {"action":"show","name":"Gift card","institution":"Northbank"}',
    );
    expect(text.length).toBeLessThan(ERROR_LIMIT);
  });

  test("refuses an account kept by its lines, and an unknown name, with a call that answers", async () => {
    for (const name of ["Current account", "Joint account"]) {
      const { text, isError } = await noting({ ...NOTE, name });

      expect(isError, name).toBe(true);
      expect(text.length).toBeLessThan(ERROR_LIMIT);
      expect(text, name).toMatch(/\nA valid call: accounts \{"action":"(edit|note_balance)",/);
    }

    expect((await noting({ ...NOTE, name: "Current account" })).text).toContain(
      "Current account (Riverside Bank) is kept by its lines",
    );
    expect((await noting({ ...NOTE, name: "Joint account" })).text).toContain(
      "Their accounts: Current account (Riverside Bank), Livret A (Riverside Bank), Livret A (Northbank), Gift card (Northbank).",
    );
  });

  test("refuses a name two accounts share, with the call that names the first", async () => {
    const { text, isError } = await noting({ ...NOTE, name: "Livret A" });

    expect(isError).toBe(true);
    expect(text).toContain("Livret A (Riverside Bank), Livret A (Northbank). Add institution");
    expect(text).toContain('A valid call: accounts {"action":"note_balance","name":"Livret A"');
    expect(text).toContain('"institution":"Riverside Bank"');
  });

  test("refuses a day or a balance it cannot read, and a call without them, saying how to write them", async () => {
    const day = await noting({ ...NOTE, day: "2026-02-30" });

    expect(day.isError).toBe(true);
    expect(day.text).toContain("day");

    for (const balance of ["80.001", "12,5", "80 EUR", ""]) {
      const refused = await noting({ ...NOTE, balance });

      expect(refused.isError, balance).toBe(true);
      expect(refused.text, balance).toContain("a decimal in EUR with a point for decimals");
      expect(refused.text, balance).toContain('"balance":"-1,234.56"');
    }

    const bare = await noting({ action: "note_balance", name: "Gift card" });

    expect(bare.isError).toBe(true);
    expect(bare.text).toContain("note_balance needs the account's name and its balance");
  });

  test("is refused to a token that reads only, saying how to allow writes", async () => {
    const { text, isError } = await noting(NOTE, NOTED, reader);

    expect(isError).toBe(true);
    expect(text).toContain("this connection was allowed to read only");
    expect(text).toContain("choose Read and write on Gousset's consent page");
  });
});

describe("accounts show, an account kept by its balance", () => {
  test("says where its movements go, and names each movement line", async () => {
    const { text, isError } = await noting(
      { action: "show", name: "Gift card" },
      { ...NOTED, lines: [movement] },
      reader,
    );

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Gift card (Northbank), benefit account in EUR, kept by a balance noted each month.",
    );
    // The memory store names no category for an account: its movements go to the fallback.
    expect(text).toContain(
      "Each noted balance makes one line, its movement: the noted balance less the one before and less the account's other lines booked between them. No category is chosen for them: each goes to its kind's fallback.",
    );
    expect(text).toContain("- 2026-10-31: -90.00 EUR, movement of the noted balance");
    expect(text).not.toContain("(no label)");
  });

  test("an account kept by its lines says nothing of movements", async () => {
    const { text } = await accounts({ action: "show", name: "Current account" });

    expect(text).not.toContain("noted balance");
  });
});

describe("the accounts tool", () => {
  test("tells an agent that show answers what expires when", async () => {
    const { tools } = await (await client()).listTools();
    const tool = tools.find((each) => each.name === "accounts");

    expect(tool?.description).toContain("what expires when on my meal vouchers?");
  });

  test("comes third in the list, and says it writes (issues #124, #31)", async () => {
    const { tools } = await (await client()).listTools();
    const tool = tools.find((each) => each.name === "accounts");

    expect(tools.map((each) => each.name)).toEqual([
      "month",
      "imports",
      "accounts",
      "data",
      "lines",
      "merchants",
      "categories",
      "rules",
    ]);
    expect(tool?.title).toBe("Accounts");
    expect(tool?.description).toContain("it makes the day's movement line, in its `category`");
    // A write; a repeated create makes a second account.
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});
