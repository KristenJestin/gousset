import fc from "fast-check";
import { Exit, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import {
  Conditions,
  MAX_CONDITIONS,
  MAX_LABEL_TEXT,
  conditionRow,
  conditionsProblem,
  conditionsQuery,
  matcherOf,
} from "./conditions";
import type { Condition, ConditionRow } from "./conditions";

// A rule's conditions (#25): decoded, checked against the user's accounts, evaluated on a line as
// the import does, and written as parameterized SQL for applying a rule to the past.

const CURRENT = "019a0000-0000-7000-8000-000000000001";
const SAVINGS = "019a0000-0000-7000-8000-000000000002";

const decode = Schema.decodeUnknownExit(Conditions);

const all = (...children: ReadonlyArray<Condition>): Conditions => ({
  kind: "group",
  combinator: "and",
  children,
});

const line = (change: Partial<ConditionRow> = {}): ConditionRow => ({
  label: "CB GREENMARKET 0412",
  account: CURRENT,
  amount: 42.5,
  direction: "out",
  day: 4,
  date: "2026-10-04",
  ...change,
});

const salaryIn = (currency: string) =>
  conditionRow({
    label: "SALARY",
    accountId: CURRENT,
    amountMinor: 12_345,
    currency,
    bookedOn: "2026-10-31",
  });

/** The characters a label is drawn from: letters of both cases, digits, and LIKE's own. */
const LABEL_CHARACTERS = [
  "A",
  "B",
  "C",
  "X",
  "Y",
  "Z",
  "a",
  "b",
  "x",
  "y",
  "0",
  "1",
  " ",
  "*",
  "%",
  "_",
  "-",
  "'",
  "!",
];

describe("a line, as a condition reads it", () => {
  test("has its amount without its sign, in its currency's units, and its day of the month", () => {
    expect(
      conditionRow({
        label: "CB GREENMARKET",
        accountId: CURRENT,
        amountMinor: -4250,
        currency: "EUR",
        bookedOn: "2026-10-04",
      }),
    ).toEqual({
      label: "CB GREENMARKET",
      account: CURRENT,
      amount: 42.5,
      direction: "out",
      day: 4,
      date: "2026-10-04",
    });
  });

  test("reads a currency of no minor unit, or of three, as ISO 4217 does", () => {
    expect(salaryIn("JPY")).toMatchObject({ amount: 12_345, direction: "in", day: 31 });
    expect(salaryIn("KWD")).toMatchObject({ amount: 12.345 });
  });
});

describe("a rule's conditions", () => {
  test("decode qnot's own shape", () => {
    const input = {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" },
        { kind: "rule", field: "amount", operator: "between", value: [10, 20] },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
      ],
    };

    expect(Exit.isSuccess(decode(input))).toBe(true);
  });

  test.each([
    ["a nested group", { kind: "group", combinator: "and", children: [] }],
    ["an unknown field", { kind: "rule", field: "memo", operator: "contains", value: "x" }],
    [
      "an operator the field does not take",
      { kind: "rule", field: "label", operator: "gt", value: "x" },
    ],
    ["an empty label", { kind: "rule", field: "label", operator: "contains", value: "" }],
    [
      "a label too long",
      { kind: "rule", field: "label", operator: "contains", value: "A".repeat(MAX_LABEL_TEXT + 1) },
    ],
    ["a negative amount", { kind: "rule", field: "amount", operator: "eq", value: -3 }],
    ["one amount for a range", { kind: "rule", field: "amount", operator: "between", value: 3 }],
    ["a day past 31", { kind: "rule", field: "day", operator: "eq", value: 32 }],
    ["a day not whole", { kind: "rule", field: "day", operator: "eq", value: 3.5 }],
    [
      "a date not written YYYY-MM-DD",
      { kind: "rule", field: "date", operator: "gte", value: "4/10/2026" },
    ],
    [
      "a direction other than out or in",
      { kind: "rule", field: "direction", operator: "eq", value: "both" },
    ],
  ])("refuse %s", (_name, child) => {
    expect(Exit.isFailure(decode({ kind: "group", combinator: "and", children: [child] }))).toBe(
      true,
    );
  });

  test("refuse any combinator but and", () => {
    expect(
      Exit.isFailure(
        decode({
          kind: "group",
          combinator: "or",
          children: [{ kind: "rule", field: "direction", operator: "eq", value: "out" }],
        }),
      ),
    ).toBe(true);
  });

  test("need one condition at least, and at most ten", () => {
    const one: Condition = { kind: "rule", field: "direction", operator: "eq", value: "out" };

    expect(conditionsProblem(all(), [CURRENT])).toEqual({ reason: "empty" });
    expect(
      conditionsProblem(all(...Array.from({ length: MAX_CONDITIONS + 1 }, () => one)), [CURRENT]),
    ).toEqual({ reason: "too_many" });
    expect(
      conditionsProblem(all(...Array.from({ length: MAX_CONDITIONS }, () => one)), [CURRENT]),
    ).toBeNull();
  });

  test("name only the user's accounts", () => {
    expect(
      conditionsProblem(
        all(
          { kind: "rule", field: "label", operator: "contains", value: "TRF" },
          { kind: "rule", field: "account", operator: "eq", value: SAVINGS },
        ),
        [CURRENT],
      ),
    ).toEqual({ reason: "unknown_account", index: 1 });
  });

  test("refuse a range that goes downwards, or a date that does not exist", () => {
    expect(
      conditionsProblem(
        all({ kind: "rule", field: "day", operator: "between", value: [7, 3] }),
        [],
      ),
    ).toEqual({ reason: "invalid", index: 0 });

    expect(
      conditionsProblem(
        all({ kind: "rule", field: "date", operator: "gte", value: "2026-02-30" }),
        [],
      ),
    ).toEqual({ reason: "invalid", index: 0 });
  });
});

describe("a line meets a rule", () => {
  test("when it meets every condition", () => {
    const matches = matcherOf(
      all(
        { kind: "rule", field: "label", operator: "contains", value: "greenmarket" },
        { kind: "rule", field: "account", operator: "eq", value: CURRENT },
        { kind: "rule", field: "amount", operator: "between", value: [40, 42.5] },
        { kind: "rule", field: "direction", operator: "eq", value: "out" },
        { kind: "rule", field: "day", operator: "between", value: [3, 7] },
        { kind: "rule", field: "date", operator: "gte", value: "2026-10-01" },
      ),
    );

    expect(matches(line())).toBe(true);
    expect(matches(line({ label: "CB CORNERSHOP" }))).toBe(false);
    expect(matches(line({ account: SAVINGS }))).toBe(false);
    expect(matches(line({ amount: 42.51 }))).toBe(false);
    expect(matches(line({ direction: "in" }))).toBe(false);
    expect(matches(line({ day: 8 }))).toBe(false);
    expect(matches(line({ date: "2026-09-30" }))).toBe(false);
  });

  test("whatever the case of the label, for every text it holds", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...LABEL_CHARACTERS) }),
        fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(...LABEL_CHARACTERS) }),
        (label, piece) => {
          const matches = matcherOf(
            all({ kind: "rule", field: "label", operator: "contains", value: piece }),
          );

          expect(matches(line({ label }))).toBe(label.toLowerCase().includes(piece.toLowerCase()));
        },
      ),
    );
  });

  test("on an amount range, both ends included", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (a, b, minor) => {
          const [low, high] = a <= b ? [a / 100, b / 100] : [b / 100, a / 100];
          const amount = minor / 100;

          const matches = matcherOf(
            all({ kind: "rule", field: "amount", operator: "between", value: [low, high] }),
          );

          expect(matches(line({ amount }))).toBe(amount >= low && amount <= high);
        },
      ),
    );
  });
});

describe("a rule's conditions in SQL", () => {
  test("are parameters, never text of the query", () => {
    const query = conditionsQuery(
      all(
        { kind: "rule", field: "label", operator: "contains", value: "O'BRIEN 50%" },
        { kind: "rule", field: "account", operator: "eq", value: CURRENT },
        { kind: "rule", field: "amount", operator: "between", value: [10, 20.5] },
        { kind: "rule", field: "day", operator: "eq", value: 4 },
      ),
    );

    expect(query.sql).toBe(
      `"label" ILIKE $1 ESCAPE '!' AND "account" = $2 AND "amount" BETWEEN $3 AND $4 AND "day" = $5`,
    );
    expect(query.params).toEqual(["%O'BRIEN 50!%%", CURRENT, 10, 20.5, 4]);
  });

  test("bind each placeholder to a value, whatever the label holds", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (piece) => {
        const query = conditionsQuery(
          all(
            { kind: "rule", field: "label", operator: "startsWith", value: piece },
            { kind: "rule", field: "direction", operator: "eq", value: "in" },
          ),
        );

        expect(query.sql).toBe(`"label" ILIKE $1 ESCAPE '!' AND "direction" = $2`);
        expect(query.params).toHaveLength(2);
      }),
    );
  });
});
