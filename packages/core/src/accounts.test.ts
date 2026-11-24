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
  setCreditExpiry,
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
    creditOrder: "oldest_first",
    balanceCategoryId: null,
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

  test("never lists a line booked after today: the newest shown agrees with the balance", async () => {
    const future = line(current.id, "2026-11-30", 777, "AFTER TODAY");

    const detail = await inOrder(
      { accounts: [current], lines: [...lines, future] },
      showAccount(ADA, current.id),
    );

    expect(detail.lines.map((each) => each.bookedOn)).toEqual([
      "2026-11-02",
      "2026-11-02",
      "2026-10-20",
      "2026-10-05",
    ]);
    expect(detail.lines[0]?.balanceAfter).toEqual(detail.balance);
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
      earlierMismatches: [],
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

  test("surfaces an earlier statement balance that disagrees, even once the latest agrees", async () => {
    const rowsWithEarlierMismatch: MemoryRows = {
      accounts: [current],
      lines,
      balances: [
        // The app counts 9000 at the end of 2026-10-05 (opening 10,000 minus the 1000 line): the
        // bank said 8800, a difference the latest (agreeing) statement does not show.
        { accountId: current.id, day: "2026-10-05", minor: 8800, source: "statement" },
        { accountId: current.id, day: "2026-10-31", minor: 14_000, source: "statement" },
      ],
    };

    const { check } = await inOrder(rowsWithEarlierMismatch, showAccount(ADA, current.id));

    expect(check?.agrees).toBe(true);
    expect(check?.earlierMismatches).toEqual([
      {
        day: "2026-10-05",
        statement: { minor: 8800, currency: "EUR" },
        app: { minor: 9000, currency: "EUR" },
        difference: { minor: 200, currency: "EUR" },
      },
    ]);
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

const credit = (accountId: string, bookedOn: string, amountMinor: number, expiresOn: string) => ({
  ...line(accountId, bookedOn, amountMinor, "MEALCARD CREDIT"),
  expiresOn,
});

describe("benefit accounts", () => {
  test("a benefit account kept by its lines gives its credits left, in order of use, and what expires when", async () => {
    const meal = accountOf("MealCard", "benefit", { institution: "MealCard" });
    const older = credit(meal.id, "2026-01-05", 10_000, "2027-01-31");
    const newer = credit(meal.id, "2026-02-05", 10_000, "2026-12-31");

    const rows: MemoryRows = {
      accounts: [meal],
      lines: [older, newer, line(meal.id, "2026-02-10", -12_500, "CB GREENMARKET")],
    };

    const detail = await inOrder(rows, showAccount(ADA, meal.id));

    expect(detail.credits).toEqual({
      order: "oldest_first",
      open: [
        {
          lineId: newer.id,
          creditedOn: "2026-02-05",
          label: "MEALCARD CREDIT",
          amount: { minor: 10_000, currency: "EUR" },
          left: { minor: 7500, currency: "EUR" },
          expiresOn: "2026-12-31",
        },
      ],
      expiring: [{ day: "2026-12-31", amount: { minor: 7500, currency: "EUR" } }],
      uncovered: { minor: 0, currency: "EUR" },
    });
    expect(detail.lines.find((each) => each.id === newer.id)?.expiresOn).toBe("2026-12-31");

    const issuer = await inOrder(
      { ...rows, accounts: [{ ...meal, creditOrder: "expiring_first" }] },
      showAccount(ADA, meal.id),
    );

    expect(issuer.credits?.order).toBe("expiring_first");
    expect(issuer.credits?.open.map((each) => [each.creditedOn, each.left.minor])).toEqual([
      ["2026-01-05", 7500],
    ]);
  });

  test("never counts a credit booked after today", async () => {
    const meal = accountOf("MealCard", "benefit");

    const detail = await inOrder(
      { accounts: [meal], lines: [credit(meal.id, "2026-12-01", 5000, "2027-12-31")] },
      showAccount(ADA, meal.id),
    );

    expect(detail.credits?.open).toEqual([]);
  });

  test("no credits for a benefit account kept by its balance, nor for another kind", async () => {
    const kept = accountOf("Gift card", "benefit", { mode: "balance" });
    const current = accountOf("Current account", "current");
    const rows: MemoryRows = { accounts: [kept, current] };

    expect((await inOrder(rows, showAccount(ADA, kept.id))).credits).toBeNull();
    expect((await inOrder(rows, showAccount(ADA, current.id))).credits).toBeNull();
  });

  test("an account's page gives its order of use, even kept by its balance", async () => {
    const kept = accountOf("Gift card", "benefit", {
      mode: "balance",
      creditOrder: "expiring_first",
    });

    const detail = await inOrder({ accounts: [kept] }, showAccount(ADA, kept.id));

    expect(detail.account.creditOrder).toBe("expiring_first");
  });

  test("an account's credit order is oldest first unless given, and kept by an edit that leaves it out", async () => {
    const outcome = await inOrder(
      {},
      Effect.gen(function* () {
        const plain = yield* createAccount(ADA, input("benefit"));

        const issuer = yield* createAccount(
          ADA,
          input("benefit", { creditOrder: "expiring_first" }),
        );

        const kept = yield* editAccount(ADA, issuer.id, input("benefit", { name: "Renamed" }));

        const changed = yield* editAccount(
          ADA,
          issuer.id,
          input("benefit", { creditOrder: "oldest_first" }),
        );

        return { plain, issuer, kept, changed };
      }),
    );

    expect(outcome.plain.creditOrder).toBe("oldest_first");
    expect(outcome.issuer.creditOrder).toBe("expiring_first");
    expect(outcome.kept.creditOrder).toBe("expiring_first");
    expect(outcome.changed.creditOrder).toBe("oldest_first");
  });

  test("an edit that leaves out the category keeps it, and null clears it", async () => {
    const card = accountOf("Gift card", "benefit", {
      mode: "balance",
      balanceCategoryId: "00000000-0000-7000-8000-00000000c001",
    });

    const outcome = await inOrder(
      { accounts: [card] },
      Effect.gen(function* () {
        const kept = yield* editAccount(
          ADA,
          card.id,
          input("benefit", { name: "Renamed", mode: "balance" }),
        );

        const cleared = yield* editAccount(
          ADA,
          card.id,
          input("benefit", { mode: "balance", balanceCategoryId: null }),
        );

        return { kept, cleared };
      }),
    );

    expect(outcome.kept.name).toBe("Renamed");
    expect(outcome.kept.balanceCategoryId).toBe("00000000-0000-7000-8000-00000000c001");
    expect(outcome.cleared.balanceCategoryId).toBeNull();
  });

  test("moving money from the current account to a benefit account moves it from available to restricted", async () => {
    const current = accountOf("Current account", "current", { openingBalanceMinor: 100_000 });
    const meal = accountOf("MealCard", "benefit");
    const before = await inOrder({ accounts: [current, meal] }, listAccounts(ADA));

    const after = await inOrder(
      {
        accounts: [current, meal],
        lines: [
          line(current.id, "2026-11-10", -5000, "TRANSFER TO MEALCARD"),
          line(meal.id, "2026-11-10", 5000, "TOP-UP FROM CURRENT ACCOUNT"),
        ],
      },
      listAccounts(ADA),
    );

    const totals = (list: typeof before, group: string) =>
      list.groups.find((each) => each.group === group)?.totals[0]?.minor ?? 0;

    expect(totals(after, "available")).toBe(totals(before, "available") - 5000);
    expect(totals(after, "restricted")).toBe(totals(before, "restricted") + 5000);
  });

  describe("setCreditExpiry", () => {
    const meal = accountOf("MealCard", "benefit");
    const current = accountOf("Current account", "current");
    const topUp = line(meal.id, "2026-11-02", 18_000, "MEALCARD CREDIT");
    const payment = line(meal.id, "2026-11-05", -1200, "CB CORNER CAFE");

    const held = {
      ...line(meal.id, "2026-11-06", 18_000, "MEALCARD CREDIT"),
      state: "held" as const,
    };

    const salary = line(current.id, "2026-11-01", 250_000, "SALARY");
    const rows: MemoryRows = { accounts: [meal, current], lines: [topUp, payment, held, salary] };

    const outcome = (lineId: string, expiresOn: string | null, owner = ADA) =>
      inOrder(
        rows,
        setCreditExpiry(owner, lineId, expiresOn).pipe(
          Effect.match({
            onSuccess: (set) => set.expiresOn ?? "none",
            onFailure: (error) => error._tag,
          }),
        ),
      );

    test("sets a credit's expiry, shown on its line and among what expires, and takes it away", async () => {
      const shown = await inOrder(
        rows,
        Effect.gen(function* () {
          yield* setCreditExpiry(ADA, topUp.id, "2027-01-31");

          const set = yield* showAccount(ADA, meal.id);

          yield* setCreditExpiry(ADA, topUp.id, null);

          return { set, cleared: yield* showAccount(ADA, meal.id) };
        }),
      );

      expect(shown.set.lines.find((each) => each.id === topUp.id)?.expiresOn).toBe("2027-01-31");
      expect(shown.set.credits?.expiring).toEqual([
        { day: "2027-01-31", amount: { minor: 16_800, currency: "EUR" } },
      ]);
      expect(shown.cleared.credits?.expiring).toEqual([]);
    });

    test("an expiry may be the day credited, never before it", async () => {
      expect(await outcome(topUp.id, "2026-11-02")).toBe("2026-11-02");
      expect(await outcome(topUp.id, "2026-11-01")).toBe("ExpiryBeforeCredit");
    });

    test("refuses a line that is no credit of a benefit account", async () => {
      expect(await outcome(payment.id, "2027-01-31")).toBe("NotACredit");
      expect(await outcome(held.id, "2027-01-31")).toBe("NotACredit");
      expect(await outcome(salary.id, "2027-01-31")).toBe("NotACredit");
    });

    test("refuses a line the user does not have", async () => {
      expect(await outcome(memoryId(), "2027-01-31")).toBe("LineNotFound");
      expect(await outcome(topUp.id, "2027-01-31", "grace")).toBe("LineNotFound");
    });
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
