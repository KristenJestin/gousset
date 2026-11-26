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
//
// The merchant condition (#37) is the one SQL cannot read: a line's merchant is its entry's, else
// the one its label cleans to (`../merchants/line-merchant`), and the label is cleaned in code. It
// is evaluated in JavaScript on both sides, after the SQL of the other conditions over the past.

/** The most conditions a rule may have. */
export const MAX_CONDITIONS = 10;

/** The longest piece of label a condition may look for. */
export const MAX_LABEL_TEXT = 200;

/** The fields a condition reads, in the order the editor offers them. */
export const CONDITION_FIELDS = [
  "label",
  "merchant",
  "account",
  "amount",
  "direction",
  "day",
  "date",
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

/** The operators each field takes, in the order the editor offers them. */
export const OPERATORS_OF = {
  label: ["contains", "startsWith", "endsWith", "eq", "notContains"],
  merchant: ["eq"],
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
 * for in any case; a merchant is one of the user's, by id, met by a line whose merchant it is (its
 * entry's, else its label's, never an intermediary); an amount is the line's, without its sign, in its account's currency (12.5 for
 * €12.50); a direction is `out` (money leaves) or `in`; a day is the day of the month of the line's
 * booking; a date is its booking date, `YYYY-MM-DD`. `between` takes two values, both included.
 */
export const Condition = Schema.Union([
  condition("label", OPERATORS_OF.label, LabelText),
  condition("merchant", OPERATORS_OF.merchant, Schema.String),
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

type MerchantCondition = Extract<Condition, { readonly field: "merchant" }>;

const isMerchantCondition = (each: Condition): each is MerchantCondition =>
  each.field === "merchant";

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
  /** The line's merchant's id (`../merchants/line-merchant`); null for none known. */
  readonly merchant: string | null;
  readonly account: string;
  readonly amount: number;
  readonly direction: "out" | "in";
  readonly day: number;
  readonly date: string;
};

/** A line as the import holds it, before it is read as a condition does. */
export type LineFacts = {
  readonly label: string;
  readonly merchantId: string | null;
  readonly accountId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly bookedOn: string;
};

/** A line as a condition reads it: its amount without its sign, in its currency's units. */
export function conditionRow(line: LineFacts): ConditionRow {
  return {
    label: line.label,
    merchant: line.merchantId,
    account: line.accountId,
    amount: Math.abs(line.amountMinor) / 10 ** minorDigits(line.currency),
    direction: line.amountMinor < 0 ? "out" : "in",
    day: Number(line.bookedOn.slice(8, 10)),
    date: line.bookedOn,
  };
}

/**
 * The fields, declared once, with the user's accounts and merchants as the only ones a condition
 * may name.
 */
function fieldsOf(accountIds: ReadonlyArray<string>, merchantIds: ReadonlyArray<string>) {
  return defineFields({
    label: f.text({ operators: OPERATORS_OF.label, minLength: 1, maxLength: MAX_LABEL_TEXT }),
    merchant: f.enum(
      merchantIds.map((id) => ({ value: id, label: id })),
      { operators: OPERATORS_OF.merchant },
    ),
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
    case "merchant":
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
  | { readonly reason: "unknown_account"; readonly index: number }
  | { readonly reason: "unknown_merchant"; readonly index: number };

/**
 * What is wrong with conditions already decoded, against the user's accounts and merchants; null
 * when nothing. qnot checks each value for its field (an account or a merchant the user has, a day
 * of the month); a date must also exist, and a range go upwards.
 */
export function conditionsProblem(
  conditions: Conditions,
  accountIds: ReadonlyArray<string>,
  merchantIds: ReadonlyArray<string>,
): ConditionsProblem | null {
  if (conditions.children.length === 0) {
    return { reason: "empty" };
  }

  if (conditions.children.length > MAX_CONDITIONS) {
    return { reason: "too_many" };
  }

  const issues = validateQuery(fieldsOf(accountIds, merchantIds), conditions).filter(
    (issue) => issue.severity === "error",
  );

  const [first] = issues;

  if (first !== undefined) {
    const index = first.path[0] ?? 0;

    switch (conditions.children[index]?.field) {
      case "account": {
        return { reason: "unknown_account", index };
      }

      case "merchant": {
        return { reason: "unknown_merchant", index };
      }

      default: {
        return { reason: "invalid", index };
      }
    }
  }

  const wrong = conditions.children.findIndex((each) => goesDownwards(each) || namesNoDay(each));

  return wrong === -1 ? null : { reason: "invalid", index: wrong };
}

/** The merchants the conditions name, each once. */
export function merchantsNamed(conditions: Conditions): ReadonlyArray<string> {
  return [
    ...new Set(
      conditions.children.flatMap((each) => (isMerchantCondition(each) ? [each.value] : [])),
    ),
  ];
}

/** Whether the conditions read a line's merchant, which only JavaScript can tell. */
export const readsMerchant = (conditions: Conditions) =>
  conditions.children.some(isMerchantCondition);

/** The conditions but those on the merchant: what qnot reads, in JavaScript and in SQL alike. */
const withoutMerchant = (conditions: Conditions): Conditions => ({
  ...conditions,
  children: conditions.children.filter((each) => !isMerchantCondition(each)),
});

const accountsNamed = (conditions: Conditions) =>
  conditions.children.flatMap((each) => (each.field === "account" ? [each.value] : []));

/**
 * Whether a line's merchant meets the merchant conditions: it is each one named. A line of no
 * merchant meets none; a merchant deleted since is no line's, and its condition matches nothing.
 */
export function meetsMerchants(conditions: Conditions, merchantId: string | null): boolean {
  return conditions.children.filter(isMerchantCondition).every((each) => each.value === merchantId);
}

/**
 * The test of a line, compiled once. Conditions that passed `conditionsProblem` never meet a
 * condition qnot cannot read; one that would (an account deleted since) matches no line. The
 * merchant conditions are tested here, apart from qnot's.
 */
export function matcherOf(conditions: Conditions): (row: ConditionRow) => boolean {
  const others = withoutMerchant(conditions);

  const meets =
    others.children.length === 0
      ? () => true
      : compile(fieldsOf(accountsNamed(others), []), others, {
          incompleteRules: false,
          invalidRules: false,
        });

  return (row) => meetsMerchants(conditions, row.merchant) && meets(row);
}

/**
 * The conditions but the merchant's as qnot's SQL, with `$n` placeholders and their values (`./sql`
 * binds them): every line meets none of them, and none an empty group of no merchant either.
 */
export function conditionsQuery(conditions: Conditions) {
  const others = withoutMerchant(conditions);

  return encode(
    sqlFormat({
      dialect: "postgres",
      params: "numbered",
      quoteIdentifiers: true,
      caseInsensitive: true,
      emptyQuery: readsMerchant(conditions) ? "all" : "none",
    }),
    others,
    fieldsOf(accountsNamed(others), []),
  );
}

/**
 * The conditions once the merchant `from` was merged into `into`: each condition naming `from`
 * names `into`. The same conditions when none names `from`.
 */
export function mergedMerchant(conditions: Conditions, from: string, into: string): Conditions {
  return {
    ...conditions,
    children: conditions.children.map((each) =>
      isMerchantCondition(each) && each.value === from ? { ...each, value: into } : each,
    ),
  };
}
