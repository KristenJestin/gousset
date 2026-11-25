import {
  DataExport,
  Expenses,
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
import type { AccountRecord, MemoryRows, RuleAccount, RuleSummary } from "@gousset/core";
import { Conditions } from "@gousset/core/rule-values";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Caller, Runner } from "../tool";
import { groupOf, reachText, ruleText } from "./rules";
import type { WrittenCondition } from "./rules";

// The rules tool through the official client: its description, the conditions a caller writes
// turned into qnot's group, the sentences it answers with, and the refusals that come before any
// rule is read. What it does to rules and lines is tried end to end, on the built app and a real
// database (apps/e2e/tests/rules-mcp.spec.ts).

const TODAY = "2026-11-23";
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };
const writer: Caller = { ...reader, canWrite: true };

function account(name: string, institution: string): AccountRecord {
  return {
    id: memoryId(),
    name,
    kind: "current",
    envelope: null,
    institution,
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
  };
}

const current = account("Current account", "Northbank");
const livret = account("Livret A", "Northbank");
const otherLivret = account("Livret A", "Riverside Bank");

const ROWS: MemoryRows = {
  accounts: [current, livret, otherLivret],
  lines: [],
  balances: [],
  imports: [],
};

function onToday(): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    memoryAccountStore(new Map([[reader.userId, ROWS]])),
    // The refusals tried here come before any rule, merchant or category is read.
    memoryLineStore(),
    memoryCategoryStore(),
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(Merchants, {}),
    Layer.mock(Transfers, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Expenses, {}),
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

type Arguments = { readonly [key: string]: Schema.Json };

async function rules(args: Arguments, caller: Caller = writer) {
  const client = await connectInProcess(goussetServer, { run: onToday() }, caller, "2025-11-25");
  const result = await client.callTool({ name: "rules", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const ValidCall = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/** The valid call an error ends with, read back when it is a call of `rules`. */
function exampleOf(text: string) {
  const [, call = ""] = /\nA valid call: rules (.+)$/.exec(text) ?? [];

  return call === "" ? undefined : Schema.decodeUnknownSync(ValidCall)(call);
}

const failureOf = (result: Result.Result<Conditions, number>) =>
  Result.isFailure(result) ? result.failure : undefined;

describe("the rules tool", () => {
  test("comes last in the fixed order, writes, and says how to write a condition", async () => {
    const client = await connectInProcess(goussetServer, { run: onToday() }, reader, "2026-07-28");
    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "rules");

    expect(tools.map((each) => each.name).at(-1)).toBe("rules");
    expect(tool?.title).toBe("Rules");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    const description = tool?.description ?? "";

    // Within the older cut of Claude Code, so that every client reads it whole.
    expect(description.length).toBeLessThanOrEqual(2048);

    for (const said of [
      "the first that applies wins",
      "`include_by_hand: true`",
      "`from_correction: true`",
      "(null clears)",
      "12.5 for 12.50",
      "between takes [low, high]",
      "an archived category",
      '{"action":"create","conditions":[{"field":"label","operator":"contains","value":"GREENMARKET"},{"field":"account","operator":"eq","value":"Current account"},{"field":"amount","operator":"between","value":[10,20]}],"merchant":"Greenmarket","category":"Groceries"}',
    ]) {
      expect(description, said).toContain(said);
    }
  });

  test("refuses every write to a token allowed to read only, and says how to get write", async () => {
    for (const action of ["create", "edit", "disable", "apply_to_past"]) {
      const { text, isError } = await rules({ action, rule: "some-rule" }, reader);

      expect(isError, action).toBe(true);
      expect(text, action).toContain("choose Read and write on Gousset's consent page");
    }
  });

  test("asks for what an action needs, with a valid call", async () => {
    const asked = [
      [{ action: "show" }, "show needs rule"],
      [{ action: "create" }, "create needs conditions"],
      [{ action: "edit" }, "edit needs rule"],
      [{ action: "edit", rule: "some-rule" }, "edit needs what changes"],
      [{ action: "disable" }, "disable needs rule"],
      [{ action: "apply_to_past" }, "apply_to_past needs rule"],
    ] as const;

    for (const [args, said] of asked) {
      const { text, isError } = await rules(args);

      expect(isError, said).toBe(true);
      expect(text, said).toContain(said);
      expect(exampleOf(text), said).toBeDefined();
      expect(text.length).toBeLessThan(ERROR_LIMIT);
    }
  });

  test("refuses a condition that cannot be read, saying what its field takes", async () => {
    const { text, isError } = await rules({
      action: "create",
      conditions: [
        { field: "label", operator: "contains", value: "GREENMARKET" },
        { field: "direction", operator: "gte", value: "out" },
      ],
      category: "Groceries",
    });

    expect(isError).toBe(true);
    expect(text).toContain(
      'Condition 2 (direction gte) cannot be read: direction takes eq and "out" (money leaves the account) or "in" (money comes in).',
    );
    expect(exampleOf(text)).toEqual({
      action: "create",
      conditions: [{ field: "direction", operator: "eq", value: "out" }],
      category: "Groceries",
    });
  });

  test("refuses an unknown or ambiguous account, with the names to choose from", async () => {
    const unknown = await rules({
      action: "create",
      conditions: [{ field: "account", operator: "eq", value: "Joint account" }],
      category: "Groceries",
    });

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain(
      'Condition 1: no account of the user\'s is named "Joint account". Their accounts: Current account (Northbank), Livret A (Northbank), Livret A (Riverside Bank).',
    );
    expect(unknown.text).toContain('A valid call: accounts {"action":"list"}');

    const ambiguous = await rules({
      action: "create",
      conditions: [
        { field: "label", operator: "contains", value: "INTEREST" },
        { field: "account", operator: "eq", value: "livret a" },
      ],
      category: "Interest",
    });

    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain(
      'Condition 2: several accounts of the user\'s are named "livret a": Livret A (Northbank), Livret A (Riverside Bank). Add institution',
    );
  });
});

describe("the conditions a caller writes", () => {
  const written: ReadonlyArray<WrittenCondition> = [
    { field: "label", operator: "contains", value: "GREENMARKET" },
    { field: "account", operator: "eq", value: "Current account" },
    { field: "amount", operator: "between", value: [10, 20] },
    { field: "direction", operator: "eq", value: "out" },
    { field: "day", operator: "gte", value: 25 },
    { field: "date", operator: "between", value: ["2026-01-01", "2026-12-31"] },
  ];

  test("become qnot's group, the account by its id", () => {
    const group = groupOf(written, [undefined, current.id]);

    const expected = {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" },
        { kind: "rule", field: "account", operator: "eq", value: current.id },
        { kind: "rule", field: "amount", operator: "between", value: [10, 20] },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
        { kind: "rule", field: "day", operator: "gte", value: 25 },
        { kind: "rule", field: "date", operator: "between", value: ["2026-01-01", "2026-12-31"] },
      ],
    };

    expect(Result.isSuccess(group)).toBe(true);
    expect(Result.isSuccess(group) ? group.success : undefined).toEqual(expected);
    expect(Schema.decodeUnknownSync(Conditions)(expected)).toEqual(expected);
  });

  test("give the index of the first that cannot be read", () => {
    const wrong: ReadonlyArray<readonly [WrittenCondition, string]> = [
      [{ field: "direction", operator: "gte", value: "out" }, "an operator of another field"],
      [{ field: "amount", operator: "eq", value: "12.50" }, "an amount written as text"],
      [{ field: "amount", operator: "between", value: [10] }, "a range of one value"],
      [{ field: "amount", operator: "gt", value: -5 }, "an amount with its sign"],
      [{ field: "day", operator: "eq", value: 32 }, "no day of a month"],
      [{ field: "date", operator: "eq", value: "1 October" }, "a date not YYYY-MM-DD"],
      [{ field: "label", operator: "contains", value: "" }, "an empty label"],
      [{ field: "account", operator: "eq", value: 3 }, "an account that is no name"],
    ];

    for (const [condition, why] of wrong) {
      expect(failureOf(groupOf([...written, condition], [undefined, current.id])), why).toBe(
        written.length,
      );
    }
  });
});

describe("a rule in words", () => {
  const accounts: ReadonlyArray<RuleAccount> = [
    { id: current.id, name: "Current account", institution: "Northbank" },
  ];

  const rule: RuleSummary = {
    id: "0b5f3c1e-8a7d-4c2e-9f10-2a6b7c8d9e01",
    place: 1,
    enabled: true,
    conditions: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" },
        { kind: "rule", field: "account", operator: "eq", value: current.id },
        { kind: "rule", field: "amount", operator: "between", value: [10, 20] },
      ],
    },
    merchant: { id: "merchant", name: "Greenmarket" },
    category: {
      id: "category",
      name: "Groceries",
      parentName: null,
      kind: "expense",
      archived: false,
    },
    appliedCount: 12,
    createdFrom: "user",
    createdAt: "2026-11-01T09:00:00.000Z",
  };

  test("says its conditions, what it sets, whether it is on, and its id", () => {
    expect(ruleText(rule, accounts)).toBe(
      '1. If label contains "GREENMARKET" and account is Current account (Northbank) and amount is between 10 and 20, then merchant Greenmarket, category Groceries. On. Classified 12 lines. Id: 0b5f3c1e-8a7d-4c2e-9f10-2a6b7c8d9e01',
    );
  });

  test("names a child category by its path, an archived one so, and an account gone", () => {
    const other: RuleSummary = {
      ...rule,
      place: 2,
      enabled: false,
      conditions: {
        kind: "group",
        combinator: "and",
        children: [
          { kind: "rule", field: "direction", operator: "eq", value: "out" },
          { kind: "rule", field: "day", operator: "between", value: [1, 5] },
          { kind: "rule", field: "date", operator: "gte", value: "2026-01-01" },
          { kind: "rule", field: "account", operator: "neq", value: "an-account-deleted" },
        ],
      },
      merchant: null,
      category: {
        id: "rent",
        name: "Rent",
        parentName: "Housing",
        kind: "expense",
        archived: true,
      },
      appliedCount: 1,
    };

    expect(ruleText(other, accounts)).toBe(
      `2. If money leaves the account and day of the month is between 1 and 5 and date is on or after 2026-01-01 and account is not an account deleted since, then category Housing > Rent (archived: it classifies nothing new). Off. Classified 1 line. Id: ${rule.id}`,
    );
  });

  test("says what it would do to the lines already there", () => {
    expect(reachText({ lines: 5, toChange: 3, byHand: 1 })).toBe(
      "It applies to 5 lines already there; 3 would change; 1 were classified otherwise by hand, which apply_to_past leaves alone unless include_by_hand is true.",
    );
  });
});
