import {
  AccountNotFound,
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Investments,
  Merchants,
  MonthFacts,
  NotAnInvestmentAccount,
  OperationNotFound,
  RuleJobs,
  SecurityNotFound,
  SecurityNotOnAccount,
  Subscriptions,
  Transfers,
  checkOperation,
  memoryAccountStore,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type {
  AccountRecord,
  CheckedOperation,
  MemoryRows,
  OperationRead,
  PositionDetail,
  PositionRead,
  SecurityRead,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Caller } from "../tool";

// Issue #250: the investments tool through the official client, on an in-memory store of made-up
// accounts and a fake `Investments` that checks each operation as the core does (`checkOperation`)
// and keeps what each call writes. Every ISIN is invented (country code XX).

const TODAY = "2026-11-23";
const writer: Caller = { userId: "ines", canWrite: true, currency: "EUR" };
const reader: Caller = { userId: "ines", canWrite: false, currency: "EUR" };

type Arguments = { readonly [key: string]: string | number };

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function account(name: string, change: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: memoryId(),
    name,
    kind: "investment",
    envelope: "pea",
    institution: "Northbank",
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

const pea = account("Northbank PEA");
const kept = account("Old PEA", { mode: "balance", openingBalanceMinor: 500_000 });
const life = account("Harbour Life", { envelope: "life_insurance", institution: "Harbour" });
const current = account("Current account", { kind: "current", envelope: null });

const ROWS: MemoryRows = {
  accounts: [pea, kept, life, current],
  lines: [
    {
      id: memoryId(),
      accountId: pea.id,
      bookedOn: "2026-10-12",
      valueOn: null,
      amountMinor: 100_000,
      label: "DEPOSIT",
      memo: null,
      counterpartyName: null,
    },
  ],
};

const WORLD: SecurityRead = {
  id: idOf(101),
  isin: "XX0000000002",
  name: "World Index ETF",
  currency: "EUR",
};

const EMERGING: SecurityRead = {
  id: idOf(102),
  isin: "XX0000000010",
  name: "Emerging Markets ETF",
  currency: "EUR",
};

/** Sold out: no open position, its operations stay. */
const SOLD: SecurityRead = {
  id: idOf(103),
  isin: "XX0000000028",
  name: "Sold Fund",
  currency: "EUR",
};

const euros = (minor: number) => ({ minor, currency: "EUR" });

const POSITIONS: ReadonlyArray<{ readonly accountId: string; readonly position: PositionRead }> = [
  {
    accountId: pea.id,
    position: {
      security: EMERGING,
      quantity: "-1",
      averageCost: null,
      cost: euros(0),
      incomplete: true,
      open: true,
    },
  },
  {
    accountId: pea.id,
    position: {
      security: WORLD,
      quantity: "3.9791",
      averageCost: { value: "112.0857", currency: "EUR" },
      cost: euros(44_599),
      incomplete: false,
      open: true,
    },
  },
];

let made = 0;

/** An operation of the PEA, as the core reads it, with what a test changes. */
function operation(change: Partial<OperationRead>): OperationRead {
  made += 1;

  return {
    id: idOf(1000 + made),
    lineId: idOf(5000 + made),
    accountId: pea.id,
    kind: "fee",
    bookedOn: "2026-10-01",
    valueOn: null,
    amount: euros(-150),
    fees: euros(0),
    quantity: null,
    unitPrice: null,
    security: null,
    label: "CUSTODY FEE",
    source: "import",
    state: "counted",
    paired: false,
    ...change,
  };
}

const deposit = operation({
  kind: "deposit",
  bookedOn: "2026-10-12",
  amount: euros(100_000),
  label: "SEPA TRF FROM CURRENT",
  paired: true,
});

const purchase = operation({
  kind: "purchase",
  bookedOn: "2026-10-14",
  amount: euros(-33_599),
  fees: euros(99),
  quantity: "2.9791",
  unitPrice: { value: "112.4519", currency: "EUR" },
  security: WORLD,
  label: "World Index ETF",
});

const dividend = operation({
  kind: "dividend",
  bookedOn: "2026-10-20",
  amount: euros(412),
  fees: euros(50),
  security: EMERGING,
  label: "DIVIDENDE EMERGING",
});

const soldOut = operation({
  kind: "sale",
  bookedOn: "2026-09-03",
  amount: euros(10_517),
  quantity: "1",
  unitPrice: { value: "105.17", currency: "EUR" },
  security: SOLD,
  label: "Sold Fund",
});

type Fake = {
  readonly operations: Array<OperationRead>;
  readonly positions: ReadonlyArray<{
    readonly accountId: string;
    readonly position: PositionRead;
  }>;
};

const newest = (a: OperationRead, b: OperationRead) =>
  b.bookedOn.localeCompare(a.bookedOn) || b.id.localeCompare(a.id);

/** The operation a checked input makes, its security found by ISIN or made. */
function readOf(
  id: string,
  accountId: string,
  checked: CheckedOperation,
  source: OperationRead["source"],
): OperationRead {
  const named = checked.security;

  const security =
    named === null
      ? null
      : ([WORLD, EMERGING, SOLD].find((each) => each.isin === named.isin) ?? {
          id: idOf(199),
          isin: named.isin,
          name: named.name ?? named.isin,
          currency: "EUR",
        });

  return {
    id,
    lineId: idOf(6000 + made),
    accountId,
    kind: checked.kind,
    bookedOn: checked.bookedOn,
    valueOn: checked.valueOn,
    amount: euros(checked.amountMinor),
    fees: euros(checked.feesMinor),
    quantity: checked.quantity,
    unitPrice: checked.unitPrice === null ? null : { value: checked.unitPrice, currency: "EUR" },
    security,
    label: checked.label ?? security?.name ?? "",
    source,
    state: "counted",
    paired: false,
  };
}

/** An input checked as the core checks it. */
const check = (input: Parameters<typeof checkOperation>[0]) => {
  const checked = checkOperation(input);

  return Result.isFailure(checked) ? Effect.fail(checked.failure) : Effect.succeed(checked.success);
};

/** `Investments` over the fake's list: no database, each input checked as the core checks it. */
function investmentsOf(state: Fake) {
  const accounts = ROWS.accounts ?? [];

  const target = (accountId: string) =>
    Effect.gen(function* () {
      const found = accounts.find((each) => each.id === accountId);

      if (found === undefined) {
        return yield* new AccountNotFound({ accountId });
      }

      if (found.kind !== "investment" || found.mode === "balance") {
        return yield* new NotAnInvestmentAccount({
          accountId,
          reason: found.kind === "investment" ? "balance" : "kind",
        });
      }

      return found;
    });

  const find = (operationId: string) => {
    const index = state.operations.findIndex((each) => each.id === operationId);

    return index === -1
      ? Effect.fail(new OperationNotFound({ operationId }))
      : Effect.succeed(index);
  };

  const position = (
    accountId: string,
    securityId: string,
  ): Effect.Effect<PositionDetail, AccountNotFound | SecurityNotFound> => {
    const found = accounts.find((each) => each.id === accountId);

    const operations = state.operations
      .filter((each) => each.accountId === accountId && each.security?.id === securityId)
      .toSorted(newest);

    const security = operations[0]?.security;

    if (found === undefined) {
      return Effect.fail(new AccountNotFound({ accountId }));
    }

    if (security === undefined || security === null) {
      return Effect.fail(new SecurityNotFound({ securityId }));
    }

    const held = state.positions.find(
      (each) => each.accountId === accountId && each.position.security.id === securityId,
    );

    return Effect.succeed({
      account: {
        id: found.id,
        name: found.name,
        institution: found.institution,
        currency: found.currency,
      },
      security,
      position: held?.position ?? null,
      operations,
    });
  };

  return Layer.succeed(Investments, {
    positions: () => Effect.succeed(state.positions),
    operations: (_owner, accountId, paging) => {
      if (!accounts.some((each) => each.id === accountId)) {
        return Effect.fail(new AccountNotFound({ accountId }));
      }

      const all = state.operations.filter((each) => each.accountId === accountId).toSorted(newest);
      const after = paging.after ?? null;
      const start = after === null ? 0 : all.findIndex((each) => each.id === after) + 1;
      const limit = paging.limit ?? 50;
      const operations = all.slice(start, start + limit);

      return Effect.succeed({
        operations,
        next: all.length > start + limit ? (operations.at(-1)?.id ?? null) : null,
        total: all.length,
      });
    },
    operationOn: (_owner, accountId, operationId) => {
      if (!accounts.some((each) => each.id === accountId)) {
        return Effect.fail(new AccountNotFound({ accountId }));
      }

      const found = state.operations.find(
        (each) => each.id === operationId && each.accountId === accountId,
      );

      return found === undefined
        ? Effect.fail(new OperationNotFound({ operationId }))
        : Effect.succeed(found);
    },
    position: (_owner, accountId, securityId) => position(accountId, securityId),
    positionByIsin: (_owner, accountId, isin) => {
      if (!accounts.some((each) => each.id === accountId)) {
        return Effect.fail(new AccountNotFound({ accountId }));
      }

      const named = state.operations.find(
        (each) => each.accountId === accountId && each.security?.isin === isin,
      )?.security;

      return named === undefined || named === null
        ? Effect.fail(new SecurityNotOnAccount({ accountId, isin }))
        : position(accountId, named.id).pipe(
            Effect.catchTag("SecurityNotFound", () =>
              Effect.fail(new SecurityNotOnAccount({ accountId, isin })),
            ),
          );
    },
    enter: (_owner, accountId, input) =>
      Effect.gen(function* () {
        const checked = yield* check(input);
        const found = yield* target(accountId);

        made += 1;

        const entered = readOf(idOf(3000 + made), found.id, checked, "manual");

        state.operations.push(entered);

        return entered;
      }),
    correct: (_owner, operationId, input) =>
      Effect.gen(function* () {
        const checked = yield* check(input);
        const index = yield* find(operationId);
        const before = state.operations[index];

        if (before === undefined) {
          return yield* new OperationNotFound({ operationId });
        }

        // An account gone since is as good as the operation gone.
        yield* target(before.accountId).pipe(
          Effect.catchTag("AccountNotFound", () =>
            Effect.fail(new OperationNotFound({ operationId })),
          ),
        );

        const corrected = readOf(operationId, before.accountId, checked, before.source);

        state.operations[index] = corrected;

        return corrected;
      }),
    remove: (_owner, operationId) =>
      Effect.gen(function* () {
        const index = yield* find(operationId);
        const [removed] = state.operations.splice(index, 1);

        return removed ?? (yield* new OperationNotFound({ operationId }));
      }),
  });
}

const runtimes: Array<{ readonly dispose: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

/** The fake's operations and positions, with what a test changes. */
function fake(change: Partial<Fake> = {}): Fake {
  return {
    operations: [deposit, purchase, dividend, soldOut],
    positions: POSITIONS,
    ...change,
  };
}

/** A client on one fake for the whole test: each call sees what the calls before it wrote. */
async function connect(state: Fake = fake(), caller: Caller = writer, rows: MemoryRows = ROWS) {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      memoryAccountStore(new Map([[caller.userId, rows]])),
      investmentsOf(state),
      // investments reads the accounts by name and the investments alone.
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
    const result = await client.callTool({ name: "investments", arguments: args });
    const [first] = result.content ?? [];

    return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
  };
}

/** A refusal: an error that says `saying`, ends with a valid call and stays under its limit. */
function expectRefusal(answer: { text: string; isError: boolean }, saying: string) {
  expect(answer.isError, answer.text).toBe(true);
  expect(answer.text).toContain(saying);
  expect(answer.text).toMatch(/A valid call: (investments|accounts) \{"action":"[a-z_]+".*\}$/);
  expect(answer.text.length).toBeLessThan(ERROR_LIMIT);
}

const Written = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
);

/** The call a text writes after `lead`, read back; undefined when it writes none. */
function callAfter(text: string, lead: string): Arguments | undefined {
  const at = text.indexOf(lead);

  return at === -1
    ? undefined
    : Schema.decodeUnknownSync(Written)(text.slice(at + lead.length).split("\n")[0] ?? "");
}

/** The handles a result gives its operations, in order. */
const handlesOf = (text: string) =>
  [...text.matchAll(/; operation: (\S+)$/gm)].map(([, id]) => id ?? "");

const PURCHASE = {
  action: "add_operation",
  account: "Northbank PEA",
  kind: "purchase",
  day: "2026-11-02",
  isin: "XX0000000002",
  quantity: "1.5",
  unit_price: "113.20",
  fees: "0.99",
  amount: "-170.79",
};

describe("investments list", () => {
  test("gives each investment account, its envelope and cash, and its open positions at cost", async () => {
    const { text, isError } = await (await connect())({ action: "list" });

    expect(isError, text).toBe(false);
    expect(text).toContain("at cost");
    expect(text).toContain("no value, gain or return");
    expect(text).toContain("Northbank PEA (Northbank), PEA in EUR: cash 1,000.00 EUR.");
    expect(text).toContain(
      "- World Index ETF (XX0000000002): 3.9791 units, average cost 112.0857 EUR, cost 445.99 EUR.",
    );
    expect(text).toContain(
      "- Emerging Markets ETF (XX0000000010): -1 units, cost 0.00 EUR; incomplete: more was sold than held, earlier operations are missing.",
    );
    expect(text).toContain(
      'Its operations: investments {"action":"show","account":"Northbank PEA","institution":"Northbank"}',
    );
    expect(text).toContain(
      "Old PEA (Northbank), PEA in EUR, kept by a noted balance: cash 5,000.00 EUR.",
    );
    expect(text).toContain("Harbour Life (Harbour), life insurance in EUR: cash 0.00 EUR.");
    expect(text).toContain("No open position.");
    // Not an investment account; a sold-out position is not open.
    expect(text).not.toContain("Current account");
    expect(text).not.toContain("Sold Fund");
    expect(text.length).toBeLessThan(RESULT_LIMIT);
  });

  test("says when the user has no investment account yet", async () => {
    const call = await connect(fake({ operations: [], positions: [] }), writer, {
      accounts: [current],
    });

    const { text, isError } = await call({ action: "list" });

    expect(isError, text).toBe(false);
    expect(text).toContain("The user has no investment account in Gousset yet");
  });
});

describe("investments show", () => {
  test("gives an account's operations newest first, each with its handle", async () => {
    const { text, isError } = await (
      await connect()
    )({
      action: "show",
      account: "northbank pea",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain("Operations of Northbank PEA (Northbank), newest first: 4 of 4.");
    expect(handlesOf(text)).toEqual([dividend.id, purchase.id, deposit.id, soldOut.id]);
    expect(text).toContain(
      `- 2026-10-14, purchase of 2.9791 World Index ETF (XX0000000002) at 112.4519 EUR, fees 0.99 EUR: -335.99 EUR; operation: ${purchase.id}`,
    );
    expect(text).toContain(
      `- 2026-10-20, dividend of Emerging Markets ETF (XX0000000010), tax withheld 0.50 EUR: 4.12 EUR, "DIVIDENDE EMERGING"; operation: ${dividend.id}`,
    );
    expect(text).toContain(
      `- 2026-10-12, deposit: 1,000.00 EUR, "SEPA TRF FROM CURRENT", paired as a transfer; operation: ${deposit.id}`,
    );
    expect(text).not.toContain("More operations remain");
  });

  test("pages an account's operations, the next call written in the result", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      operation({ bookedOn: `2026-09-${String(index + 1).padStart(2, "0")}` }),
    );

    const call = await connect(fake({ operations: many }));
    const seen: Array<string> = [];
    let next: Arguments | undefined = { action: "show", account: "Northbank PEA", limit: 10 };
    let pages = 0;

    while (next !== undefined) {
      const { text, isError } = await call(next);

      expect(isError, text).toBe(false);
      seen.push(...handlesOf(text));
      pages += 1;
      next = callAfter(text, "More operations remain. Read them with: investments ");
    }

    expect(pages).toBe(3);
    expect(seen).toEqual(many.toSorted(newest).map((each) => each.id));
  });

  test("gives one position and its operations, by ISIN alone or with its account", async () => {
    const call = await connect();

    for (const account of [undefined, "Northbank PEA"]) {
      const { text, isError } = await call(
        account === undefined
          ? { action: "show", isin: "xx0000000002" }
          : { action: "show", account, isin: "XX0000000002" },
      );

      expect(isError, text).toBe(false);
      expect(text).toContain(
        "World Index ETF (XX0000000002) on Northbank PEA (Northbank), quoted in EUR.",
      );
      expect(text).toContain("At cost: 3.9791 units, average cost 112.0857 EUR, cost 445.99 EUR.");
      expect(handlesOf(text)).toEqual([purchase.id]);
    }
  });

  test("gives a sold-out position on its account, with nothing held", async () => {
    const { text, isError } = await (
      await connect()
    )({
      action: "show",
      account: "Northbank PEA",
      isin: "XX0000000028",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain("Sold Fund (XX0000000028) on Northbank PEA (Northbank)");
    expect(text).toContain("Nothing held now");
    expect(handlesOf(text)).toEqual([soldOut.id]);
  });

  test("refuses what it cannot show, saying what to do", async () => {
    const call = await connect();

    expectRefusal(await call({ action: "show" }), "show needs account, isin or both");
    expectRefusal(
      await call({ action: "show", account: "Brokerage" }),
      'No account of the user\'s is named "Brokerage"',
    );
    expectRefusal(
      await call({ action: "show", account: "Current account" }),
      "Current account (Northbank) is not an investment account",
    );
    expectRefusal(
      await call({ action: "show", isin: "XX0000000003" }),
      '"XX0000000003" is not an ISIN',
    );
    expectRefusal(
      await call({ action: "show", isin: "XX0000000028" }),
      "No open position of the user's has the ISIN XX0000000028",
    );
    expectRefusal(
      await call({ action: "show", account: "Harbour Life", isin: "XX0000000002" }),
      "Harbour Life (Harbour) has no operation of XX0000000002",
    );
  });
});

describe("investments writes", () => {
  test("adds a purchase and says the position it makes", async () => {
    const state = fake();
    const call = await connect(state);
    const { text, isError } = await call(PURCHASE);

    expect(isError, text).toBe(false);

    const added = state.operations.at(-1);

    expect(added).toMatchObject({
      kind: "purchase",
      bookedOn: "2026-11-02",
      amount: euros(-17_079),
      fees: euros(99),
      quantity: "1.5",
      unitPrice: { value: "113.2" },
      security: WORLD,
      source: "manual",
    });
    expect(text).toContain("Added to Northbank PEA (Northbank):");
    expect(text).toContain(
      `- 2026-11-02, purchase of 1.5 World Index ETF (XX0000000002) at 113.2 EUR, fees 0.99 EUR: -170.79 EUR, entered by hand; operation: ${added?.id ?? ""}`,
    );
    expect(text).toContain(
      "World Index ETF now, at cost: 3.9791 units, average cost 112.0857 EUR, cost 445.99 EUR.",
    );
    expect(text).toContain(
      'Its operations: investments {"action":"show","account":"Northbank PEA","institution":"Northbank"}',
    );
  });

  test("edits an operation, given whole again, on its account", async () => {
    const state = fake();
    const call = await connect(state);

    const { text, isError } = await call({
      ...PURCHASE,
      action: "edit_operation",
      operation: purchase.id,
      day: "2026-10-15",
      amount: "-336.99",
      quantity: "2.9791",
      unit_price: "112.7876",
    });

    expect(isError, text).toBe(false);
    expect(state.operations.find((each) => each.id === purchase.id)).toMatchObject({
      bookedOn: "2026-10-15",
      amount: euros(-33_699),
      unitPrice: { value: "112.7876" },
    });
    expect(text).toContain("Corrected on Northbank PEA (Northbank):");
    expect(text).toContain(
      `- 2026-10-15, purchase of 2.9791 World Index ETF (XX0000000002) at 112.7876 EUR, fees 0.99 EUR: -336.99 EUR; operation: ${purchase.id}`,
    );
  });

  test("deletes an operation and its cash line", async () => {
    const state = fake();
    const call = await connect(state);
    const { text, isError } = await call({ action: "delete_operation", operation: dividend.id });

    expect(isError, text).toBe(false);
    expect(state.operations.map((each) => each.id)).not.toContain(dividend.id);
    expect(text).toContain("Deleted, with its cash line, from Northbank PEA (Northbank):");
    expect(text).toContain("Emerging Markets ETF: nothing held now.");
    expect(text).toContain(`dividend of Emerging Markets ETF (XX0000000010)`);
  });

  test("refuses every write to a connection allowed to read only, saying how to get write", async () => {
    const state = fake();
    const call = await connect(state, reader);

    for (const args of [
      PURCHASE,
      { ...PURCHASE, action: "edit_operation", operation: purchase.id },
      { action: "delete_operation", operation: purchase.id },
    ]) {
      const { text, isError } = await call(args);

      expect(isError).toBe(true);
      expect(text).toContain("choose Read and write on Gousset's consent page");
    }

    expect(state.operations).toEqual(fake().operations);
  });

  test("refuses a purchase of the wrong sign, with the call that fixes it", async () => {
    const answer = await (await connect())({ ...PURCHASE, amount: "170.79" });

    expectRefusal(answer, "A purchase takes money out of the account");
    expect(callAfter(answer.text, "A valid call: investments ")).toMatchObject({
      amount: "-170.79",
    });
  });

  test("refuses an invalid ISIN, saying what to do", async () => {
    const answer = await (await connect())({ ...PURCHASE, isin: "XX0000000003" });

    expectRefusal(answer, '"XX0000000003" is not an ISIN');
    expect(answer.text).toContain("check digit");
  });

  test("refuses a quantity of zero, a trade without its quantity, a deposit with a security", async () => {
    const call = await connect();

    expectRefusal(
      await call({ ...PURCHASE, quantity: "0" }),
      '"0" is no quantity or unit price Gousset keeps',
    );
    const { quantity: _quantity, unit_price: _price, ...withoutQuantity } = PURCHASE;

    expectRefusal(
      await call(withoutQuantity),
      "A purchase or a sale needs quantity and unit_price",
    );
    expectRefusal(
      await call({
        action: "add_operation",
        account: "Northbank PEA",
        kind: "deposit",
        day: "2026-11-02",
        amount: "500",
        isin: "XX0000000002",
      }),
      "A deposit or a withdrawal names no security",
    );
  });

  test("refuses an account kept by a noted balance, or no investment account", async () => {
    const call = await connect();

    expectRefusal(await call({ ...PURCHASE, account: "Old PEA" }), "kept by a noted balance");
    expectRefusal(
      await call({ ...PURCHASE, account: "Current account" }),
      "is not an investment account",
    );
  });

  test("refuses an operation handle the account does not have", async () => {
    const call = await connect();

    expectRefusal(
      await call({ action: "delete_operation", operation: idOf(999) }),
      "No operation of the user's has this handle",
    );
    expectRefusal(
      await call({ ...PURCHASE, action: "edit_operation", operation: idOf(999) }),
      "Northbank PEA (Northbank) has no operation with this handle",
    );
    expectRefusal(
      await call({ ...PURCHASE, action: "edit_operation" }),
      "edit_operation needs operation",
    );
  });
});
