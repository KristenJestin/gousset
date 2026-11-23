import { minorDigits } from "@gousset/currency";
import { compile, defineFields, encode, f, validateQuery } from "@qnot/core";
import { sqlFormat } from "@qnot/core/formats/sql";
import { Schema } from "effect";

// A rule's conditions (#25): a query of qnot's shape (`@qnot/core`), the fields declared once here.
// The same query is decoded and checked on the server (a rule sent through the MCP door is
// untrusted), evaluated in JavaScript on each new line at import (`matcherOf`), and turned into
// parameterized SQL for applying it to the past (`conditionsQuery`, bound in `./sql`). The browser
// imports this file (`@gousset/core/rule-values`): no database here. Only what both sides read alike
// is offered: one group, all of its conditions to be met, no nesting nor negated group.

/** The most conditions a rule may have. */
export const MAX_CONDITIONS = 10;

/** The longest piece of label a condition may look for. */
export const MAX_LABEL_TEXT = 200;

/** The fields a condition reads, in the order the editor offers them. */
export const CONDITION_FIELDS = ["label", "account", "amount", "direction", "day", "date"] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

/** The operators each field takes, in the order the editor offers them. */
export const OPERATORS_OF = {
  label: ["contains", "startsWith", "endsWith", "eq", "notContains"],
  account: ["eq", "neq"],
  amount: ["eq", "between", "gte", "lte", "gt", "lt", "neq"],
  direction: ["eq"],
  day: ["eq", "between", "gte", "lte"],
  date: ["gte", "lte", "between", "eq"],
} as const;

const Day = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 }));

const Amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const IsoDay = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

const LabelText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_LABEL_TEXT));

const condition = <
  const Field extends ConditionField,
  const Operators extends ReadonlyArray<string>,
  V,
>(
  field: Field,
  operators: Operators,
  value: Schema.Codec<V, V>,
) =>
  Schema.Struct({
    kind: Schema.Literal("rule"),
    field: Schema.Literal(field),
    operator: Schema.Literals(operators),
    value,
  });

/**
 * One condition, as qnot writes it: `{ kind: "rule", field, operator, value }`. A label is looked
 * for in any case; an amount is the line's, without its sign, in its account's currency (12.5 for
 * €12.50); a direction is `out` (money leaves) or `in`; a day is the day of the month of the line's
 * booking; a date is its booking date, `YYYY-MM-DD`. `between` takes two values, both included.
 */
export const Condition = Schema.Union([
  condition("label", OPERATORS_OF.label, LabelText),
  condition("account", OPERATORS_OF.account, Schema.String),
  condition("amount", ["eq", "gte", "lte", "gt", "lt", "neq"], Amount),
  condition("amount", ["between"], Schema.Tuple([Amount, Amount])),
  condition("direction", OPERATORS_OF.direction, Schema.Literals(["out", "in"])),
  condition("day", ["eq", "gte", "lte"], Day),
  condition("day", ["between"], Schema.Tuple([Day, Day])),
  condition("date", ["eq", "gte", "lte"], IsoDay),
  condition("date", ["between"], Schema.Tuple([IsoDay, IsoDay])),
]);

export type Condition = typeof Condition.Type;

/** A rule's conditions: one group, every condition of which a line must meet. */
export const Conditions = Schema.Struct({
  kind: Schema.Literal("group"),
  combinator: Schema.Literal("and"),
  children: Schema.Array(Condition),
});

export type Conditions = typeof Conditions.Type;

/** What a line is, as a condition reads it. */
export type ConditionRow = {
  readonly label: string;
  readonly account: string;
  readonly amount: number;
  readonly direction: "out" | "in";
  readonly day: number;
  readonly date: string;
};

/** A line as the import holds it, before it is read as a condition does. */
export type LineFacts = {
  readonly label: string;
  readonly accountId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly bookedOn: string;
};

/** A line as a condition reads it: its amount without its sign, in its currency's units. */
export function conditionRow(line: LineFacts): ConditionRow {
  return {
    label: line.label,
    account: line.accountId,
    amount: Math.abs(line.amountMinor) / 10 ** minorDigits(line.currency),
    direction: line.amountMinor < 0 ? "out" : "in",
    day: Number(line.bookedOn.slice(8, 10)),
    date: line.bookedOn,
  };
}

/** The fields, declared once, with the user's accounts as the only ones a condition may name. */
function fieldsOf(accountIds: ReadonlyArray<string>) {
  return defineFields({
    label: f.text({ operators: OPERATORS_OF.label, minLength: 1, maxLength: MAX_LABEL_TEXT }),
    account: f.enum(
      accountIds.map((id) => ({ value: id, label: id })),
      { operators: OPERATORS_OF.account },
    ),
    amount: f.number({ operators: OPERATORS_OF.amount, min: 0 }),
    direction: f.enum(["out", "in"], { operators: OPERATORS_OF.direction }),
    day: f.number({ operators: OPERATORS_OF.day, integer: true, min: 1, max: 31 }),
    date: f.date({ operators: OPERATORS_OF.date }),
  });
}

/** Whether a condition is a range whose first value is past its second. */
function goesDownwards(each: Condition): boolean {
  switch (each.field) {
    case "amount":
    case "day": {
      return each.operator === "between" && each.value[0] > each.value[1];
    }

    case "date": {
      return each.operator === "between" && each.value[0] > each.value[1];
    }

    case "label":
    case "account":
    case "direction": {
      return false;
    }
  }
}

/** Whether `day` (`YYYY-MM-DD`) is a day of the calendar: qnot reads 2026-02-30, Postgres does not. */
const isCalendarDay = (day: string) =>
  !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
  new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

/** Whether a date condition names a day that does not exist. */
function namesNoDay(each: Condition): boolean {
  if (each.field !== "date") {
    return false;
  }

  return each.operator === "between"
    ? !each.value.every(isCalendarDay)
    : !isCalendarDay(each.value);
}

/** Why conditions were refused, and which one (its index) when one condition is the cause. */
export type ConditionsProblem =
  | { readonly reason: "empty" | "too_many" }
  | { readonly reason: "invalid"; readonly index: number }
  | { readonly reason: "unknown_account"; readonly index: number };

/**
 * What is wrong with conditions already decoded, against the user's accounts; null when nothing.
 * qnot checks each value for its field (an account the user has, a day of the month); a date must
 * also exist, and a range go upwards.
 */
export function conditionsProblem(
  conditions: Conditions,
  accountIds: ReadonlyArray<string>,
): ConditionsProblem | null {
  if (conditions.children.length === 0) {
    return { reason: "empty" };
  }

  if (conditions.children.length > MAX_CONDITIONS) {
    return { reason: "too_many" };
  }

  const issues = validateQuery(fieldsOf(accountIds), conditions).filter(
    (issue) => issue.severity === "error",
  );

  const [first] = issues;

  if (first !== undefined) {
    const index = first.path[0] ?? 0;

    return conditions.children[index]?.field === "account"
      ? { reason: "unknown_account", index }
      : { reason: "invalid", index };
  }

  const wrong = conditions.children.findIndex((each) => goesDownwards(each) || namesNoDay(each));

  return wrong === -1 ? null : { reason: "invalid", index: wrong };
}

/**
 * The test of a line, compiled once. Conditions that passed `conditionsProblem` never meet a
 * condition qnot cannot read; one that would (an account deleted since) matches no line.
 */
export function matcherOf(conditions: Conditions): (row: ConditionRow) => boolean {
  const accounts = conditions.children.flatMap((each) =>
    each.field === "account" ? [each.value] : [],
  );

  return compile(fieldsOf(accounts), conditions, { incompleteRules: false, invalidRules: false });
}

/** The conditions as qnot's SQL, with `$n` placeholders and their values (`./sql` binds them). */
export function conditionsQuery(conditions: Conditions) {
  const accounts = conditions.children.flatMap((each) =>
    each.field === "account" ? [each.value] : [],
  );

  return encode(
    sqlFormat({
      dialect: "postgres",
      params: "numbered",
      quoteIdentifiers: true,
      caseInsensitive: true,
      emptyQuery: "none",
    }),
    conditions,
    fieldsOf(accounts),
  );
}
