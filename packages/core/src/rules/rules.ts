import {
  account,
  category,
  entry,
  entryPart,
  merchant,
  rule,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Option, Result, Schema } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { CategoryNotFound } from "../errors";
import { isId } from "../imports/rows";
import { MerchantNotFound } from "../merchants/errors";
import { Conditions, conditionRow, conditionsProblem, matcherOf } from "./conditions";
import type { ConditionRow } from "./conditions";
import { changes, firstApplying, targetOf } from "./effect";
import type { EffectFacts, RuleEntry, RuleSets, RuleTarget } from "./effect";
import { conditionsSql, unitsSql } from "./sql";
import { RuleConditionsRefused, RuleEffectRefused, RuleNotFound, TooManyRules } from "./errors";
import type { RuleJobUnavailable } from "./errors";

// The rules (#25; docs/data-model.md, v0.3, `rule`): when a line meets a rule's conditions, its
// entry gets the merchant and the category the rule sets, and is classified by the rule. Rules are
// tried in order, the first that applies wins. They apply to each new line at import, and to the
// lines already there when the user asks (a job, `applyRuleToPast`). A line the user classified by
// hand (`classified_by = user`) is never changed by a rule unless the user says so for that run.
//
// A rule applies to an entry when its category is of the entry's kind (an expense category to money
// that leaves) and not archived; a rule that sets only a merchant gives the entry that merchant's
// default category when it has one of the entry's kind, and keeps its category otherwise. Only an
// entry made of one whole line is a rule's: a line split or linked (#27) is the user's work.

/** The most rules a user may have. */
export const MAX_RULES = 200;

/** Where a rule comes from: a correction of a line, or the rules' own screen (or the MCP door). */
export type RuleOrigin = "correction" | "user";

/** A rule's category: archived ones stay shown, and classify nothing new. */
export type RuleCategory = LineCategory & { readonly archived: boolean };

/** One rule, as the list gives it. */
export type RuleSummary = {
  readonly id: string;
  /** Its place in the order rules are tried, from 1. */
  readonly place: number;
  readonly enabled: boolean;
  readonly conditions: Conditions;
  readonly merchant: { readonly id: string; readonly name: string } | null;
  readonly category: RuleCategory | null;
  /** How many lines it classified, at import and applied to the past. */
  readonly appliedCount: number;
  readonly createdFrom: RuleOrigin;
  readonly createdAt: string;
};

/** An account a condition may name: the list gives every one of the user's. */
export type RuleAccount = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
};

/** The user's rules in the order they are tried, and the accounts their conditions may name. */
export type RuleList = {
  readonly rules: ReadonlyArray<RuleSummary>;
  readonly accounts: ReadonlyArray<RuleAccount>;
};

/**
 * What a rule would do to the lines already there: how many it applies to, how many of those it
 * would change (classified by default or by another rule), and how many of those the user
 * classified otherwise by hand, which it changes only when asked.
 */
export type RuleReach = {
  readonly lines: number;
  readonly toChange: number;
  readonly byHand: number;
};

/** One rule with what it would do to the lines already there. */
export type RuleDetail = RuleSummary & {
  readonly reach: RuleReach;
  readonly accounts: ReadonlyArray<RuleAccount>;
};

/** What a rule sets: a merchant, a category, or both; at least one. */
export type RuleEffect = {
  readonly merchantId: string | null;
  readonly categoryId: string | null;
};

/** A rule to make. Its conditions are decoded already (`Conditions`); the core checks them. */
export type RuleInput = RuleEffect & {
  readonly conditions: Conditions;
  readonly enabled?: boolean;
  readonly createdFrom: RuleOrigin;
};

/** A rule's change: each field left out stays as it is. */
export type RuleEdit = {
  readonly conditions?: Conditions;
  readonly merchantId?: string | null;
  readonly categoryId?: string | null;
  readonly enabled?: boolean;
};

/** What applying a rule to the past changed. */
export type RuleApplied = {
  /** The lines whose entry it changed. */
  readonly changed: number;
  /** Among them, those the user had classified otherwise by hand. */
  readonly byHand: number;
};

/** A rule applied to the past, as its job carries it. */
export const RuleJobInput = Schema.Struct({
  ruleId: Schema.String,
  includeByHand: Schema.Boolean,
});

export type RuleJobInput = typeof RuleJobInput.Type;

/** Where a job applying a rule to the past stands. */
export type RuleJobOutcome =
  | { readonly state: "running" }
  | { readonly state: "done"; readonly changed: number }
  | { readonly state: "failed" };

/** Where applying a rule to the past goes: the app's job queue (`apps/web`). */
export class RuleJobs extends Context.Service<
  RuleJobs,
  {
    /** Sends the job for `owner`; its id, which the screen follows. */
    readonly send: (
      owner: string,
      input: RuleJobInput,
    ) => Effect.Effect<string, RuleJobUnavailable>;
    /** Where the job stands, and once done how many lines it changed. */
    readonly outcome: (
      owner: string,
      jobId: string,
    ) => Effect.Effect<RuleJobOutcome, RuleJobUnavailable>;
  }
>()("@gousset/core/RuleJobs") {}

type RuleRow = typeof rule.$inferSelect;

const decodeConditions = Schema.decodeUnknownOption(Conditions);

/** The conditions a row holds; none when they cannot be read (written by a later version). */
const conditionsOf = (row: Pick<RuleRow, "conditions">) => decodeConditions(row.conditions);

const parent = alias(category, "parent");

/** The user's accounts, by name. */
const accountsOf = (transaction: UserTransaction): Promise<ReadonlyArray<RuleAccount>> =>
  transaction
    .select({ id: account.id, name: account.name, institution: account.institution })
    .from(account)
    .orderBy(asc(account.name), asc(account.id));

/** The user's rules in the order they are tried, with their merchant and category. */
async function summaries(transaction: UserTransaction): Promise<ReadonlyArray<RuleSummary>> {
  const rows = await transaction
    .select({
      row: rule,
      merchantName: merchant.name,
      categoryName: category.name,
      categoryKind: category.kind,
      categoryArchivedAt: category.archivedAt,
      parentName: parent.name,
    })
    .from(rule)
    .leftJoin(merchant, eq(merchant.id, rule.setMerchantId))
    .leftJoin(category, eq(category.id, rule.setCategoryId))
    .leftJoin(parent, eq(parent.id, category.parentId))
    .orderBy(asc(rule.position), asc(rule.id));

  return rows.flatMap((each, index): ReadonlyArray<RuleSummary> => {
    const conditions = conditionsOf(each.row);

    if (Option.isNone(conditions)) {
      return [];
    }

    return [
      {
        id: each.row.id,
        place: index + 1,
        enabled: each.row.enabled,
        conditions: conditions.value,
        merchant:
          each.row.setMerchantId === null || each.merchantName === null
            ? null
            : { id: each.row.setMerchantId, name: each.merchantName },
        category:
          each.row.setCategoryId === null ||
          each.categoryName === null ||
          each.categoryKind === null
            ? null
            : {
                id: each.row.setCategoryId,
                name: each.categoryName,
                parentName: each.parentName,
                kind: each.categoryKind,
                archived: each.categoryArchivedAt !== null,
              },
        appliedCount: each.row.appliedCount,
        createdFrom: each.row.createdFrom,
        createdAt: each.row.createdAt.toISOString(),
      },
    ];
  });
}

async function effectFacts(transaction: UserTransaction): Promise<EffectFacts> {
  const categories = await transaction
    .select({ id: category.id, kind: category.kind, archivedAt: category.archivedAt })
    .from(category);

  const defaults = await transaction
    .select({ id: merchant.id, categoryId: merchant.defaultCategoryId })
    .from(merchant)
    .where(isNotNull(merchant.defaultCategoryId));

  return {
    categories: new Map(
      categories.map((each) => [each.id, { kind: each.kind, archived: each.archivedAt !== null }]),
    ),
    defaults: new Map(
      defaults.flatMap((each) => (each.categoryId === null ? [] : [[each.id, each.categoryId]])),
    ),
  };
}

/**
 * The lines as conditions read them, named as the fields are: `label`, `account`, `amount` (without
 * its sign, in its currency's units), `direction`, `day` (of the month) and `date`.
 */
async function lineRows(transaction: UserTransaction): Promise<SQL> {
  const currencies = await transaction.selectDistinct({ currency: account.currency }).from(account);

  const units = unitsSql(
    sql`a.currency`,
    currencies.map((each) => each.currency),
  );

  return sql`(
    select l.id as id,
      l.label as "label",
      l.account_id as "account",
      abs(l.amount_minor)::numeric / ${units} as "amount",
      case when l.amount_minor < 0 then 'out' else 'in' end as "direction",
      extract(day from l.booked_on)::integer as "day",
      l.booked_on as "date"
    from ${statementLine} l
    join ${account} a on a.id = l.account_id
    where l.state = 'counted'
  )`;
}

const RuleEntryRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["expense", "income"]),
  category_id: Schema.String,
  merchant_id: Schema.NullOr(Schema.String),
  classified_by: Schema.Literals(["default", "rule", "user"]),
  rule_id: Schema.NullOr(Schema.String),
});

const decodeEntryRows = Schema.decodeUnknownSync(
  Schema.Struct({ rows: Schema.Array(RuleEntryRow) }),
);

/**
 * The entries of the lines that meet `conditions`, in SQL (qnot's): each a whole line's, the line's
 * only entry and the entry's only part.
 */
async function matchingEntries(
  transaction: UserTransaction,
  conditions: Conditions,
): Promise<ReadonlyArray<RuleEntry>> {
  const rows = await lineRows(transaction);

  const found = await transaction.execute(sql`
    select e.id, e.kind, e.category_id, e.merchant_id, e.classified_by, e.rule_id
    from ${rows} as r
    join ${entryPart} p on p.line_id = r.id
    join ${entry} e on e.id = p.entry_id
    where (${conditionsSql(conditions)})
      and not exists (select 1 from ${entryPart} o where o.entry_id = e.id and o.id <> p.id)
      and not exists (select 1 from ${entryPart} o where o.line_id = p.line_id and o.entry_id <> e.id)
  `);

  return decodeEntryRows(found).rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    categoryId: row.category_id,
    merchantId: row.merchant_id,
    classifiedBy: row.classified_by,
    ruleId: row.rule_id,
  }));
}

/** A rule's effect on the entries `found`: those it applies to, and what each becomes. */
function plan(
  ruleId: string,
  effect: RuleSets,
  found: ReadonlyArray<RuleEntry>,
  facts: EffectFacts,
) {
  return found.flatMap((each) => {
    const wanted = targetOf(effect, each, facts);

    return wanted === null ? [] : [{ entry: each, wanted, changes: changes(each, ruleId, wanted) }];
  });
}

async function reachOf(
  transaction: UserTransaction,
  ruleId: string,
  conditions: Conditions,
  effect: RuleSets,
): Promise<RuleReach> {
  const planned = plan(
    ruleId,
    effect,
    await matchingEntries(transaction, conditions),
    await effectFacts(transaction),
  );

  return {
    lines: planned.length,
    toChange: planned.filter((each) => each.changes && each.entry.classifiedBy !== "user").length,
    byHand: planned.filter((each) => each.changes && each.entry.classifiedBy === "user").length,
  };
}

/** How many entry ids one update names. */
const CHUNK = 500;

/**
 * Writes what a rule makes of each entry, grouped by what they become, to the entries still
 * classified as `from` allows when written: one the user classified by hand meanwhile (on the
 * operations page, while a rule is applied to the past) keeps the user's choice. The ids written.
 */
async function writeEntries(
  transaction: UserTransaction,
  ruleId: string,
  writes: ReadonlyArray<{
    readonly entry: RuleEntry;
    readonly wanted: RuleTarget;
  }>,
  from: ReadonlyArray<RuleEntry["classifiedBy"]>,
): Promise<ReadonlySet<string>> {
  const written = new Set<string>();

  const groups = new Map<
    string,
    { categoryId: string; merchantId: string | null; ids: Array<string> }
  >();

  for (const each of writes) {
    const key = `${each.wanted.categoryId}/${each.wanted.merchantId ?? ""}`;
    const group = groups.get(key) ?? { ...each.wanted, ids: [] };

    group.ids.push(each.entry.id);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    for (let start = 0; start < group.ids.length; start += CHUNK) {
      const updated = await transaction
        .update(entry)
        .set({
          categoryId: group.categoryId,
          merchantId: group.merchantId,
          classifiedBy: "rule",
          ruleId,
        })
        .where(
          and(
            inArray(entry.id, group.ids.slice(start, start + CHUNK)),
            inArray(entry.classifiedBy, [...from]),
          ),
        )
        .returning({ id: entry.id });

      for (const each of updated) {
        written.add(each.id);
      }
    }
  }

  return written;
}

/** Adds `lines` to how many lines the rule classified. */
const countApplied = (transaction: UserTransaction, ruleId: string, lines: number) =>
  lines === 0
    ? Promise.resolve()
    : transaction
        .update(rule)
        .set({ appliedCount: sql`${rule.appliedCount} + ${lines}` })
        .where(eq(rule.id, ruleId))
        .then(() => {});

/**
 * Classifies the entries of the lines an import added, with the user's rules, in the import's
 * transaction: each entry still classified by default goes to the first enabled rule, in order,
 * whose conditions its line meets (evaluated here, in JavaScript) and which applies to it. How many
 * lines the rules classified.
 */
export async function applyRulesToImport(
  transaction: UserTransaction,
  importId: string,
): Promise<number> {
  const rules = await transaction
    .select()
    .from(rule)
    .where(eq(rule.enabled, true))
    .orderBy(asc(rule.position), asc(rule.id));

  const tried = rules.flatMap((row) => {
    const conditions = conditionsOf(row);

    return Option.isNone(conditions) ? [] : [{ ...row, matches: matcherOf(conditions.value) }];
  });

  if (tried.length === 0) {
    return 0;
  }

  const lines = await transaction
    .select({
      label: statementLine.label,
      accountId: statementLine.accountId,
      amountMinor: statementLine.amountMinor,
      bookedOn: statementLine.bookedOn,
      currency: account.currency,
      entryId: entry.id,
      kind: entry.kind,
      categoryId: entry.categoryId,
      merchantId: entry.merchantId,
      classifiedBy: entry.classifiedBy,
      ruleId: entry.ruleId,
      parts:
        sql<number>`(select count(*) from ${entryPart} o where o.entry_id = ${entry.id} or o.line_id = ${statementLine.id})`.mapWith(
          Number,
        ),
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .where(
      and(
        eq(statementLine.importId, importId),
        eq(statementLine.state, "counted"),
        eq(entry.classifiedBy, "default"),
      ),
    );

  const facts = await effectFacts(transaction);
  const byRule = new Map<string, Array<{ entry: RuleEntry; wanted: RuleTarget }>>();

  for (const line of lines) {
    // A whole line's only entry has one part, which both sides of the `or` name: any other part
    // (of the entry, or of another entry on the line) makes it a split or linked line.
    if (line.parts !== 1) {
      continue;
    }

    const target: RuleEntry = {
      id: line.entryId,
      kind: line.kind,
      categoryId: line.categoryId,
      merchantId: line.merchantId,
      classifiedBy: line.classifiedBy,
      ruleId: line.ruleId,
    };

    const row: ConditionRow = conditionRow(line);
    const chosen = firstApplying(tried, (each) => each.matches(row), target, facts);

    if (chosen !== null) {
      const writes = byRule.get(chosen.rule.id) ?? [];

      writes.push({ entry: target, wanted: chosen.wanted });
      byRule.set(chosen.rule.id, writes);
    }
  }

  let classified = 0;

  for (const [ruleId, writes] of byRule) {
    const written = await writeEntries(transaction, ruleId, writes, ["default"]);

    await countApplied(transaction, ruleId, written.size);
    classified += written.size;
  }

  return classified;
}

const notFound = (ruleId: string) => Result.fail(new RuleNotFound({ ruleId }));

/** The rule `ruleId`, locked for the transaction; undefined for no rule of the user's. */
async function lockedRule(
  transaction: UserTransaction,
  ruleId: string,
): Promise<RuleRow | undefined> {
  if (!isId(ruleId)) {
    return undefined;
  }

  const [row] = await transaction.select().from(rule).where(eq(rule.id, ruleId)).for("update");

  return row;
}

async function detailOf(
  transaction: UserTransaction,
  ruleId: string,
): Promise<RuleDetail | undefined> {
  const found = (await summaries(transaction)).find((each) => each.id === ruleId);

  if (found === undefined) {
    return undefined;
  }

  const reach = await reachOf(transaction, ruleId, found.conditions, {
    setMerchantId: found.merchant?.id ?? null,
    setCategoryId: found.category?.id ?? null,
  });

  return { ...found, reach, accounts: await accountsOf(transaction) };
}

type EffectProblem = CategoryNotFound | MerchantNotFound | RuleEffectRefused;

/**
 * What is wrong with a rule's conditions and effect, against the user's rows; null when nothing. A
 * category archived since it was chosen is kept when the rule keeps it (`keptCategory`), and a
 * merchant marked an intermediary since, or merged into one (`keptMerchant`): its lines ask who
 * was paid all the same (`../merchants/line-merchant`).
 */
async function problemOf(
  transaction: UserTransaction,
  conditions: Conditions,
  effect: RuleEffect,
  keptCategory: string | null = null,
  keptMerchant: string | null = null,
): Promise<RuleConditionsRefused | EffectProblem | null> {
  const accounts = await accountsOf(transaction);

  const wrong = conditionsProblem(
    conditions,
    accounts.map((each) => each.id),
  );

  if (wrong !== null) {
    return new RuleConditionsRefused({
      reason: wrong.reason,
      index: "index" in wrong ? wrong.index : null,
    });
  }

  if (effect.merchantId === null && effect.categoryId === null) {
    return new RuleEffectRefused({ reason: "nothing_set" });
  }

  if (effect.merchantId !== null) {
    const [found] = isId(effect.merchantId)
      ? await transaction
          .select({ id: merchant.id, intermediary: merchant.isIntermediary })
          .from(merchant)
          .where(eq(merchant.id, effect.merchantId))
      : [];

    if (found === undefined) {
      return new MerchantNotFound({ merchantId: effect.merchantId });
    }

    // A payment intermediary is never who was paid (#30).
    if (found.intermediary && effect.merchantId !== keptMerchant) {
      return new RuleEffectRefused({ reason: "merchant_intermediary" });
    }
  }

  if (effect.categoryId !== null) {
    const [found] = isId(effect.categoryId)
      ? await transaction
          .select({ archivedAt: category.archivedAt })
          .from(category)
          .where(eq(category.id, effect.categoryId))
      : [];

    if (found === undefined) {
      return new CategoryNotFound({ categoryId: effect.categoryId });
    }

    if (found.archivedAt !== null && effect.categoryId !== keptCategory) {
      return new RuleEffectRefused({ reason: "category_archived" });
    }
  }

  return null;
}

/** The user's rules in the order they are tried, and the accounts conditions may name. */
export const listRules = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, async (transaction): Promise<RuleList> => ({
      rules: await summaries(transaction),
      accounts: await accountsOf(transaction),
    }));
  });

/** One rule of the user's, with what it would do to the lines already there. */
export const showRule = (owner: string, ruleId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const found = yield* userData.transaction(owner, (transaction) =>
      isId(ruleId) ? detailOf(transaction, ruleId) : Promise.resolve(undefined),
    );

    return found === undefined ? yield* Effect.fail(new RuleNotFound({ ruleId })) : found;
  });

/**
 * What a rule not saved yet would do to the lines already there, as the editor shows it while the
 * rule is written; with `ruleId`, as a change of that saved rule, whose own lines need no change.
 * Refused as `createRule` refuses it.
 */
export const previewRule = (
  owner: string,
  draft: RuleEffect & { readonly conditions: Conditions; readonly ruleId?: string | null },
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const reach = yield* userData.transaction(
      owner,
      async (
        transaction,
      ): Promise<Result.Result<RuleReach, RuleConditionsRefused | EffectProblem>> => {
        const problem = await problemOf(transaction, draft.conditions, draft);

        if (problem !== null) {
          return Result.fail(problem);
        }

        return Result.succeed(
          await reachOf(transaction, draft.ruleId ?? "", draft.conditions, {
            setMerchantId: draft.merchantId,
            setCategoryId: draft.categoryId,
          }),
        );
      },
    );

    return yield* Effect.fromResult(reach);
  });

/**
 * Makes a rule, tried after the user's other rules. It applies to the lines imported from now on;
 * the lines already there wait for `startApplyToPast`. Refused: conditions none, too many or that
 * cannot be read (`RuleConditionsRefused`), nothing set or an archived category
 * (`RuleEffectRefused`), a merchant or a category the user does not have, `MAX_RULES` reached.
 */
export const createRule = (owner: string, input: RuleInput) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const made = yield* userData.transaction(
      owner,
      async (
        transaction,
      ): Promise<
        Result.Result<RuleDetail, RuleConditionsRefused | EffectProblem | TooManyRules>
      > => {
        const problem = await problemOf(transaction, input.conditions, input);

        if (problem !== null) {
          return Result.fail(problem);
        }

        const [counted] = await transaction.select({ rules: count() }).from(rule);

        if ((counted?.rules ?? 0) >= MAX_RULES) {
          return Result.fail(new TooManyRules({ limit: MAX_RULES }));
        }

        const [last] = await transaction
          .select({ position: sql<number>`coalesce(max(${rule.position}), 0)`.mapWith(Number) })
          .from(rule);

        const [row] = await transaction
          .insert(rule)
          .values({
            userId: owner,
            position: (last?.position ?? 0) + 1,
            enabled: input.enabled ?? true,
            conditions: input.conditions,
            setMerchantId: input.merchantId,
            setCategoryId: input.categoryId,
            createdFrom: input.createdFrom,
          })
          .returning({ id: rule.id });

        const detail = row === undefined ? undefined : await detailOf(transaction, row.id);

        if (detail === undefined) {
          throw new Error("The rule just made could not be read back.");
        }

        return Result.succeed(detail);
      },
    );

    return yield* Effect.fromResult(made);
  });

/**
 * Changes a rule: its conditions, what it sets, whether it is on. What it already classified stays
 * as it is; apply it to the past again to follow the change. Refused as `createRule` refuses it.
 */
export const editRule = (owner: string, ruleId: string, edit: RuleEdit) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const edited = yield* userData.transaction(
      owner,
      async (
        transaction,
      ): Promise<
        Result.Result<RuleDetail, RuleNotFound | RuleConditionsRefused | EffectProblem>
      > => {
        const row = await lockedRule(transaction, ruleId);

        if (row === undefined) {
          return notFound(ruleId);
        }

        const kept = conditionsOf(row);
        const conditions = edit.conditions ?? (Option.isSome(kept) ? kept.value : undefined);

        if (conditions === undefined) {
          return Result.fail(new RuleConditionsRefused({ reason: "invalid", index: null }));
        }

        const effect: RuleEffect = {
          merchantId: edit.merchantId === undefined ? row.setMerchantId : edit.merchantId,
          categoryId: edit.categoryId === undefined ? row.setCategoryId : edit.categoryId,
        };

        // A rule that keeps its category (turned off or on, say) is not refused for a category
        // archived since, nor for a merchant marked an intermediary since: it keeps what it had.
        const problem = await problemOf(
          transaction,
          conditions,
          effect,
          row.setCategoryId,
          row.setMerchantId,
        );

        if (problem !== null) {
          return Result.fail(problem);
        }

        await transaction
          .update(rule)
          .set({
            conditions,
            setMerchantId: effect.merchantId,
            setCategoryId: effect.categoryId,
            enabled: edit.enabled ?? row.enabled,
          })
          .where(eq(rule.id, row.id));

        const detail = await detailOf(transaction, row.id);

        return detail === undefined ? notFound(ruleId) : Result.succeed(detail);
      },
    );

    return yield* Effect.fromResult(edited);
  });

/**
 * Deletes a rule. The lines it classified keep their category and merchant, still classified by a
 * rule; the rule's name is gone from them.
 */
export const deleteRule = (owner: string, ruleId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const deleted = yield* userData.transaction(
      owner,
      async (transaction): Promise<Result.Result<{ readonly id: string }, RuleNotFound>> => {
        const row = await lockedRule(transaction, ruleId);

        if (row === undefined) {
          return notFound(ruleId);
        }

        await transaction.delete(rule).where(eq(rule.id, row.id));

        return Result.succeed({ id: row.id });
      },
    );

    return yield* Effect.fromResult(deleted);
  });

/**
 * Moves a rule to `place` (from 1) in the order rules are tried; a place past the last puts it
 * last. Gives the list as it is then.
 */
export const moveRule = (owner: string, ruleId: string, place: number) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const moved = yield* userData.transaction(
      owner,
      async (transaction): Promise<Result.Result<RuleList, RuleNotFound>> => {
        const row = await lockedRule(transaction, ruleId);

        if (row === undefined) {
          return notFound(ruleId);
        }

        const ordered = await transaction
          .select({ id: rule.id, position: rule.position })
          .from(rule)
          .orderBy(asc(rule.position), asc(rule.id))
          .for("update");

        const others = ordered.filter((each) => each.id !== row.id);
        const at = Math.min(Math.max(Math.trunc(place), 1), others.length + 1) - 1;
        const order = [...others.slice(0, at), row, ...others.slice(at)];

        // A user has a few rules: each one's place is written again, the moved one's and the
        // others' alike, only where it changed.
        for (const [index, each] of order.entries()) {
          const position = index + 1;
          const before = ordered.find((one) => one.id === each.id)?.position;

          if (before !== position) {
            await transaction.update(rule).set({ position }).where(eq(rule.id, each.id));
          }
        }

        return Result.succeed({
          rules: await summaries(transaction),
          accounts: await accountsOf(transaction),
        });
      },
    );

    return yield* Effect.fromResult(moved);
  });

/**
 * Applies a rule to the lines already there, what its job runs: each line it applies to gets the
 * merchant and the category it sets, classified by the rule, unless the user classified it by hand
 * and `includeByHand` is false. A rule turned off applies too: the user asked for it. In one
 * transaction: a run again changes nothing more.
 */
export const applyRuleToPast = (owner: string, ruleId: string, includeByHand: boolean) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const applied = yield* userData.transaction(
      owner,
      async (transaction): Promise<Result.Result<RuleApplied, RuleNotFound>> => {
        // The merchants' defaults stay as they are while it reads them.
        await takeCategoryTurn(transaction, owner);

        const row = await lockedRule(transaction, ruleId);
        const conditions = row === undefined ? Option.none() : conditionsOf(row);

        if (row === undefined || Option.isNone(conditions)) {
          return notFound(ruleId);
        }

        const planned = plan(
          row.id,
          row,
          await matchingEntries(transaction, conditions.value),
          await effectFacts(transaction),
        ).filter((each) => each.changes && (includeByHand || each.entry.classifiedBy !== "user"));

        const written = await writeEntries(
          transaction,
          row.id,
          planned,
          includeByHand ? ["default", "rule", "user"] : ["default", "rule"],
        );

        await countApplied(transaction, row.id, written.size);

        return Result.succeed({
          changed: written.size,
          byHand: planned.filter(
            (each) => each.entry.classifiedBy === "user" && written.has(each.entry.id),
          ).length,
        });
      },
    );

    return yield* Effect.fromResult(applied);
  });

/**
 * Sends the job that applies a rule to the lines already there; its id, which the screen follows
 * and the MCP door waits for. Refused for a rule the user does not have.
 */
export const startApplyToPast = (owner: string, ruleId: string, includeByHand: boolean) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const jobs = yield* RuleJobs;

    const found = yield* userData.transaction(owner, async (transaction) =>
      isId(ruleId)
        ? (await transaction.select({ id: rule.id }).from(rule).where(eq(rule.id, ruleId)))[0]
        : undefined,
    );

    if (found === undefined) {
      return yield* Effect.fail(new RuleNotFound({ ruleId }));
    }

    return yield* jobs.send(owner, { ruleId: found.id, includeByHand });
  });
