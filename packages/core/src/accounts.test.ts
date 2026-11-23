import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import type { AccountRecord } from "./account-store";
import { memoryAccountStore, memoryId } from "./account-store-memory";
import type { MemoryRows } from "./account-store-memory";
import type { AccountStore } from "./account-store";
import { ACCOUNT_CHOICES, AccountInput, choiceOf, storedAs } from "./account-values";
import type { AccountChoice } from "./account-values";
import {
  closeAccount,
  createAccount,
  editAccount,
  listAccounts,
  noteBalance,
  reopenAccount,
  showAccount,
} from "./accounts";

const TODAY = "2026-11-23";
const ADA = "ada";

/** Runs `effect` today, on a store of Ada's that holds `rows`. */
function inOrder<A, E>(rows: MemoryRows, effect: Effect.Effect<A, E, AccountStore>) {
  const layer = Layer.mergeAll(memoryAccountStore(new Map([[ADA, rows]])), TestClock.layer());

  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

      return yield* effect;
    }).pipe(Effect.provide(layer)),
  );
}

function accountOf(
  name: string,
  choice: AccountChoice,
  change: Partial<AccountRecord> = {},
): AccountRecord {
  return {
    id: memoryId(),
    name,
    ...storedAs(choice),
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

const line = (
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  label = "CB CORNER CAFE",
) => ({
  id: memoryId(),
  accountId,
  bookedOn,
  valueOn: null,
  amountMinor,
  label,
  memo: null,
  counterpartyName: null,
});

const input = (choice: AccountChoice, change: Partial<typeof AccountInput.Encoded> = {}) =>
  Schema.decodeUnknownSync(AccountInput)({
    name: "  Joint account  ",
    choice,
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    ...change,
  });

describe("choices", () => {
  test("each choice is stored as its kind and envelope, and read back as itself", () => {
    for (const choice of ACCOUNT_CHOICES) {
      const { kind, envelope } = storedAs(choice);

      expect(choiceOf(kind, envelope)).toBe(choice);
    }

    expect(storedAs("pea")).toEqual({ kind: "investment", envelope: "pea" });
    expect(storedAs("life_insurance")).toEqual({ kind: "investment", envelope: "life_insurance" });
    expect(storedAs("securities")).toEqual({ kind: "investment", envelope: null });
    expect(storedAs("livret_a")).toEqual({ kind: "savings", envelope: "livret_a" });
  });
});

describe("listAccounts", () => {
  test("gives each group its accounts and totals per currency, the closed apart", async () => {
    const current = accountOf("Current account", "current", { openingBalanceMinor: 100_000 });
    const livret = accountOf("Livret A", "livret_a", { openingBalanceMinor: 1_250_000 });
    const meal = accountOf("MealCard", "benefit", { institution: "MealCard" });
    const brokerage = accountOf("Brokerage", "securities", { currency: "USD", mode: "balance" });

    const old = accountOf("Old savings", "savings", {
      closedOn: "2025-06-30",
      openingBalanceMinor: 99,
    });

    const rows: MemoryRows = {
      accounts: [current, livret, meal, brokerage, old],
      lines: [
        line(current.id, "2026-11-02", -2500),
        line(current.id, "2026-11-20", 250_000, "SALARY"),
        // Booked after today, and set aside as a near duplicate: neither counts.
        line(current.id, "2026-11-30", -9999),
        { ...line(current.id, "2026-11-21", -2500), state: "held" as const },
        line(meal.id, "2026-11-03", 18_000, "MEALCARD CREDIT"),
      ],
      balances: [
        { accountId: brokerage.id, day: "2026-10-31", minor: 520_000, source: "noted" },
        { accountId: brokerage.id, day: "2026-11-30", minor: 999_999, source: "noted" },
      ],
      imports: [
        { accountId: current.id, status: "done", periodTo: "2026-10-31" },
        { accountId: current.id, status: "done", periodTo: "2026-11-20" },
        { accountId: current.id, status: "failed", periodTo: "2026-11-22" },
      ],
    };

    const list = await inOrder(rows, listAccounts(ADA));

    expect(list.day).toBe(TODAY);
    expect(
      list.groups.map((group) => [group.group, group.accounts.map((each) => each.name)]),
    ).toEqual([
      ["available", ["Current account"]],
      ["restricted", ["MealCard"]],
      ["invested", ["Brokerage", "Livret A"]],
      ["owed", []],
    ]);

    const [available, restricted, invested, owed] = list.groups;

    expect(available?.accounts[0]?.balance).toEqual({ minor: 347_500, currency: "EUR" });
    expect(available?.accounts[0]?.statementsUntil).toEqual({ day: "2026-11-20", from: "import" });
    expect(restricted?.totals).toEqual([{ minor: 18_000, currency: "EUR" }]);
    // Kept by balance: the latest noted balance up to today.
    expect(invested?.totals).toEqual([
      { minor: 1_250_000, currency: "EUR" },
      { minor: 520_000, currency: "USD" },
    ]);
    expect(invested?.accounts[1]?.choice).toBe("livret_a");
    expect(owed?.totals).toEqual([]);
    expect(list.closed.map((each) => [each.name, each.closedOn])).toEqual([
      ["Old savings", "2025-06-30"],
    ]);
  });

  test("says when a statement balance is all that tells how far the statements go", async () => {
    const current = accountOf("Current account", "current");

    const list = await inOrder(
      {
        accounts: [current],
        balances: [{ accountId: current.id, day: "2026-10-31", minor: 0, source: "statement" }],
      },
      listAccounts(ADA),
    );

    expect(list.groups[0]?.accounts[0]?.statementsUntil).toEqual({
      day: "2026-10-31",
      from: "statement_balance",
    });
  });
});

describe("showAccount", () => {
  const current = accountOf("Current account", "current", { openingBalanceMinor: 10_000 });

  const lines = [
    line(current.id, "2026-10-05", -1000),
    line(current.id, "2026-10-20", 5000, "SALARY"),
    line(current.id, "2026-11-02", -300),
    line(current.id, "2026-11-02", -200),
  ];

  const rows = (statementMinor: number): MemoryRows => ({
    accounts: [current],
    lines,
    balances: [
      { accountId: current.id, day: "2026-09-30", minor: 10_000, source: "statement" },
      { accountId: current.id, day: "2026-10-31", minor: statementMinor, source: "statement" },
    ],
  });

  const show = (statementMinor: number, view = {}) =>
    inOrder(rows(statementMinor), showAccount(ADA, current.id, view));

  test("gives the balance today and the lines newest first, each with the balance after it", async () => {
    const detail = await show(14_000);

    expect(detail.balance).toEqual({ minor: 13_500, currency: "EUR" });
    expect(
      detail.lines.map((each) => [each.bookedOn, each.amount.minor, each.balanceAfter?.minor]),
    ).toEqual([
      ["2026-11-02", -200, 13_500],
      ["2026-11-02", -300, 13_700],
      ["2026-10-20", 5000, 14_000],
      ["2026-10-05", -1000, 9000],
    ]);
    expect(detail.olderBefore).toBeNull();
  });

  test("reads older lines from where a page stopped", async () => {
    const first = await show(14_000, { limit: 2 });

    expect(first.lines.map((each) => each.balanceAfter?.minor)).toEqual([13_500, 13_700]);
    expect(first.olderBefore).toBe(first.lines[1]?.id);

    const second = await show(14_000, { limit: 2, before: first.olderBefore ?? "" });

    expect(second.lines.map((each) => each.balanceAfter?.minor)).toEqual([14_000, 9000]);
    expect(second.olderBefore).toBeNull();
  });

  test("agrees with the statement when the app counts the same at the end of its day", async () => {
    const { check } = await show(14_000);

    expect(check).toEqual({
      day: "2026-10-31",
      statement: { minor: 14_000, currency: "EUR" },
      app: { minor: 14_000, currency: "EUR" },
      difference: { minor: 0, currency: "EUR" },
      agrees: true,
    });
  });

  test("gives the difference when the statement says otherwise", async () => {
    const { check } = await show(14_750);

    expect(check?.agrees).toBe(false);
    expect(check?.difference).toEqual({ minor: -750, currency: "EUR" });
  });

  test("has no check without a statement balance", async () => {
    const detail = await inOrder({ accounts: [current], lines }, showAccount(ADA, current.id));

    expect(detail.check).toBeNull();
  });

  test("gives the current month's counted money in and out, from the 1st to today", async () => {
    const spending = accountOf("Spending", "current");

    const detail = await inOrder(
      {
        accounts: [spending],
        lines: [
          // Last month: out of the range.
          line(spending.id, "2026-10-31", 9999),
          line(spending.id, "2026-11-01", 2000, "SALARY"),
          line(spending.id, "2026-11-10", -700),
          line(spending.id, "2026-11-23", -300),
          // After today: out of the range.
          line(spending.id, "2026-11-24", -1),
        ],
      },
      showAccount(ADA, spending.id),
    );

    expect(detail.monthIn).toEqual({ minor: 2000, currency: "EUR" });
    expect(detail.monthOut).toEqual({ minor: 1000, currency: "EUR" });
  });

  test("gives the balance at the end of every day of the last 90 by default", async () => {
    const { daily } = await show(14_000);

    expect(daily.from).toBe("2026-08-26");
    expect(daily.to).toBe(TODAY);
    expect(daily.balances).toHaveLength(90);
    expect(daily.balances[0]).toEqual({ day: "2026-08-26", minor: 10_000 });
    expect(daily.balances.find((each) => each.day === "2026-10-05")?.minor).toBe(9000);
    expect(daily.balances.find((each) => each.day === "2026-10-31")?.minor).toBe(14_000);
    expect(daily.balances.at(-1)).toEqual({ day: TODAY, minor: 13_500 });
  });

  const refused = (view: { from: string; to: string }) =>
    inOrder(rows(0), Effect.flip(showAccount(ADA, current.id, view)));

  test("refuses days that run backwards or cover more than a chart does", async () => {
    expect((await refused({ from: "2026-11-02", to: "2026-11-01" }))._tag).toBe("DayRangeRefused");
    expect((await refused({ from: "2025-01-01", to: "2026-11-01" }))._tag).toBe("DayRangeRefused");
  });

  test("refuses an account the user does not have", async () => {
    const error = await inOrder(rows(0), Effect.flip(showAccount(ADA, memoryId())));

    expect(error._tag).toBe("AccountNotFound");
  });

  test("an account kept by its balance gives no balance after a line", async () => {
    const kept = { ...current, mode: "balance" as const };

    const detail = await inOrder(
      {
        accounts: [kept],
        lines,
        balances: [{ accountId: kept.id, day: "2026-11-01", minor: 42_000, source: "noted" }],
      },
      showAccount(ADA, kept.id),
    );

    expect(detail.balance.minor).toBe(42_000);
    expect(detail.lines.every((each) => each.balanceAfter === null)).toBe(true);
    expect(detail.daily.balances.find((each) => each.day === "2026-10-31")?.minor).toBe(10_000);
    expect(detail.daily.balances.at(-1)?.minor).toBe(42_000);
  });
});

describe("writes", () => {
  test("creates an account of every choice, trimmed, shown in its group", async () => {
    for (const choice of ACCOUNT_CHOICES) {
      const current = accountOf("Current account", "current");

      const list = await inOrder(
        { accounts: [current] },
        Effect.gen(function* () {
          yield* createAccount(
            ADA,
            input(choice, choice === "card" ? { settlesIntoAccountId: current.id } : {}),
          );

          return yield* listAccounts(ADA);
        }),
      );

      const created = list.groups
        .flatMap((group) => group.accounts.map((each) => ({ ...each, listedIn: group.group })))
        .find((each) => each.name === "Joint account");

      expect(created?.choice, choice).toBe(choice);
      expect(created?.listedIn, choice).toBe(created?.group);
    }
  });

  test("a card needs one of the user's open current accounts, and only a card has one", async () => {
    const current = accountOf("Current account", "current");
    const closed = accountOf("Old current account", "current", { closedOn: "2025-01-31" });
    const savings = accountOf("Savings", "savings");
    const accounts = [current, closed, savings];

    const reason = (given: ReturnType<typeof input>) =>
      inOrder(
        { accounts },
        createAccount(ADA, given).pipe(
          Effect.map(() => "created"),
          Effect.catchTag("SettlementRefused", (refused) => Effect.succeed(refused.reason)),
        ),
      );

    expect(await reason(input("card"))).toBe("required");
    expect(await reason(input("card", { settlesIntoAccountId: closed.id }))).toBe(
      "not_open_current",
    );
    expect(await reason(input("card", { settlesIntoAccountId: savings.id }))).toBe(
      "not_open_current",
    );
    expect(await reason(input("card", { settlesIntoAccountId: memoryId() }))).toBe(
      "not_open_current",
    );
    expect(await reason(input("current", { settlesIntoAccountId: current.id }))).toBe(
      "only_a_card",
    );
  });

  test("an account's currency is fixed once it has a line", async () => {
    const empty = accountOf("Empty", "current");
    const used = accountOf("Used", "current");

    const outcome = (accountId: string) =>
      inOrder(
        { accounts: [empty, used], lines: [line(used.id, "2026-11-01", -100)] },
        editAccount(ADA, accountId, input("current", { currency: "USD" })).pipe(
          Effect.match({
            onSuccess: (account) => account.currency,
            onFailure: (error) => error._tag,
          }),
        ),
      );

    expect(await outcome(empty.id)).toBe("USD");
    expect(await outcome(used.id)).toBe("CurrencyLocked");
  });

  test("closes an account on a day, out of the totals, and reopens it", async () => {
    const current = accountOf("Current account", "current", { openingBalanceMinor: 500 });

    const outcome = await inOrder(
      { accounts: [current] },
      Effect.gen(function* () {
        yield* closeAccount(ADA, current.id, "2026-11-01");

        const closed = yield* listAccounts(ADA);
        const twice = yield* Effect.flip(closeAccount(ADA, current.id, "2026-11-02"));

        yield* reopenAccount(ADA, current.id);

        const reopened = yield* listAccounts(ADA);
        const again = yield* Effect.flip(reopenAccount(ADA, current.id));

        return { closed, twice, reopened, again };
      }),
    );

    expect(outcome.closed.groups[0]?.totals).toEqual([]);
    expect(outcome.closed.closed[0]?.closedOn).toBe("2026-11-01");
    expect(outcome.twice._tag).toBe("AccountAlreadyClosed");
    expect(outcome.reopened.groups[0]?.totals).toEqual([{ minor: 500, currency: "EUR" }]);
    expect(outcome.again._tag).toBe("AccountNotClosed");
  });

  test("notes one balance a day on an account kept by its balance, and only there", async () => {
    const loan = accountOf("Mortgage", "loan", {
      mode: "balance",
      openingBalanceMinor: -9_000_000,
    });

    const current = accountOf("Current account", "current");

    const outcome = await inOrder(
      { accounts: [loan, current] },
      Effect.gen(function* () {
        yield* noteBalance(ADA, loan.id, "2026-10-31", -8_950_000);

        const twice = yield* Effect.flip(noteBalance(ADA, loan.id, "2026-10-31", -8_900_000));
        const byLines = yield* Effect.flip(noteBalance(ADA, current.id, "2026-10-31", 0));
        const list = yield* listAccounts(ADA);

        return { twice, byLines, list };
      }),
    );

    expect(outcome.twice._tag).toBe("BalanceAlreadyNoted");
    expect(outcome.byLines._tag).toBe("AccountKeptByLines");
    expect(outcome.list.groups[3]?.totals).toEqual([{ minor: -8_950_000, currency: "EUR" }]);
  });
});

describe("AccountInput", () => {
  const decode = Schema.decodeUnknownExit(AccountInput);

  const base = {
    name: "Current",
    choice: "current",
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
  };

  test("trims the name and refuses an empty one", () => {
    expect(input("current").name).toBe("Joint account");
    expect(decode({ ...base, name: "   " })._tag).toBe("Failure");
  });

  test("refuses a currency, an amount or a day written another way", () => {
    expect(decode({ ...base, currency: "eur" })._tag).toBe("Failure");
    expect(decode({ ...base, openingBalanceMinor: 12.5 })._tag).toBe("Failure");
    expect(decode({ ...base, openedOn: "2026-02-30" })._tag).toBe("Failure");
    expect(decode({ ...base, openedOn: "31/10/2026" })._tag).toBe("Failure");
    expect(decode({ ...base, openedOn: "2026-10-31" })._tag).toBe("Success");
  });
});
