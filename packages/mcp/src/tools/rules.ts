import {
  MAX_RULES,
  RuleJobs,
  accountNamed,
  createRule,
  deleteRule,
  editRule,
  listRules,
  moveRule,
  showRule,
  startApplyToPast,
} from "@gousset/core";
import type {
  AccountStore,
  CategoryStore,
  Merchants,
  RuleAccount,
  RuleDetail,
  RuleJobOutcome,
  RuleReach,
  RuleSummary,
} from "@gousset/core";
import {
  CONDITION_FIELDS,
  Condition,
  MAX_CONDITIONS,
  MAX_LABEL_TEXT,
} from "@gousset/core/rule-values";
import type { ConditionField, Conditions, OPERATORS_OF } from "@gousset/core/rule-values";
import type { UserData } from "@gousset/db/user-data";
import { Duration, Effect, Option, Result, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { named } from "./accounts";
import { namedCategory, pathText } from "./categories";
import { merchantNamed } from "./merchants";

/** Every operator a condition may take; which field takes which is checked by `Condition`. */
const OPERATORS = [
  "contains",
  "startsWith",
  "endsWith",
  "eq",
  "notContains",
  "neq",
  "between",
  "gte",
  "lte",
  "gt",
  "lt",
] as const;

const Scalar = Schema.Union([Schema.String, Schema.Number]);

/** A condition as a caller writes it: an account by its name, not its id. */
const WrittenCondition = Schema.Struct({
  field: Schema.Literals(CONDITION_FIELDS),
  operator: Schema.Literals(OPERATORS),
  value: Schema.Union([Scalar, Schema.Array(Scalar)]),
  institution: Schema.optional(Schema.String),
});

export type WrittenCondition = typeof WrittenCondition.Type;

const RulesInput = Schema.Struct({
  action: Schema.Literals(["list", "show", "create", "edit", "disable", "delete", "apply_to_past"]),
  // The description says what each field is for; its fields repeat none of it (docs/mcp.md's
  // listing budget).
  rule: Schema.optional(Schema.String),
  conditions: Schema.optional(
    Schema.Array(WrittenCondition).check(Schema.isMaxLength(MAX_CONDITIONS)),
  ),
  merchant: Schema.optional(Schema.NullOr(Schema.String)),
  category: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.Literals(["expense", "income"])),
  enabled: Schema.optional(Schema.Boolean),
  place: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_RULES }))),
  from_correction: Schema.optional(Schema.Boolean),
  include_by_hand: Schema.optional(Schema.Boolean),
});

type RulesInput = typeof RulesInput.Type;

type Encoded = typeof RulesInput.Encoded;

const encodeInput = Schema.encodeSync(RulesInput);

const CREATE_EXAMPLE = {
  action: "create",
  conditions: [
    { field: "label", operator: "contains", value: "GREENMARKET" },
    { field: "account", operator: "eq", value: "Current account" },
    { field: "amount", operator: "between", value: [10, 20] },
  ],
  merchant: "Greenmarket",
  category: "Groceries",
} as const satisfies Encoded;

const DESCRIPTION = `Rules classify lines by themselves: conditions a line must all meet, and a merchant, a category or both to set; tried in order, the first that applies wins. They classify each new line; lines already there change only with \`apply_to_past\`, which leaves lines classified by hand alone unless \`include_by_hand: true\`. \`list\`: in order, each a sentence ending with its id; \`show\`: one, with its effect on the lines already there.

Use it so lines like one are classified alike from now on: \`lines\` \`classify\` proposes the exact create call.

Writes (write scope): \`create\` (\`conditions\`; \`merchant\`, \`category\` ("Parent > Child"; \`kind\` when both kinds have the name) or both, by name; \`from_correction: true\` after a correction); \`edit\` one by \`rule\` (its id): \`conditions\` (replaced whole), \`merchant\` or \`category\` (null clears), \`enabled\`, \`place\` (from 1); \`disable\` turns one off; \`delete\`; \`apply_to_past\` waits up to 15 s and answers how many lines changed.

A condition is {"field","operator","value"}: label (contains, startsWith, endsWith, eq, notContains; any case); account (eq, neq; by name as \`accounts\` lists it, with "institution" when two share it); amount (eq, neq, gte, lte, gt, lt, between; no sign, in the account's currency: 12.5 for 12.50); direction (eq: "out", "in"); day of the month (eq, gte, lte, between; 1 to 31); date (eq, gte, lte, between; YYYY-MM-DD). between takes [low, high], both included. At most ${MAX_CONDITIONS}.

Refused, saying what to do: no or too many conditions, a malformed value, an unknown or ambiguous name, nothing set, an archived category, an unknown id, ${MAX_RULES} rules.

Example: ${JSON.stringify(CREATE_EXAMPLE)}`;

const call = (input: Encoded) => `rules ${JSON.stringify(input)}`;

const refuse = (message: string, example: Encoded) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

const LIST_CALL = { action: "list" } as const satisfies Encoded;

const lines = (count: number) => (count === 1 ? "1 line" : `${count} lines`);

/** An id as the caller gave it, cut so that one long argument never fills an error. */
const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

const LABEL_WORDS = {
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  eq: "is",
  notContains: "does not contain",
} as const satisfies { readonly [Operator in (typeof OPERATORS_OF.label)[number]]: string };

const COMPARED = {
  eq: "is",
  neq: "is not",
  gte: "is at least",
  lte: "is at most",
  gt: "is over",
  lt: "is under",
} as const;

const ON_DAY = { eq: "is", gte: "is on or after", lte: "is on or before" } as const;

/** One condition in words, its account by name. */
function conditionText(each: Condition, accounts: ReadonlyArray<RuleAccount>): string {
  switch (each.field) {
    case "label": {
      return `label ${LABEL_WORDS[each.operator]} "${each.value}"`;
    }

    case "account": {
      const found = accounts.find((account) => account.id === each.value);
      const name = found === undefined ? "an account deleted since" : named(found);

      return `account ${each.operator === "eq" ? "is" : "is not"} ${name}`;
    }

    case "amount": {
      return each.operator === "between"
        ? `amount is between ${each.value[0]} and ${each.value[1]}`
        : `amount ${COMPARED[each.operator]} ${each.value}`;
    }

    case "direction": {
      return each.value === "out" ? "money leaves the account" : "money comes in";
    }

    case "day": {
      return each.operator === "between"
        ? `day of the month is between ${each.value[0]} and ${each.value[1]}`
        : `day of the month ${COMPARED[each.operator]} ${each.value}`;
    }

    case "date": {
      return each.operator === "between"
        ? `date is between ${each.value[0]} and ${each.value[1]}`
        : `date ${ON_DAY[each.operator]} ${each.value}`;
    }
  }
}

/** What a rule sets, in words. */
function effectText(rule: RuleSummary): string {
  const category = rule.category;

  const set = [
    ...(rule.merchant === null ? [] : [`merchant ${rule.merchant.name}`]),
    ...(category === null
      ? []
      : [
          `category ${pathText(category)}${category.archived ? " (archived: it classifies nothing new)" : ""}`,
        ]),
  ];

  return set.length === 0 ? "nothing: its merchant and category are gone" : set.join(", ");
}

/**
 * One rule as a sentence: "1. If label contains "GREENMARKET", then merchant Greenmarket, category
 * Groceries. On. Classified 12 lines. Id: …".
 */
export function ruleText(rule: RuleSummary, accounts: ReadonlyArray<RuleAccount>): string {
  const conditions = rule.conditions.children.map((each) => conditionText(each, accounts));

  return `${rule.place}. If ${conditions.join(" and ")}, then ${effectText(rule)}. ${rule.enabled ? "On" : "Off"}. Classified ${lines(rule.appliedCount)}. Id: ${rule.id}`;
}

/** What a rule would do to the lines already there. */
export function reachText(reach: RuleReach): string {
  return `It applies to ${lines(reach.lines)} already there; ${reach.toChange} would change; ${reach.byHand} were classified otherwise by hand, which apply_to_past leaves alone unless include_by_hand is true.`;
}

const applyCall = (rule: string) => call({ action: "apply_to_past", rule });

/** A rule with what it would do, and the call that applies it to the lines already there. */
function detailText(detail: RuleDetail): string {
  return [
    ruleText(detail, detail.accounts),
    reachText(detail.reach),
    `To apply it to the lines already there: ${applyCall(detail.id)}`,
  ].join("\n");
}

function listText(rules: ReadonlyArray<RuleSummary>, accounts: ReadonlyArray<RuleAccount>) {
  if (rules.length === 0) {
    return `The user has no rule yet. A rule classifies lines by itself; make one with: ${call(CREATE_EXAMPLE)}`;
  }

  return [
    `${rules.length} rule(s), in the order they are tried: the first whose conditions a line meets, and which applies to it, classifies it. Each ends with its id, which show, edit, disable, delete and apply_to_past take.`,
    rules.map((rule) => ruleText(rule, accounts)).join("\n"),
  ].join("\n\n");
}

/** What each field takes, and a condition of it that is valid. */
const FIELD_HELP = {
  label: {
    text: `label takes contains, startsWith, endsWith, eq or notContains, and a text of 1 to ${MAX_LABEL_TEXT} characters, any case.`,
    example: { field: "label", operator: "contains", value: "GREENMARKET" },
  },
  account: {
    text: "account takes eq or neq, and the account's name as accounts lists it (any case), with institution when two accounts share the name.",
    example: { field: "account", operator: "eq", value: "Current account" },
  },
  amount: {
    text: "amount takes eq, neq, gte, lte, gt or lt and a number from 0, or between and [low, high] going upwards: the line's amount without its sign, in its account's currency (12.5 for 12.50).",
    example: { field: "amount", operator: "between", value: [10, 20] },
  },
  direction: {
    text: 'direction takes eq and "out" (money leaves the account) or "in" (money comes in).',
    example: { field: "direction", operator: "eq", value: "out" },
  },
  day: {
    text: "day, the day of the month the line was booked, takes eq, gte or lte and a whole number from 1 to 31, or between and [first, last] going upwards.",
    example: { field: "day", operator: "between", value: [1, 5] },
  },
  date: {
    text: "date, the day the line was booked, takes eq, gte or lte and a day that exists, YYYY-MM-DD, or between and [from, to] going upwards.",
    example: { field: "date", operator: "gte", value: "2026-01-01" },
  },
} as const satisfies {
  readonly [Field in ConditionField]: {
    readonly text: string;
    readonly example: WrittenCondition;
  };
};

/** The call a refusal of conditions gives: the same create or edit, with one valid condition. */
type Retry = (conditions: ReadonlyArray<WrittenCondition>) => Encoded;

/** Condition `index` cannot be read: what its field takes. */
function conditionRefusal(
  written: ReadonlyArray<WrittenCondition>,
  index: number,
  retry: Retry,
): Effect.Effect<never, ToolRefusal> {
  const each = written[index];

  if (each === undefined) {
    return refuse(
      "The rule's conditions cannot be read: give conditions again, in full.",
      retry([FIELD_HELP.label.example]),
    );
  }

  const help = FIELD_HELP[each.field];

  return refuse(
    `Condition ${index + 1} (${each.field} ${each.operator}) cannot be read: ${help.text}`,
    retry([help.example]),
  );
}

const decodeCondition = Schema.decodeUnknownOption(Condition);

/**
 * The conditions as qnot's group, each account named by its id (`accountIds`, by index), or the
 * index of the first condition that cannot be read.
 */
export function groupOf(
  written: ReadonlyArray<WrittenCondition>,
  accountIds: ReadonlyArray<string | undefined>,
): Result.Result<Conditions, number> {
  const children: Array<Condition> = [];

  for (const [index, each] of written.entries()) {
    const decoded = decodeCondition({
      kind: "rule",
      field: each.field,
      operator: each.operator,
      value: each.field === "account" ? (accountIds[index] ?? each.value) : each.value,
    });

    if (Option.isNone(decoded)) {
      return Result.fail(index);
    }

    children.push(decoded.value);
  }

  return Result.succeed({ kind: "group", combinator: "and", children });
}

const isText = Schema.is(Schema.String);

/** The id of each account a condition names, by index; undefined for other conditions. */
function accountIdsOf(owner: string, written: ReadonlyArray<WrittenCondition>) {
  return Effect.forEach(written, (each, index) => {
    const { value } = each;

    if (each.field !== "account" || !isText(value)) {
      return Effect.succeed(undefined);
    }

    const institution = each.institution?.trim();

    return accountNamed(owner, value.trim(), institution).pipe(
      Effect.map((found): string | undefined => found.id),
      Effect.catchTags({
        AccountNameUnknown: (unknown) =>
          Effect.fail(
            new ToolRefusal({
              message:
                unknown.accounts.length === 0
                  ? "The user has no account in Gousset yet: a condition on the account names none."
                  : `Condition ${index + 1}: no account of the user's is named "${clip(unknown.name)}"${institution === undefined ? "" : ` at "${clip(institution)}"`}. Their accounts: ${unknown.accounts.map(named).join(", ")}. Name one as written here (any case), the bank in brackets as institution.`,
              example: `accounts ${JSON.stringify({ action: "list" })}`,
            }),
          ),
        AccountNameAmbiguous: (ambiguous) =>
          Effect.fail(
            new ToolRefusal({
              message: `Condition ${index + 1}: several accounts of the user's are named "${clip(ambiguous.name)}": ${ambiguous.matches.map(named).join(", ")}. Add institution, the bank written in brackets, to the condition.`,
              example: `accounts ${JSON.stringify({ action: "list" })}`,
            }),
          ),
      }),
    );
  });
}

/** The written conditions as qnot's group, or the refusal to give. */
function conditionsOf(owner: string, written: ReadonlyArray<WrittenCondition>, retry: Retry) {
  return Effect.gen(function* () {
    const accountIds = yield* accountIdsOf(owner, written);
    const group = groupOf(written, accountIds);

    return Result.isSuccess(group)
      ? group.success
      : yield* conditionRefusal(written, group.failure, retry);
  });
}

/** Where a rule's merchant and category come from: the caller's names. */
function effectOf(owner: string, input: RulesInput, encoded: Encoded) {
  return Effect.gen(function* () {
    const { merchant, category } = input;

    const merchantId =
      merchant === undefined || merchant === null
        ? merchant
        : (yield* merchantNamed(owner, merchant.trim())).id;

    const categoryId =
      category === undefined || category === null
        ? category
        : (yield* namedCategory(owner, category, input.kind, (name, kind) =>
            call({ ...encoded, category: name, kind }),
          )).id;

    return { merchantId, categoryId };
  });
}

const NOT_FOUND = (rule: string) =>
  refuse(
    `No rule of the user's has the id "${clip(rule)}". list gives each rule's id, after Id:.`,
    LIST_CALL,
  );

/** The refusals of a rule's conditions and effect, as core gives them, saying what to do. */
function refusalsOf(input: RulesInput, encoded: Encoded, retry: Retry) {
  const written = input.conditions ?? [];

  return {
    RuleConditionsRefused: (refused: {
      readonly reason: "empty" | "too_many" | "invalid" | "unknown_account";
      readonly index: number | null;
    }) => {
      switch (refused.reason) {
        case "empty": {
          return refuse(
            "A rule needs at least one condition: give conditions, every one a line must meet.",
            retry([FIELD_HELP.label.example]),
          );
        }

        case "too_many": {
          return refuse(
            `A rule has at most ${MAX_CONDITIONS} conditions: keep those that tell its lines apart.`,
            retry(written.slice(0, MAX_CONDITIONS)),
          );
        }

        case "invalid": {
          return conditionRefusal(written, refused.index ?? -1, retry);
        }

        case "unknown_account": {
          return Effect.fail(
            new ToolRefusal({
              message: `Condition ${(refused.index ?? 0) + 1} names an account the user no longer has: name one of their accounts as accounts lists it.`,
              example: `accounts ${JSON.stringify({ action: "list" })}`,
            }),
          );
        }
      }
    },
    RuleEffectRefused: (refused: { readonly reason: "nothing_set" | "category_archived" }) =>
      refused.reason === "nothing_set"
        ? refuse(
            "A rule sets a merchant, a category, or both: give merchant or category (by name), and never clear both.",
            { ...encoded, merchant: undefined, category: "Groceries" },
          )
        : Effect.fail(
            new ToolRefusal({
              message: `"${clip(input.category ?? "")}" is archived: it classifies nothing new. Restore it, or choose a category in use.`,
              example: `categories ${JSON.stringify({ action: "archive", category: input.category ?? "", restore: true })}`,
            }),
          ),
    MerchantNotFound: () =>
      Effect.fail(
        new ToolRefusal({
          message:
            "The merchant is gone: it was just merged away. Find the name it goes by now, then call again with it.",
          example: `merchants ${JSON.stringify({ action: "list" })}`,
        }),
      ),
    CategoryNotFound: () =>
      Effect.fail(
        new ToolRefusal({
          message:
            "The category is gone: it was just merged away or deleted. Find the name it goes by now, then call again with it.",
          example: `categories ${JSON.stringify({ action: "list" })}`,
        }),
      ),
  };
}

function create(owner: string, input: RulesInput) {
  const written = input.conditions;
  const encoded = encodeInput(input);

  if (written === undefined) {
    return refuse(
      "create needs conditions, every one a line must meet, and merchant, category or both, by name.",
      CREATE_EXAMPLE,
    );
  }

  const retry: Retry = (conditions) => ({ ...encoded, conditions });
  const refusals = refusalsOf(input, encoded, retry);

  return Effect.gen(function* () {
    const conditions = yield* conditionsOf(owner, written, retry);
    const effect = yield* effectOf(owner, input, encoded);

    const made = yield* createRule(owner, {
      conditions,
      merchantId: effect.merchantId ?? null,
      categoryId: effect.categoryId ?? null,
      createdFrom: input.from_correction === true ? "correction" : "user",
    });

    return `Created this rule, tried after the user's other rules; it classifies the lines imported from now on:\n${detailText(made)}`;
  }).pipe(
    Effect.catchTags({
      ...refusals,
      TooManyRules: (many) =>
        refuse(
          `The user has ${many.limit} rules, the most there may be: edit one of them instead, or delete one on Gousset's Rules page.`,
          LIST_CALL,
        ),
      QueryFailed: Effect.die,
    }),
  );
}

function edit(owner: string, input: RulesInput) {
  const rule = input.rule?.trim() ?? "";
  const encoded = encodeInput(input);

  if (rule === "") {
    return refuse("edit needs rule: the rule's id, as list writes it after Id:.", LIST_CALL);
  }

  const changes =
    input.conditions !== undefined ||
    input.merchant !== undefined ||
    input.category !== undefined ||
    input.enabled !== undefined;

  if (!changes && input.place === undefined) {
    return refuse(
      "edit needs what changes: conditions (replaced whole), merchant or category (null clears), enabled, or place.",
      { action: "edit", rule, place: 1 },
    );
  }

  const retry: Retry = (conditions) => ({ ...encoded, conditions });
  const refusals = refusalsOf(input, encoded, retry);
  const written = input.conditions;

  return Effect.gen(function* () {
    if (changes) {
      const conditions =
        written === undefined ? undefined : yield* conditionsOf(owner, written, retry);

      const effect = yield* effectOf(owner, input, encoded);

      yield* editRule(owner, rule, {
        conditions,
        merchantId: effect.merchantId,
        categoryId: effect.categoryId,
        enabled: input.enabled,
      });
    }

    if (input.place !== undefined) {
      yield* moveRule(owner, rule, input.place);
    }

    const detail = yield* showRule(owner, rule);

    return `Changed this rule; the lines it classified before stay as they are:\n${detailText(detail)}`;
  }).pipe(
    Effect.catchTags({
      ...refusals,
      RuleNotFound: () => NOT_FOUND(rule),
      QueryFailed: Effect.die,
    }),
  );
}

function disable(owner: string, input: RulesInput) {
  const rule = input.rule?.trim() ?? "";

  if (rule === "") {
    return refuse("disable needs rule: the rule's id, as list writes it after Id:.", LIST_CALL);
  }

  const encoded = encodeInput(input);

  return editRule(owner, rule, { enabled: false }).pipe(
    Effect.map(
      (detail) =>
        `Turned off: ${ruleText(detail, detail.accounts)}\nIt classifies no new line until it is turned on again (${call({ action: "edit", rule: detail.id, enabled: true })}); the lines it classified keep their category.`,
    ),
    Effect.catchTags({
      ...refusalsOf(input, encoded, (conditions) => ({ action: "edit", rule, conditions })),
      RuleNotFound: () => NOT_FOUND(rule),
      QueryFailed: Effect.die,
    }),
  );
}

/** Deletes a rule; the lines it classified keep their category and merchant. */
function remove(owner: string, input: RulesInput) {
  const rule = input.rule?.trim() ?? "";

  if (rule === "") {
    return refuse("delete needs rule: the rule's id, as list writes it after Id:.", LIST_CALL);
  }

  return Effect.gen(function* () {
    const detail = yield* showRule(owner, rule);

    yield* deleteRule(owner, detail.id);

    return `Deleted: ${ruleText(detail, detail.accounts)}\nThe lines it classified keep their category and merchant. To only stop it, turn a rule off instead: ${call({ action: "disable", rule: "…" })}`;
  }).pipe(Effect.catchTags({ RuleNotFound: () => NOT_FOUND(rule), QueryFailed: Effect.die }));
}

/** How often, and how many times, apply_to_past reads its job again: 15 seconds at most. */
const POLL = Duration.millis(500);
const SETTLE_POLLS = 30;

/** Reads the job again until it is over, for 15 seconds at most. */
function settle(owner: string, jobId: string) {
  return Effect.gen(function* () {
    const jobs = yield* RuleJobs;
    let outcome: RuleJobOutcome = yield* jobs.outcome(owner, jobId);

    for (let poll = 0; poll < SETTLE_POLLS && outcome.state === "running"; poll += 1) {
      yield* Effect.sleep(POLL);
      outcome = yield* jobs.outcome(owner, jobId);
    }

    return outcome;
  });
}

/** What applying a rule to the past did, by hand-classified lines too. */
function appliedText(
  detail: RuleDetail,
  changed: number,
  includeByHand: boolean,
  byHand: number,
): string {
  const done = `Applied rule ${detail.place} to the lines already there: ${lines(changed)} changed, each now classified by the rule.`;

  if (byHand === 0) {
    return done;
  }

  return includeByHand
    ? `${done} Among them, ${lines(byHand)} the user had classified otherwise by hand.`
    : `${done} ${lines(byHand)} the user classified otherwise by hand ${byHand === 1 ? "was" : "were"} left alone; to change them too: ${call({ action: "apply_to_past", rule: detail.id, include_by_hand: true })}`;
}

function applyToPast(owner: string, input: RulesInput) {
  const rule = input.rule?.trim() ?? "";
  const includeByHand = input.include_by_hand === true;

  if (rule === "") {
    return refuse(
      "apply_to_past needs rule: the rule's id, as list writes it after Id:.",
      LIST_CALL,
    );
  }

  return Effect.gen(function* () {
    const before = yield* showRule(owner, rule);
    const jobId = yield* startApplyToPast(owner, before.id, includeByHand);
    const outcome = yield* settle(owner, jobId);

    switch (outcome.state) {
      case "done": {
        return appliedText(before, outcome.changed, includeByHand, before.reach.byHand);
      }

      case "running": {
        return `Rule ${before.place} is still being applied to the lines already there after 15 seconds: it goes on in Gousset's background jobs. In a moment, show it: what would still change goes down to 0 once it is done. ${call({ action: "show", rule: before.id })}`;
      }

      case "failed": {
        return yield* refuse(
          "Applying the rule to the lines already there failed in Gousset's background job: no line changed. Try again; if it keeps failing, tell the administrator of this Gousset installation.",
          { action: "apply_to_past", rule: before.id, include_by_hand: input.include_by_hand },
        );
      }
    }
  }).pipe(
    Effect.catchTags({
      RuleNotFound: () => NOT_FOUND(rule),
      RuleJobUnavailable: () =>
        refuse(
          "Gousset's background jobs did not answer: no line changed. Try again in a moment.",
          { action: "apply_to_past", rule, include_by_hand: input.include_by_hand },
        ),
      QueryFailed: Effect.die,
    }),
  );
}

/**
 * The one sentence `lines` `classify` and `merchants` `assign` end with: the exact call that makes a
 * rule of the correction, setting its category or its merchant. Its condition is `words`
 * (`ruleWords`: the cleaned merchant name, the intermediary through who was paid, or the label);
 * none for a line of no label.
 */
export function proposedRule(
  words: string,
  sets: { readonly category: string } | { readonly merchant: string },
): string | undefined {
  const text = words.slice(0, MAX_LABEL_TEXT);

  if (text === "") {
    return undefined;
  }

  const lead =
    "category" in sets
      ? "To classify lines like it this way from now on"
      : `To give lines like it ${sets.merchant} as merchant from now on`;

  return `${lead}, propose this rule to the user: ${call({
    action: "create",
    conditions: [{ field: "label", operator: "contains", value: text }],
    ...sets,
    from_correction: true,
  })}`;
}

/**
 * The rules family (docs/mcp.md, "Tools"; #25): read, made, changed, turned off and applied to
 * the lines already there, with the write scope.
 */
export const rulesTool = defineTool<
  RulesInput,
  Encoded,
  UserData | RuleJobs | AccountStore | Merchants | CategoryStore
>({
  name: "rules",
  title: "Rules",
  description: DESCRIPTION,
  // A repeated create makes a second rule.
  idempotent: false,
  input: RulesInput,
  example: CREATE_EXAMPLE,
  access: {
    list: "read",
    show: "read",
    create: "write",
    edit: "write",
    disable: "write",
    delete: "write",
    apply_to_past: "write",
  },
  run: (input, caller) => {
    const owner = caller.userId;

    switch (input.action) {
      case "list": {
        return listRules(owner).pipe(
          Effect.map((list) => listText(list.rules, list.accounts)),
          Effect.catchTags({ QueryFailed: Effect.die }),
        );
      }

      case "show": {
        const rule = input.rule?.trim() ?? "";

        if (rule === "") {
          return refuse("show needs rule: the rule's id, as list writes it after Id:.", LIST_CALL);
        }

        return showRule(owner, rule).pipe(
          Effect.map(detailText),
          Effect.catchTags({ RuleNotFound: () => NOT_FOUND(rule), QueryFailed: Effect.die }),
        );
      }

      case "create": {
        return create(owner, input);
      }

      case "edit": {
        return edit(owner, input);
      }

      case "disable": {
        return disable(owner, input);
      }

      case "delete": {
        return remove(owner, input);
      }

      case "apply_to_past": {
        return applyToPast(owner, input);
      }
    }
  },
});
