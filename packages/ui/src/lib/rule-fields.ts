import { defineFields, f } from "@qnot/core";
import type { QueryOf } from "@qnot/core";

// What a rule's conditions are made of, as the editor and the list draw them (#25): the fields, the
// operators each takes and the shape of a condition, as plain data and on qnot's own types. The
// server's checks are `@gousset/core`'s (`rule-values`): the app decodes what the editor gives with
// them, and its type checker holds the two declarations to the same shape.

/** The fields a condition reads, in the order the editor offers them. */
export const RULE_FIELDS = ["label", "account", "amount", "direction", "day", "date"] as const;

export type RuleField = (typeof RULE_FIELDS)[number];

/** The operators each field takes, in the order the editor offers them. */
export const RULE_OPERATORS = {
  label: ["contains", "startsWith", "endsWith", "eq", "notContains"],
  account: ["eq", "neq"],
  amount: ["eq", "between", "gte", "lte", "gt", "lt", "neq"],
  direction: ["eq"],
  day: ["eq", "between", "gte", "lte"],
  date: ["gte", "lte", "between", "eq"],
} as const;

export type RuleOperator = (typeof RULE_OPERATORS)[RuleField][number];

type Between<Value> = { readonly operator: "between"; readonly value: readonly [Value, Value] };

/**
 * One condition, complete: a piece of label (any case), an account's id, an amount without its
 * sign in its account's units (12.5 for €12.50), money out or in, a day of the month, a booking date
 * (`YYYY-MM-DD`); `between` takes two values, both included.
 */
export type RuleCondition = { readonly kind: "rule" } & (
  | {
      readonly field: "label";
      readonly operator: (typeof RULE_OPERATORS)["label"][number];
      readonly value: string;
    }
  | {
      readonly field: "account";
      readonly operator: (typeof RULE_OPERATORS)["account"][number];
      readonly value: string;
    }
  | {
      readonly field: "amount";
      readonly operator: Exclude<(typeof RULE_OPERATORS)["amount"][number], "between">;
      readonly value: number;
    }
  | ({ readonly field: "amount" } & Between<number>)
  | { readonly field: "direction"; readonly operator: "eq"; readonly value: "out" | "in" }
  | {
      readonly field: "day";
      readonly operator: Exclude<(typeof RULE_OPERATORS)["day"][number], "between">;
      readonly value: number;
    }
  | ({ readonly field: "day" } & Between<number>)
  | {
      readonly field: "date";
      readonly operator: Exclude<(typeof RULE_OPERATORS)["date"][number], "between">;
      readonly value: string;
    }
  | ({ readonly field: "date" } & Between<string>)
);

/** A rule's conditions, complete: one group, every condition of which a line must meet. */
export type RuleConditions = {
  readonly kind: "group";
  readonly combinator: "and";
  readonly children: ReadonlyArray<RuleCondition>;
};

/**
 * The fields as qnot's store holds them, with the user's accounts as the only ones a condition may
 * name. qnot's own checks only mark what is still to fill in; the server's are the rule.
 */
export function ruleFields(accountIds: ReadonlyArray<string>) {
  return defineFields({
    label: f.text({ operators: RULE_OPERATORS.label, minLength: 1 }),
    account: f.enum(
      accountIds.map((id) => ({ value: id, label: id })),
      { operators: RULE_OPERATORS.account },
    ),
    amount: f.number({ operators: RULE_OPERATORS.amount, min: 0 }),
    direction: f.enum(["out", "in"], { operators: RULE_OPERATORS.direction }),
    day: f.number({ operators: RULE_OPERATORS.day, integer: true, min: 1, max: 31 }),
    date: f.date({ operators: RULE_OPERATORS.date }),
  });
}

export type RuleFields = ReturnType<typeof ruleFields>;

/** The conditions as the editor holds them: values may still be missing while the user types. */
export type RuleConditionsDraft = QueryOf<RuleFields>;
