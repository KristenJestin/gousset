import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Investments,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type { AccountRecord, MemoryLine, MemoryRows } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { connectInProcess } from "../test-client";
import type { Caller } from "../tool";
import { accountsTool } from "./accounts";

// Issue #124: the accounts tool's writes through the official client, on an in-memory store of
// made-up accounts that keeps what each call writes for the next one.

const TODAY = "2026-11-23";
const writer: Caller = { userId: "ada", canWrite: true, currency: "EUR" };
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };

type Arguments = { readonly [key: string]: string | number };

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
const savings = account("Savings", { kind: "savings" });
const loan = account("Mortgage", { kind: "loan", mode: "balance" });
const meal = account("MealCard", { kind: "benefit", institution: "MealCard" });
const credit = line(meal.id, "2026-10-05", 18_000, "MEALCARD CREDIT");
const spent = line(meal.id, "2026-10-12", -1250, "CB CORNER CAFE");

const ROWS: MemoryRows = {
  accounts: [current, savings, loan, meal],
  lines: [line(current.id, "2026-10-01", 250_000, "SALARY EXAMPLE CORP"), credit, spent],
};

const runtimes: Array<{ readonly dispose: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

/**
 * A client on one store for the whole test: each call sees what the calls before it wrote. Returns
 * the call, its text and whether it is an error.
 */
async function connect(rows: MemoryRows = ROWS, caller: Caller = writer) {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      memoryAccountStore(new Map([[caller.userId, rows]])),
      // accounts never reaches the imports, the export, the merchants, the transfers nor the rules;
      // it searches the lines for a noted balance's movement (#31), and reads the categories.
      memoryLineStore(),
      memoryCategoryStore(),
      Layer.mock(Imports, {}),
      Layer.mock(ImportProfiles, {}),
      Layer.mock(DataExport, {}),
      Layer.mock(Merchants, {}),
      Layer.mock(Transfers, {}),
      Layer.mock(Expenses, {}),
      Layer.mock(UserData, {}),
      Layer.mock(RuleJobs, {}),
      Layer.mock(Subscriptions, {}),
      Layer.mock(MonthFacts, {}),
      Layer.mock(Investments, {}),
      TestClock.layer(),
    ),
  );

  runtimes.push(runtime);

  const client = await connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        runtime.runPromiseExit(
          Effect.gen(function* () {
            yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

            return yield* effect;
          }),
        ),
    },
    caller,
    "2025-11-25",
  );

  return async (args: Arguments) => {
    const result = await client.callTool({ name: "accounts", arguments: args });
    const [first] = result.content ?? [];

    return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
  };
}

/** A refusal: an error that says `saying`, ends with a valid call and stays under its limit. */
function expectRefusal(answer: { text: string; isError: boolean }, saying: string) {
  expect(answer.isError, answer.text).toBe(true);
  expect(answer.text).toContain(saying);
  expect(answer.text).toMatch(/A valid call: (accounts|lines) \{"action":"[a-z_]+".*\}$/);
  expect(answer.text.length).toBeLessThan(2000);
}

describe("accounts create", () => {
  test("creates an account, which list then gives in its group with its opening balance", async () => {
    const call = await connect();

    const created = await call({
      action: "create",
      name: "Livret A",
      kind: "livret_a",
      institution: "Northbank",
      opening_balance: "1,250.50",
      opened_on: "2026-01-15",
    });

    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain("Created Livret A (Northbank).");
    expect(created.text).toContain("Livret A (Northbank), Livret A in EUR, kept by its lines.");
    expect(created.text).toContain("Opening balance: 1,250.50 EUR, opened on 2026-01-15.");
    expect(created.text).toContain(
      'Read it with: accounts {"action":"show","name":"Livret A","institution":"Northbank"}',
    );
    expect(created.text).not.toMatch(/[\da-f]{8}-[\da-f]{4}-/);

    const listed = await call({ action: "list" });

    expect(listed.text).toContain(
      "- Livret A (Northbank), Livret A: 1,250.50 EUR; no statement yet.",
    );
    expect(listed.text.indexOf("- Livret A (Northbank)")).toBeGreaterThan(
      listed.text.indexOf("Savings and investments:"),
    );
  });

  test("creates an account in another currency, with its own minor units, kept by a balance", async () => {
    const call = await connect();

    const created = await call({
      action: "create",
      name: "Tokyo account",
      kind: "current",
      currency: "JPY",
      mode: "balance",
      opening_balance: "150000",
    });

    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain(
      "Tokyo account, current account in JPY, kept by a balance noted each month.",
    );
    expect(created.text).toContain("Opening balance: 150,000 JPY.");
  });

  test("creates a card debited each month from the current account it names", async () => {
    const call = await connect();

    const created = await call({
      action: "create",
      name: "Deferred card",
      kind: "card",
      settles_into: "current account",
      opening_balance: "-120.40",
    });

    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain("Deferred card, deferred debit card in EUR");
    expect(created.text).toContain("Debited each month from: Current account.");
  });

  test("creates a benefit account whose credits are used soonest expiry first", async () => {
    const call = await connect();

    const created = await call({
      action: "create",
      name: "Gift vouchers",
      kind: "benefit",
      credit_order: "expiring_first",
    });

    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain("Credits are used soonest expiry first, as the issuer does.");
  });

  test("refuses a card without its current account, with a valid call", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "create", name: "Deferred card", kind: "card" }),
      "A card needs settles_into",
    );
  });

  test("refuses a current account for another kind than a card", async () => {
    const call = await connect();

    expectRefusal(
      await call({
        action: "create",
        name: "Pot",
        kind: "savings",
        settles_into: "Current account",
      }),
      "Only a card is debited from a current account",
    );
  });

  test("refuses a card debited from an account that is no open current account", async () => {
    const call = await connect();

    expectRefusal(
      await call({
        action: "create",
        name: "Deferred card",
        kind: "card",
        settles_into: "Savings",
      }),
      "must be one of the user's open current accounts",
    );
  });

  test("refuses a current account it cannot find, with the names to choose from", async () => {
    const call = await connect();

    const refused = await call({
      action: "create",
      name: "Deferred card",
      kind: "card",
      settles_into: "Joint account",
    });

    expectRefusal(refused, 'No account of the user\'s is named "Joint account"');
    expect(refused.text).toContain("Current account (Riverside Bank)");
  });

  test("refuses a currency outside ISO 4217's list, and writes nothing", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "create", name: "Odd", kind: "current", currency: "XYZ" }),
      "This is not a currency an account is opened in",
    );
    expect((await call({ action: "list" })).text).not.toContain("Odd");
  });

  test("refuses an opening balance that is no amount, or finer than its currency", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "create", name: "Odd", kind: "current", opening_balance: "12,50" }),
      "opening_balance",
    );

    expectRefusal(
      await call({
        action: "create",
        name: "Odd",
        kind: "current",
        currency: "JPY",
        opening_balance: "10.5",
      }),
      "at most 0 decimals",
    );
  });

  test("asks for the name and the kind", async () => {
    const call = await connect();

    expectRefusal(await call({ action: "create", kind: "current" }), "create needs name and kind");
    expectRefusal(await call({ action: "create", name: "Pot" }), "create needs name and kind");
    expectRefusal(await call({ action: "create", name: "  ", kind: "current" }), "needs a name");
  });
});

describe("accounts edit", () => {
  test("changes only what it is given, a new name and institution among them", async () => {
    const call = await connect();

    const edited = await call({
      action: "edit",
      name: "current account",
      new_name: "Everyday account",
      new_institution: "Northbank",
    });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Saved the changes to Current account (Riverside Bank).");
    expect(edited.text).toContain("Everyday account (Northbank), current account in EUR");
    expect(edited.text).toContain("Opening balance: 1,842.50 EUR.");

    const shown = await call({ action: "show", name: "Everyday account" });

    expect(shown.text).toContain("Everyday account (Northbank), current account in EUR");
    expect(shown.text).toContain("SALARY EXAMPLE CORP");
  });

  test("sets a benefit account's order of use", async () => {
    const call = await connect();

    const edited = await call({ action: "edit", name: "MealCard", credit_order: "expiring_first" });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Credits are used soonest expiry first, as the issuer does.");
  });

  test('sets a benefit account\'s top-up days and daily cap, "" for no cap (#28)', async () => {
    const call = await connect();

    const edited = await call({
      action: "edit",
      name: "MealCard",
      top_up_days: 1,
      top_up_cap: "25.00",
    });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("within 1 day joins the purchase; a daily cap of 25.00 EUR.");

    const cleared = await call({ action: "edit", name: "MealCard", top_up_cap: "" });

    expect(cleared.text).toContain("within 1 day joins the purchase; no daily cap known.");
  });

  test("asks for the daily cap again when a new currency has other decimals", async () => {
    const call = await connect();

    await call({ action: "edit", name: "MealCard", top_up_cap: "25.00" });

    expectRefusal(
      await call({ action: "edit", name: "MealCard", currency: "JPY" }),
      "give top_up_cap in JPY with the new currency",
    );
  });

  test("refuses a daily cap of nothing, or no amount", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "edit", name: "MealCard", top_up_cap: "0" }),
      "A daily cap is more than nothing.",
    );
    expectRefusal(
      await call({ action: "edit", name: "MealCard", top_up_cap: "lots" }),
      "top_up_cap",
    );
  });

  test("changes the currency of an account without a line yet", async () => {
    const call = await connect();
    const edited = await call({ action: "edit", name: "Savings", currency: "CHF" });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Savings (Riverside Bank), savings account in CHF");
  });

  test("refuses a new currency once the account has lines", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "edit", name: "Current account", currency: "USD" }),
      "The currency of Current account (Riverside Bank) cannot change",
    );
  });

  test("refuses an edit that changes nothing, and an account it cannot find", async () => {
    const call = await connect();

    expectRefusal(await call({ action: "edit", name: "Savings" }), "and what to change: kind,");

    expectRefusal(
      await call({ action: "edit", name: "Joint account", new_name: "Shared" }),
      'No account of the user\'s is named "Joint account"',
    );
  });

  test("turns a card into another kind, leaving its current account", async () => {
    const card = account("Deferred card", { kind: "card", settlesIntoAccountId: current.id });
    const call = await connect({ accounts: [current, card] });
    const edited = await call({ action: "edit", name: "Deferred card", kind: "current" });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Deferred card (Riverside Bank), current account in EUR");
    expect(edited.text).not.toContain("Debited each month from");
  });

  test("refuses a new currency that would read the opening balance in other digits, until it is given", async () => {
    const pot = account("Pot", { kind: "savings", openingBalanceMinor: 12_345 });
    const call = await connect({ accounts: [pot] });

    expectRefusal(
      await call({ action: "edit", name: "Pot", currency: "JPY" }),
      "give opening_balance in JPY with the new currency",
    );

    const edited = await call({
      action: "edit",
      name: "Pot",
      currency: "JPY",
      opening_balance: "12,345",
    });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Opening balance: 12,345 JPY.");
  });

  test("edits an account whose stored currency is off the list, which only a given currency is held to", async () => {
    const call = await connect({ accounts: [account("Indexed", { currency: "CLF" })] });
    const edited = await call({ action: "edit", name: "Indexed", new_name: "Indexed savings" });

    expect(edited.isError, edited.text).toBe(false);
    expect(edited.text).toContain("Indexed savings (Riverside Bank), current account in CLF");
  });

  test("refuses a card's current account on edit as on create", async () => {
    const card = account("Deferred card", { kind: "card", settlesIntoAccountId: current.id });
    const call = await connect({ accounts: [current, savings, card] });

    expectRefusal(
      await call({ action: "edit", name: "Current account", kind: "card" }),
      "A card needs settles_into",
    );
    expectRefusal(
      await call({ action: "edit", name: "Savings", settles_into: "Current account" }),
      "Only a card is debited from a current account",
    );
    expectRefusal(
      await call({ action: "edit", name: "Deferred card", settles_into: "Savings" }),
      "must be one of the user's open current accounts",
    );
  });

  test("refuses an empty new name", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "edit", name: "Savings", new_name: "  " }),
      "These settings are not valid: An account needs a name.",
    );
  });

  test('sets the category of an account kept by its balance by name, "" for none (#31)', async () => {
    const call = await connect();
    const cleared = await call({ action: "edit", name: "Mortgage", category: "" });

    expect(cleared.isError, cleared.text).toBe(false);
    expect(cleared.text).toContain(
      "No category is chosen for them: each goes to its kind's fallback.",
    );

    // The categories tool lists the names an account's category is chosen from.
    const refused = await call({ action: "edit", name: "Mortgage", category: "Nowhere" });

    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text).toMatch(/A valid call: categories \{"action":"list"\}$/);
    expect(refused.text.length).toBeLessThan(2000);
  });

  test("refuses a name two accounts share, until the institution tells them apart", async () => {
    const call = await connect({
      accounts: [account("Livret A"), account("Livret A", { institution: "Northbank" })],
    });

    const refused = await call({ action: "close", name: "Livret A" });

    expectRefusal(refused, "Livret A (Riverside Bank), Livret A (Northbank). Add institution");
    expect(refused.text).toContain(
      'A valid call: accounts {"action":"close","name":"Livret A","institution":"Riverside Bank"}',
    );

    const closed = await call({ action: "close", name: "Livret A", institution: "northbank" });

    expect(closed.isError, closed.text).toBe(false);
    expect(closed.text).toContain("Closed Livret A (Northbank)");
  });
});

describe("accounts close and reopen", () => {
  test("closes an account on a day, out of the totals, and reopens it", async () => {
    const call = await connect();
    const closed = await call({ action: "close", name: "Savings", closed_on: "2026-11-01" });

    expect(closed.isError, closed.text).toBe(false);
    expect(closed.text).toContain(
      "Closed Savings (Riverside Bank) on 2026-11-01: it keeps its lines and leaves the totals.",
    );
    expect((await call({ action: "list" })).text).toContain(
      "- Savings (Riverside Bank), savings account, closed on 2026-11-01: 0.00 EUR.",
    );

    const reopened = await call({ action: "reopen", name: "Savings" });

    expect(reopened.isError, reopened.text).toBe(false);
    expect(reopened.text).toContain(
      "Reopened Savings (Riverside Bank): it counts in the totals again.",
    );
    expect((await call({ action: "list" })).text).not.toContain("Closed accounts");
  });

  test("closes on today when no day is given", async () => {
    const call = await connect();
    const closed = await call({ action: "close", name: "Savings" });

    expect(closed.text).toContain(`Closed Savings (Riverside Bank) on ${TODAY}`);
  });

  test("refuses closing a closed account and reopening an open one", async () => {
    const call = await connect({ accounts: [account("Old savings", { closedOn: "2025-06-30" })] });

    expectRefusal(
      await call({ action: "close", name: "Old savings" }),
      "Old savings (Riverside Bank) is closed already, since 2025-06-30",
    );

    const open = await connect();

    expectRefusal(
      await open({ action: "reopen", name: "Savings" }),
      "Savings (Riverside Bank) is open",
    );
  });

  test("refuses a day that is not in the calendar", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "close", name: "Savings", closed_on: "2026-02-30" }),
      "This day is not in the calendar",
    );
  });
});

describe("accounts note_balance", () => {
  test("notes a balance-mode account's balance, which list then gives", async () => {
    const call = await connect();

    const noted = await call({
      action: "note_balance",
      name: "Mortgage",
      day: "2026-10-31",
      balance: "-149,500.00",
    });

    expect(noted.isError, noted.text).toBe(false);
    expect(noted.text).toContain(
      "Noted: Mortgage (Riverside Bank) held -149,500.00 EUR at the end of 2026-10-31.",
    );
    expect((await call({ action: "list" })).text).toContain(
      "- Mortgage (Riverside Bank), loan, kept by a noted balance: -149,500.00 EUR;",
    );
  });

  test("refuses an account kept by its lines, a second balance on a day, and no balance", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "note_balance", name: "Current account", day: TODAY, balance: "10" }),
      "Current account (Riverside Bank) is kept by its lines",
    );

    const once = { action: "note_balance", name: "Mortgage", day: "2026-10-31", balance: "-10" };

    expect((await call(once)).isError).toBe(false);
    expectRefusal(await call(once), "already has a balance noted on 2026-10-31");
    expectRefusal(await call({ action: "note_balance", name: "Mortgage" }), "note_balance needs");
  });

  test("refuses a balance that is no amount in the account's currency", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "note_balance", name: "Mortgage", balance: "about 10k" }),
      'balance must be an amount such as -1234.56 or -1,234.56, a decimal in EUR with a point for decimals; "about 10k" is not.',
    );
  });
});

describe("accounts set_expiry", () => {
  test("sets when a benefit account's credit expires, then takes it away", async () => {
    const call = await connect();

    const set = await call({ action: "set_expiry", line: credit.id, expires_on: "2027-01-31" });

    expect(set.isError, set.text).toBe(false);
    expect(set.text).toContain(
      "The credit of 2026-10-05 on MealCard (MealCard), MEALCARD CREDIT, now expires on 2027-01-31.",
    );
    expect(set.text).toContain("- 2027-01-31: 167.50 EUR expires.");

    const removed = await call({ action: "set_expiry", line: credit.id, expires_on: "" });

    expect(removed.isError, removed.text).toBe(false);
    expect(removed.text).toContain("now has no expiry");
    expect(removed.text).toContain("What expires when: no credit left has an expiry.");
  });

  test("refuses an expiry before the credit, a line that is no credit and an unknown line", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "set_expiry", line: credit.id, expires_on: "2026-10-01" }),
      "cannot expire before the day it was credited, 2026-10-05",
    );
    expectRefusal(
      await call({ action: "set_expiry", line: spent.id, expires_on: "2027-01-31" }),
      "This line is no credit of a benefit account",
    );
    expectRefusal(
      await call({ action: "set_expiry", line: memoryId(), expires_on: "2027-01-31" }),
      "No line of the user's has this handle",
    );
    expectRefusal(
      await call({ action: "set_expiry", line: "not-a-handle", expires_on: "2027-01-31" }),
      "No line of the user's has this handle",
    );
    expectRefusal(
      await call({ action: "set_expiry", line: credit.id, expires_on: "next year" }),
      'expires_on is a day, YYYY-MM-DD, or "" to take the expiry away',
    );
  });

  test("points an unknown line to the search that gives the handles", async () => {
    const call = await connect();

    for (const line of [memoryId(), "not-a-handle", spent.id]) {
      const refused = await call({ action: "set_expiry", line, expires_on: "2027-01-31" });

      expect(refused.text).toMatch(/A valid call: lines \{"action":"search"\}$/);
    }
  });

  test("asks for the line and the day, with a call that works", async () => {
    const call = await connect();

    const neither = await call({ action: "set_expiry" });

    expectRefusal(neither, "set_expiry needs line and expires_on");
    expect(neither.text).toMatch(/A valid call: lines \{"action":"search"\}$/);

    const noDay = await call({ action: "set_expiry", line: credit.id });

    expectRefusal(noDay, "set_expiry needs line and expires_on");

    const written = /A valid call: accounts (\{.*\})$/.exec(noDay.text)?.[1] ?? "{}";
    const suggested = Schema.decodeUnknownSync(Suggested)(JSON.parse(written));

    expect(suggested.line).toBe(credit.id);
    expect((await call(suggested)).isError).toBe(false);
  });
});

/** A set_expiry call a refusal suggests, read back. */
const Suggested = Schema.Struct({
  action: Schema.String,
  line: Schema.String,
  expires_on: Schema.String,
});

describe("the write scope", () => {
  test.each<Arguments>([
    { action: "create", name: "Pot", kind: "savings" },
    { action: "edit", name: "Savings", new_name: "Pot" },
    { action: "close", name: "Savings" },
    { action: "reopen", name: "Savings" },
    { action: "note_balance", name: "Mortgage", day: TODAY, balance: "1" },
    { action: "set_expiry", line: credit.id, expires_on: "2027-01-31" },
  ])("refuses $action to a token that only reads, saying how to get it", async (args) => {
    const call = await connect(ROWS, reader);
    const refused = await call(args);

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("choose Read and write on Gousset's consent page");

    const listed = await call({ action: "list" });

    expect(listed.text).not.toContain("Pot");
    expect(listed.text).not.toContain("Closed accounts");
  });
});

describe("the accounts tool, writing", () => {
  test("says it writes, that a repeat is not harmless, and shows how to create", () => {
    expect(accountsTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(accountsTool.description).toContain('{"action":"create",');
    expect(accountsTool.description.length).toBeLessThan(2048);
  });
});
