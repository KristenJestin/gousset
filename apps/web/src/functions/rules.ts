import {
  createRule as createCoreRule,
  deleteRule as deleteCoreRule,
  editRule as editCoreRule,
  lineMerchant,
  listRules,
  moveRule as moveCoreRule,
  previewRule,
  ruleWords,
  showLine,
  showRule,
  startApplyToPast,
} from "@gousset/core";
import type { RuleConditionsRefused, RuleEffectRefused } from "@gousset/core";
import { Conditions, MAX_CONDITIONS } from "@gousset/core/rule-values";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { LineId } from "@/lib/operations-search";
import { proposalConditions } from "@/lib/rule-conditions";
import { runCore } from "@/services";

import { CategoryId } from "./categories";
import { signedIn, slowedInDevelopment } from "./month";

// The rules' calls (#25), on `@gousset/core`'s rules, as the MCP door's `rules` tool reads and
// changes them. A refusal comes back as a code the page translates, with the condition it is about
// when one is the cause.

/**
 * Why a read or a change of the rules was refused, as a code for the interface to translate. A
 * failure of the server itself is thrown, not answered with a code.
 */
export type RuleRefusalCode =
  | "RULE_NOT_FOUND"
  | "CONDITIONS_EMPTY"
  | "CONDITIONS_TOO_MANY"
  | "CONDITION_INVALID"
  | "CONDITION_UNKNOWN_ACCOUNT"
  | "NOTHING_SET"
  | "CATEGORY_ARCHIVED"
  | "CATEGORY_NOT_FOUND"
  | "MERCHANT_NOT_FOUND"
  | "MERCHANT_INTERMEDIARY"
  | "TOO_MANY_RULES"
  | "JOB_UNAVAILABLE"
  | "LINE_NOT_FOUND"
  | "NO_WORDS";

/**
 * A refusal's code, the condition it is about (from 0) when one is the cause, and the limit it
 * names when it is one (the most conditions, the most rules).
 */
const refused = (code: RuleRefusalCode, index: number | null = null, limit: number | null = null) =>
  Effect.succeed({ ok: false as const, code, index, limit });

const CONDITION_CODES = {
  empty: "CONDITIONS_EMPTY",
  too_many: "CONDITIONS_TOO_MANY",
  invalid: "CONDITION_INVALID",
  unknown_account: "CONDITION_UNKNOWN_ACCOUNT",
} as const satisfies { [Reason in RuleConditionsRefused["reason"]]: RuleRefusalCode };

const EFFECT_CODES = {
  nothing_set: "NOTHING_SET",
  category_archived: "CATEGORY_ARCHIVED",
  merchant_intermediary: "MERCHANT_INTERMEDIARY",
} as const satisfies { [Reason in RuleEffectRefused["reason"]]: RuleRefusalCode };

/** Every refusal a rule's conditions and effect may meet, as its code. */
const DRAFT_REFUSALS = {
  RuleConditionsRefused: (refusal: RuleConditionsRefused) =>
    refused(
      CONDITION_CODES[refusal.reason],
      refusal.index,
      refusal.reason === "too_many" ? MAX_CONDITIONS : null,
    ),
  RuleEffectRefused: (refusal: RuleEffectRefused) => refused(EFFECT_CODES[refusal.reason]),
  CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
  MerchantNotFound: () => refused("MERCHANT_NOT_FOUND"),
};

/** A rule's id as the page gives it; one that names none is not found. */
const RuleId = Schema.String.check(Schema.isMaxLength(100));

/** A merchant's id as the page gives it; one the user does not have is refused with a code. */
const MerchantId = Schema.String.check(Schema.isMaxLength(100));

/** What a rule sets: a merchant, a category, or both; the core refuses neither. */
const Effects = {
  merchantId: Schema.NullOr(MerchantId),
  categoryId: Schema.NullOr(CategoryId),
};

/** The user's rules in the order they are tried, and the accounts their conditions may name. */
export const getRules = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(listRules(context.owner)));

/** One rule, with what it would do to the lines already there. One the user does not have: a code. */
export const getRule = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ ruleId: RuleId })))
  .handler(({ data, context }) =>
    runCore(
      showRule(context.owner, data.ruleId).pipe(
        Effect.map((rule) => ({ ok: true as const, rule })),
        Effect.catchTags({ RuleNotFound: () => refused("RULE_NOT_FOUND") }),
      ),
    ),
  );

/**
 * What a rule being written would do to the lines already there: how many it applies to, would
 * change, and were classified otherwise by hand; with `ruleId`, as a change of that saved rule.
 * Refused as making it would be. A POST: it carries the conditions, which an address would cut.
 */
export const getRuleReach = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ conditions: Conditions, ...Effects, ruleId: Schema.NullOr(RuleId) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      previewRule(context.owner, data).pipe(
        Effect.map((reach) => ({ ok: true as const, reach })),
        Effect.catchTags(DRAFT_REFUSALS),
      ),
    ),
  );

/**
 * Makes a rule, tried after the others; it classifies the lines imported from now on, and those
 * already there once applied to the past. Refused with a code: conditions none, too many or that
 * cannot be read, nothing set, a category archived, a merchant or a category gone, too many rules.
 */
export const createRule = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        conditions: Conditions,
        ...Effects,
        enabled: Schema.Boolean,
        createdFrom: Schema.Literals(["correction", "user"]),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      createCoreRule(context.owner, data).pipe(
        Effect.map((rule) => ({ ok: true as const, rule })),
        Effect.catchTags({
          ...DRAFT_REFUSALS,
          TooManyRules: (refusal) => refused("TOO_MANY_RULES", null, refusal.limit),
        }),
      ),
    ),
  );

/** Changes a rule: its conditions, what it sets, whether it is on. Refused as making one is. */
export const editRule = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        ruleId: RuleId,
        conditions: Schema.optional(Conditions),
        merchantId: Schema.optional(Effects.merchantId),
        categoryId: Schema.optional(Effects.categoryId),
        enabled: Schema.optional(Schema.Boolean),
      }),
    ),
  )
  .handler(({ data, context }) => {
    const { ruleId, ...edit } = data;

    return runCore(
      editCoreRule(context.owner, ruleId, edit).pipe(
        Effect.map((rule) => ({ ok: true as const, rule })),
        Effect.catchTags({
          ...DRAFT_REFUSALS,
          RuleNotFound: () => refused("RULE_NOT_FOUND"),
        }),
      ),
    );
  });

const OneRule = Schema.toStandardSchemaV1(Schema.Struct({ ruleId: RuleId }));

/** Deletes a rule: the lines it classified keep their category and merchant. */
export const deleteRule = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(OneRule)
  .handler(({ data, context }) =>
    runCore(
      deleteCoreRule(context.owner, data.ruleId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({ RuleNotFound: () => refused("RULE_NOT_FOUND") }),
      ),
    ),
  );

/** Moves a rule to `place` (from 1) in the order rules are tried; the list as it is then. */
export const moveRule = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ ruleId: RuleId, place: Schema.Int.check(Schema.isGreaterThan(0)) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      moveCoreRule(context.owner, data.ruleId, data.place).pipe(
        Effect.map((list) => ({ ok: true as const, list })),
        Effect.catchTags({ RuleNotFound: () => refused("RULE_NOT_FOUND") }),
      ),
    ),
  );

/**
 * Applies a rule to the lines already there, in a job the page follows (`/api/jobs/<id>/events`);
 * a line classified otherwise by hand only with `includeByHand`. Its job's id, or a code.
 */
export const applyRuleToPast = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ ruleId: RuleId, includeByHand: Schema.Boolean })),
  )
  .handler(({ data, context }) =>
    runCore(
      startApplyToPast(context.owner, data.ruleId, data.includeByHand).pipe(
        Effect.map((jobId) => ({ ok: true as const, jobId })),
        Effect.catchTags({
          RuleNotFound: () => refused("RULE_NOT_FOUND"),
          RuleJobUnavailable: () => refused("JOB_UNAVAILABLE"),
        }),
      ),
    ),
  );

/**
 * The rule a correction proposes (#25): "label contains" the words that name the line's merchant
 * in its label, for the category the user just chose or the merchant they gave a line paid through
 * an intermediary (#30), with how many lines already there it would change. An intermediary's line
 * is looked for by the intermediary through who was paid (`PAYPAL *PIXELPLAY`), never by the
 * intermediary alone, whichever is set: one whose label names no one after the intermediary
 * proposes none (`NO_WORDS`, which the page does not offer). A line, a category or a merchant gone:
 * a code.
 */
export const getRuleProposal = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, ...Effects })))
  .handler(({ data, context }) =>
    runCore(
      Effect.gen(function* () {
        const [line, paid] = yield* Effect.all([
          showLine(context.owner, data.lineId),
          lineMerchant(context.owner, data.lineId),
        ]);

        const words = ruleWords(line.label, line.counterpartyName, paid.intermediary !== null);

        if (words === null) {
          return yield* refused("NO_WORDS");
        }

        const reach = yield* previewRule(context.owner, {
          conditions: proposalConditions(words),
          merchantId: data.merchantId,
          categoryId: data.categoryId,
        });

        return { ok: true as const, words, reach };
      }).pipe(
        Effect.catchTags({
          ...DRAFT_REFUSALS,
          LineNotFound: () => refused("LINE_NOT_FOUND"),
        }),
      ),
    ),
  );
