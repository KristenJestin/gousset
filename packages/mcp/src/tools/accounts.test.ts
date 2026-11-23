import {
  FixtureLedger,
  Imports,
  memoryAccountStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type { AccountRecord, MemoryLine, MemoryRows } from "@gousset/core";
import type { Client } from "@modelcontextprotocol/client";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Runner } from "../tool";

// The accounts tool through the official client, on an in-memory store of made-up accounts.

const TODAY = "2026-11-23";
const reader = { userId: "ada", canWrite: false };

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
    ...change,
  };
}

function line(accountId: string, bookedOn: string, amountMinor: number, label: string): MemoryLine {
  return {
    id: memoryId(),
    accountId,
    bookedOn,
    valueOn: null,
    amountMinor,
    label,
    memo: null,
    counterpartyName: null,
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

function onToday(rows: MemoryRows): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    FixtureLedger,
    memoryAccountStore(new Map([[reader.userId, rows]])),
    // accounts never reaches the imports nor the line search.
    memoryLineStore(),
    Layer.mock(Imports, {}),
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

describe("the accounts tool", () => {
  test("only reads, and says so", async () => {
    const { tools } = await (await client()).listTools();
    const tool = tools.find((each) => each.name === "accounts");

    expect(tools.map((each) => each.name)).toEqual(["month", "imports", "accounts", "lines"]);
    expect(tool?.title).toBe("Accounts");
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
