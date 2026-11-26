import {
  account,
  category,
  entry,
  entryPart,
  entrySubject,
  merchant,
  merchantAlias,
  rule,
  statementLine,
  subject,
  subjectEntryRefused,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Option, Result, Schema } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { CategoryNotFound } from "../errors";
import { isId } from "../imports/rows";
import { MerchantNotFound } from "../merchants/errors";
import { merchantKey } from "../merchants/labels";
import { pathOf, treeOrder } from "../subjects/counting";
import { SubjectNotFound } from "../subjects/errors";
import {
  Conditions,
  conditionRow,
  conditionsProblem,
  matcherOf,
  meetsMerchants,
  mergedMerchant,
  merchantsNamed,
  readsMerchant,
} from "./conditions";
import type { ConditionRow } from "./conditions";
import { changes, firstApplying, subjectPart, subjectsAttached, targetOf } from "./effect";
import type { EffectFacts, RuleEntry, RuleSets, RuleTarget, SubjectTarget } from "./effect";
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
//
// A rule may also attach a subject (#37), apart from "first rule wins": every enabled rule with a
// subject whose conditions a line meets attaches it to the line's expense, unless the user declined
// that pair (`subject_entry_refused`) or the subject is archived. Attaching never detaches, and
// changes neither the entry's classification nor the line's review.

/** The most rules a user may have. */
export const MAX_RULES = 200;

/** Where a rule comes from: a correction of a line, or the rules' own screen (or the MCP door). */
export type RuleOrigin = "correction" | "user";

/** A rule's category: archived ones stay shown, and classify nothing new. */
export type RuleCategory = LineCategory & { readonly archived: boolean };

/** A subject a rule may attach: archived ones stay shown, and get no expense. */
export type RuleSubject = {
  readonly id: string;
  readonly name: string;
  /** Its name with its ancestors', the top first: "House > Garden shed". */
  readonly path: string;
  readonly archived: boolean;
};

/** A merchant as a rule names it. */
export type RuleMerchant = { readonly id: string; readonly name: string };

/** One rule, as the list gives it. */
export type RuleSummary = {
  readonly id: string;
  /** Its place in the order rules are tried, from 1. */
  readonly place: number;
  readonly enabled: boolean;
  readonly conditions: Conditions;
  readonly merchant: RuleMerchant | null;
  readonly category: RuleCategory | null;
  readonly subject: RuleSubject | null;
  /** How many lines it changed, at import and applied to the past: classified, or attached. */
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

/**
 * What the rules name, as the screens name them: every account (a condition may name one), the
 * merchants the conditions name, and every subject in tree order (an effect may name one).
 */
export type RuleNames = {
  readonly accounts: ReadonlyArray<RuleAccount>;
  readonly merchants: ReadonlyArray<RuleMerchant>;
  readonly subjects: ReadonlyArray<RuleSubject>;
};

/** The user's rules in the order they are tried, with what they name. */
export type RuleList = RuleNames & { readonly rules: ReadonlyArray<RuleSummary> };

/**
 * What a rule would do to the lines already there: how many it applies to (it classifies them, or
 * attaches its subject), how many of those it would change (classified by default or by another
 * rule, or not attached yet), and how many of those the user classified by hand, which it changes
 * only when asked.
 */
export type RuleReach = {
  readonly lines: number;
  readonly toChange: number;
  readonly byHand: number;
};

/** One rule with what it would do to the lines already there. */
export type RuleDetail = RuleSummary & RuleNames & { readonly reach: RuleReach };

/** What a rule sets: a merchant, a category, a subject to attach; at least one. */
export type RuleEffect = {
  readonly merchantId: string | null;
  readonly categoryId: string | null;
  /** Left out: none. */
  readonly subjectId?: string | null;
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
  readonly subjectId?: string | null;
  readonly enabled?: boolean;
};

/** What applying a rule to the past changed. */
export type RuleApplied = {
  /** The lines whose entry it changed: classified, or attached to its subject. */
  readonly changed: number;
  /** Among them, those the user had classified by hand. */
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

/** Every subject of the user's, in tree order, named with their ancestors: a user has 200 at most. */
async function subjectsOf(transaction: UserTransaction): Promise<ReadonlyArray<RuleSubject>> {
  const rows = await transaction
    .select({
      id: subject.id,
      parentId: subject.parentId,
      name: subject.name,
      archivedAt: subject.archivedAt,
    })
    .from(subject);

  return treeOrder(rows).map((row) => ({
    id: row.id,
    name: row.name,
    path: pathOf(rows, row.id),
    archived: row.archivedAt !== null,
  }));
}

/** The merchants of the user's among `ids`, by name. */
async function merchantsAmong(
  transaction: UserTransaction,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<RuleMerchant & { readonly intermediary: boolean }>> {
  const valid = [...new Set(ids)].filter((id) => isId(id));

  return valid.length === 0
    ? []
    : transaction
        .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
        .from(merchant)
        .where(inArray(merchant.id, valid))
        .orderBy(asc(merchant.name), asc(merchant.id));
}

/** The user's rules in the order they are tried, with their merchant, category and subject. */
async function summaries(
  transaction: UserTransaction,
  subjects: ReadonlyArray<RuleSubject>,
): Promise<ReadonlyArray<RuleSummary>> {
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

  const subjectOf = new Map(subjects.map((each) => [each.id, each]));

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
        subject:
          each.row.attachSubjectId === null
            ? null
            : (subjectOf.get(each.row.attachSubjectId) ?? null),
        appliedCount: each.row.appliedCount,
        createdFrom: each.row.createdFrom,
        createdAt: each.row.createdAt.toISOString(),
      },
    ];
  });
}

/** The rules with what they name: the merchants of their conditions, every account and subject. */
async function listIn(transaction: UserTransaction): Promise<RuleList> {
  const subjects = await subjectsOf(transaction);
  const rules = await summaries(transaction, subjects);

  const merchants = await merchantsAmong(
    transaction,
    rules.flatMap((each) => merchantsNamed(each.conditions)),
  );

  return {
    rules,
    accounts: await accountsOf(transaction),
    merchants: merchants.map((each) => ({ id: each.id, name: each.name })),
    subjects,
  };
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

/** What the subject part of rules reads of the subjects they attach. */
type SubjectFacts = {
  /** Those not archived. */
  readonly open: ReadonlySet<string>;
  /** By entry, the subjects among them it is attached to. */
  readonly attached: ReadonlyMap<string, ReadonlySet<string>>;
  /** By entry, the subjects among them the user declined it for. */
  readonly refused: ReadonlyMap<string, ReadonlySet<string>>;
};

const NONE: ReadonlySet<string> = new Set();

function byEntry(
  rows: ReadonlyArray<{ readonly entryId: string; readonly subjectId: string }>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const found = new Map<string, Set<string>>();

  for (const row of rows) {
    const known = found.get(row.entryId);

    if (known === undefined) {
      found.set(row.entryId, new Set([row.subjectId]));
    } else {
      known.add(row.subjectId);
    }
  }

  return found;
}

/** The facts of the subjects `subjectIds`: which are open, and their entries attached or declined. */
async function subjectFacts(
  transaction: UserTransaction,
  subjectIds: ReadonlyArray<string>,
): Promise<SubjectFacts> {
  const ids = [...new Set(subjectIds)];

  if (ids.length === 0) {
    return { open: NONE, attached: new Map(), refused: new Map() };
  }

  const open = await transaction
    .select({ id: subject.id })
    .from(subject)
    .where(and(inArray(subject.id, ids), isNull(subject.archivedAt)));

  const attached = await transaction
    .select({ entryId: entrySubject.entryId, subjectId: entrySubject.subjectId })
    .from(entrySubject)
    .where(inArray(entrySubject.subjectId, ids));

  const refused = await transaction
    .select({ entryId: subjectEntryRefused.entryId, subjectId: subjectEntryRefused.subjectId })
    .from(subjectEntryRefused)
    .where(inArray(subjectEntryRefused.subjectId, ids));

  return {
    open: new Set(open.map((each) => each.id)),
    attached: byEntry(attached),
    refused: byEntry(refused),
  };
}

const subjectTarget = (
  facts: SubjectFacts,
  target: Pick<RuleEntry, "id" | "kind">,
): SubjectTarget => ({
  kind: target.kind,
  attached: facts.attached.get(target.id) ?? NONE,
  refused: facts.refused.get(target.id) ?? NONE,
});

/** A line as its merchant is read from: its label, and its entry's merchant. */
type MerchantFacts = {
  readonly label: string;
  readonly counterpartyName: string | null;
  readonly entryMerchantId: string | null;
};

/**
 * Who each line paid, as `../merchants/line-merchant` reads it: its entry's merchant when that is
 * no intermediary, else the merchant its cleaned label names when that is none; null otherwise.
 * Every cleaned label of the user's is read once, and each line's label cleaned in code.
 */
async function merchantReader(
  transaction: UserTransaction,
): Promise<(line: MerchantFacts) => string | null> {
  const intermediaries = new Set(
    (
      await transaction
        .select({ id: merchant.id })
        .from(merchant)
        .where(eq(merchant.isIntermediary, true))
    ).map((each) => each.id),
  );

  const aliases = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias);

  const byAlias = new Map(aliases.map((each) => [each.alias, each.merchantId]));

  return (line) => {
    if (line.entryMerchantId !== null && !intermediaries.has(line.entryMerchantId)) {
      return line.entryMerchantId;
    }

    const key = merchantKey(line.label, line.counterpartyName);
    const named = key === null ? undefined : byAlias.get(key);

    return named === undefined || intermediaries.has(named) ? null : named;
  };
}

/**
 * The lines as conditions read them, named as the fields are: `label`, `account`, `amount` (without
 * its sign, in its currency's units), `direction`, `day` (of the month) and `date`; and what the
 * merchant is read from, and the line's own amount.
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
      l.booked_on as "date",
      l.counterparty_name as counterparty_name,
      l.amount_minor as amount_minor,
      a.currency as currency
    from ${statementLine} l
    join ${account} a on a.id = l.account_id
    where l.state = 'counted'
  )`;
}

const LineEntryRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["expense", "income"]),
  category_id: Schema.String,
  merchant_id: Schema.NullOr(Schema.String),
  classified_by: Schema.Literals(["default", "rule", "user"]),
  rule_id: Schema.NullOr(Schema.String),
  label: Schema.String,
  counterparty_name: Schema.NullOr(Schema.String),
  amount_minor: Schema.Number,
  currency: Schema.String,
});

const decodeLineEntryRows = Schema.decodeUnknownSync(
  Schema.Struct({ rows: Schema.Array(LineEntryRow) }),
);

/** An entry a rule may change, with its line: what its merchant is read from, and its amount. */
type LineEntry = RuleEntry &
  MerchantFacts & { readonly amountMinor: number; readonly currency: string };

/**
 * The entries made of one whole counted line whose line (named as `lineRows` names it, `r`) and
 * entry (`e`) meet `where`: each the line's only entry, and the entry's only part.
 */
async function wholeEntries(
  transaction: UserTransaction,
  where: SQL,
): Promise<ReadonlyArray<LineEntry>> {
  const rows = await lineRows(transaction);

  const found = await transaction.execute(sql`
    select e.id, e.kind, e.category_id, e.merchant_id, e.classified_by, e.rule_id,
      r.label, r.counterparty_name, r.amount_minor::float8 as amount_minor, r.currency
    from ${rows} as r
    join ${entryPart} p on p.line_id = r.id
    join ${entry} e on e.id = p.entry_id
    where (${where})
      and not exists (select 1 from ${entryPart} o where o.entry_id = e.id and o.id <> p.id)
      and not exists (select 1 from ${entryPart} o where o.line_id = p.line_id and o.entry_id <> e.id)
  `);

  return decodeLineEntryRows(found).rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    categoryId: row.category_id,
    merchantId: row.merchant_id,
    classifiedBy: row.classified_by,
    ruleId: row.rule_id,
    label: row.label,
    counterpartyName: row.counterparty_name,
    entryMerchantId: row.merchant_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
  }));
}

/**
 * The entries of the lines that meet `conditions`: in SQL (qnot's) for every condition but the
 * merchant's, which the lines found then meet in JavaScript.
 */
async function matchingEntries(
  transaction: UserTransaction,
  conditions: Conditions,
): Promise<ReadonlyArray<LineEntry>> {
  const found = await wholeEntries(transaction, conditionsSql(conditions));

  if (!readsMerchant(conditions)) {
    return found;
  }

  const merchantOf = await merchantReader(transaction);

  return found.filter((each) => meetsMerchants(conditions, merchantOf(each)));
}

/** The expenses of one whole line each whose line's merchant is one of `merchantIds`, with it. */
async function merchantExpensesIn(
  transaction: UserTransaction,
  merchantIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<LineEntry & { readonly lineMerchantId: string }>> {
  const wanted = new Set(merchantIds);

  if (wanted.size === 0) {
    return [];
  }

  const found = await wholeEntries(transaction, sql`e.kind = 'expense'`);
  const merchantOf = await merchantReader(transaction);

  return found.flatMap((each) => {
    const lineMerchantId = merchantOf(each);

    return lineMerchantId !== null && wanted.has(lineMerchantId)
      ? [{ ...each, lineMerchantId }]
      : [];
  });
}

/** What a rule sets, its subject included. */
type RuleEffectSets = RuleSets & { readonly attachSubjectId: string | null };

/**
 * A rule's effect on the entries `found`: those it applies to (it classifies them, or attaches its
 * subject), what each becomes, and whether each part changes it.
 */
function plan(
  ruleId: string,
  effect: RuleEffectSets,
  found: ReadonlyArray<LineEntry>,
  facts: EffectFacts,
  subjects: SubjectFacts,
) {
  return found.flatMap((each) => {
    const wanted = targetOf(effect, each, facts);
    const part = subjectPart(effect.attachSubjectId, subjectTarget(subjects, each), subjects.open);

    if (wanted === null && part === "none") {
      return [];
    }

    return [
      {
        entry: each,
        wanted,
        changes: wanted !== null && changes(each, ruleId, wanted),
        attaches: part === "attaches",
      },
    ];
  });
}

async function reachOf(
  transaction: UserTransaction,
  ruleId: string,
  conditions: Conditions,
  effect: RuleEffectSets,
): Promise<RuleReach> {
  const planned = plan(
    ruleId,
    effect,
    await matchingEntries(transaction, conditions),
    await effectFacts(transaction),
    await subjectFacts(
      transaction,
      effect.attachSubjectId === null ? [] : [effect.attachSubjectId],
    ),
  );

  const changing = planned.filter((each) => each.changes || each.attaches);

  return {
    lines: planned.length,
    toChange: changing.filter((each) => each.entry.classifiedBy !== "user").length,
    byHand: changing.filter((each) => each.entry.classifiedBy === "user").length,
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

const decodeAttached = Schema.decodeUnknownSync(
  Schema.Struct({ rows: Schema.Array(Schema.Struct({ entry_id: Schema.String })) }),
);

/**
 * Attaches the subject `subjectId` to the expenses `entryIds`, each still classified as `from`
 * allows, as long as the subject is not archived and the user did not decline the pair, all read
 * as it is written: a refusal or an archiving meanwhile wins. The ids attached; those attached
 * already are not among them.
 */
async function attachSubjects(
  transaction: UserTransaction,
  subjectId: string,
  entryIds: ReadonlyArray<string>,
  from: ReadonlyArray<RuleEntry["classifiedBy"]>,
): Promise<ReadonlySet<string>> {
  const attached = new Set<string>();
  const ids = [...new Set(entryIds)];

  const classified = sql.join(
    from.map((each) => sql`${each}`),
    sql`, `,
  );

  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = sql.join(
      ids.slice(start, start + CHUNK).map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const inserted = await transaction.execute(sql`
      insert into ${entrySubject} (user_id, entry_id, subject_id)
      select e.user_id, e.id, s.id
      from ${entry} e
      join ${subject} s on s.id = ${subjectId}::uuid and s.archived_at is null
      where e.id in (${chunk})
        and e.kind = 'expense'
        and e.classified_by in (${classified})
        and not exists (
          select 1 from ${subjectEntryRefused} r where r.entry_id = e.id and r.subject_id = s.id
        )
      on conflict do nothing
      returning entry_id
    `);

    for (const row of decodeAttached(inserted).rows) {
      attached.add(row.entry_id);
    }
  }

  return attached;
}

/** Adds `lines` to how many lines the rule changed. */
const countApplied = (transaction: UserTransaction, ruleId: string, lines: number) =>
  lines === 0
    ? Promise.resolve()
    : transaction
        .update(rule)
        .set({ appliedCount: sql`${rule.appliedCount} + ${lines}` })
        .where(eq(rule.id, ruleId))
        .then(() => {});

/** Adds the ids to those of the rule `ruleId` in `changed`. */
function addChanged(
  changed: Map<string, Set<string>>,
  ruleId: string,
  ids: ReadonlySet<string>,
): void {
  const known = changed.get(ruleId) ?? new Set<string>();

  for (const id of ids) {
    known.add(id);
  }

  changed.set(ruleId, known);
}

/**
 * Applies the user's rules to the entries of the lines an import added, in the import's
 * transaction: each entry still classified by default goes to the first enabled rule, in order,
 * whose conditions its line meets (evaluated here, in JavaScript) and which applies to it; and
 * every enabled rule its line meets attaches its subject to it, an expense. How many lines the
 * rules classified.
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

    return Option.isNone(conditions)
      ? []
      : [{ ...row, conditions: conditions.value, matches: matcherOf(conditions.value) }];
  });

  if (tried.length === 0) {
    return 0;
  }

  const lines = await transaction
    .select({
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
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
    .where(and(eq(statementLine.importId, importId), eq(statementLine.state, "counted")));

  const merchantOf = tried.some((each) => readsMerchant(each.conditions))
    ? await merchantReader(transaction)
    : () => null;

  const facts = await effectFacts(transaction);

  const subjects = await subjectFacts(
    transaction,
    tried.flatMap((each) => (each.attachSubjectId === null ? [] : [each.attachSubjectId])),
  );

  const byRule = new Map<string, Array<{ entry: RuleEntry; wanted: RuleTarget }>>();

  const attachments = new Map<
    string,
    { readonly subjectId: string; readonly ids: Array<string> }
  >();

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

    // Each rule's conditions are read once per row: the two parts may ask the same rule.
    const meetsOn = (row: ConditionRow) => {
      const met = new Map<string, boolean>();

      return (each: (typeof tried)[number]) => {
        const known = met.get(each.id) ?? each.matches(row);

        met.set(each.id, known);

        return known;
      };
    };

    const meets = meetsOn(
      conditionRow({
        ...line,
        merchantId: merchantOf({ ...line, entryMerchantId: line.merchantId }),
      }),
    );

    const chosen =
      line.classifiedBy === "default" ? firstApplying(tried, meets, target, facts) : null;

    // The subject part reads the line as the chosen rule leaves it, as applying a rule to the past
    // reads it: with the merchant that rule set, unless an intermediary (`merchantReader`).
    const merchantSet = chosen === null ? line.merchantId : chosen.wanted.merchantId;

    const meetsAfter =
      merchantSet === line.merchantId
        ? meets
        : meetsOn(
            conditionRow({
              ...line,
              merchantId: merchantOf({ ...line, entryMerchantId: merchantSet }),
            }),
          );

    if (chosen !== null) {
      const writes = byRule.get(chosen.rule.id) ?? [];

      writes.push({ entry: target, wanted: chosen.wanted });
      byRule.set(chosen.rule.id, writes);
    }

    const open = subjects.open;

    for (const each of subjectsAttached(tried, meetsAfter, subjectTarget(subjects, target), open)) {
      const group = attachments.get(each.rule.id) ?? { subjectId: each.subjectId, ids: [] };

      group.ids.push(target.id);
      attachments.set(each.rule.id, group);
    }
  }

  const changed = new Map<string, Set<string>>();
  let classified = 0;

  for (const [ruleId, writes] of byRule) {
    const written = await writeEntries(transaction, ruleId, writes, ["default"]);

    addChanged(changed, ruleId, written);
    classified += written.size;
  }

  for (const [ruleId, group] of attachments) {
    addChanged(
      changed,
      ruleId,
      await attachSubjects(transaction, group.subjectId, group.ids, ["default", "rule"]),
    );
  }

  for (const [ruleId, ids] of changed) {
    await countApplied(transaction, ruleId, ids.size);
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
  const listed = await listIn(transaction);
  const found = listed.rules.find((each) => each.id === ruleId);

  if (found === undefined) {
    return undefined;
  }

  const reach = await reachOf(transaction, ruleId, found.conditions, {
    setMerchantId: found.merchant?.id ?? null,
    setCategoryId: found.category?.id ?? null,
    attachSubjectId: found.subject?.id ?? null,
  });

  return {
    ...found,
    reach,
    accounts: listed.accounts,
    merchants: listed.merchants.filter((each) =>
      merchantsNamed(found.conditions).includes(each.id),
    ),
    subjects: listed.subjects,
  };
}

type EffectProblem = CategoryNotFound | MerchantNotFound | SubjectNotFound | RuleEffectRefused;

/** What a saved rule keeps when it is changed, archived or marked since as it may be. */
type Kept = {
  readonly categoryId: string | null;
  readonly merchantId: string | null;
  readonly subjectId: string | null;
};

const KEEPS_NOTHING: Kept = { categoryId: null, merchantId: null, subjectId: null };

/**
 * What is wrong with a rule's conditions and effect, against the user's rows; null when nothing. A
 * category archived since it was chosen is kept when the rule keeps it (`kept`), and so is a subject
 * archived since, and a merchant marked an intermediary since, or merged into one: its lines ask
 * who was paid all the same (`../merchants/line-merchant`).
 */
async function problemOf(
  transaction: UserTransaction,
  conditions: Conditions,
  effect: RuleEffect,
  kept: Kept = KEEPS_NOTHING,
): Promise<RuleConditionsRefused | EffectProblem | null> {
  const accounts = await accountsOf(transaction);
  const merchants = await merchantsAmong(transaction, merchantsNamed(conditions));

  const wrong = conditionsProblem(
    conditions,
    accounts.map((each) => each.id),
    merchants.map((each) => each.id),
  );

  if (wrong !== null) {
    return new RuleConditionsRefused({
      reason: wrong.reason,
      index: "index" in wrong ? wrong.index : null,
    });
  }

  const subjectId = effect.subjectId ?? null;

  if (effect.merchantId === null && effect.categoryId === null && subjectId === null) {
    return new RuleEffectRefused({ reason: "nothing_set" });
  }

  if (effect.merchantId !== null) {
    const [found] = await merchantsAmong(transaction, [effect.merchantId]);

    if (found === undefined) {
      return new MerchantNotFound({ merchantId: effect.merchantId });
    }

    // A payment intermediary is never who was paid (#30).
    if (found.intermediary && effect.merchantId !== kept.merchantId) {
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

    if (found.archivedAt !== null && effect.categoryId !== kept.categoryId) {
      return new RuleEffectRefused({ reason: "category_archived" });
    }
  }

  if (subjectId !== null) {
    const [found] = isId(subjectId)
      ? await transaction
          .select({ archivedAt: subject.archivedAt })
          .from(subject)
          .where(eq(subject.id, subjectId))
      : [];

    if (found === undefined) {
      return new SubjectNotFound({ subjectId });
    }

    if (found.archivedAt !== null && subjectId !== kept.subjectId) {
      return new RuleEffectRefused({ reason: "subject_archived" });
    }
  }

  return null;
}

/** The user's rules in the order they are tried, with what they name. */
export const listRules = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, listIn);
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
        const ruleId = draft.ruleId ?? "";

        // A saved rule keeps what it had, as `editRule` lets it: the preview answers as a save would.
        const [saved] = isId(ruleId)
          ? await transaction
              .select({
                merchantId: rule.setMerchantId,
                categoryId: rule.setCategoryId,
                subjectId: rule.attachSubjectId,
              })
              .from(rule)
              .where(eq(rule.id, ruleId))
          : [];

        const problem = await problemOf(transaction, draft.conditions, draft, saved);

        if (problem !== null) {
          return Result.fail(problem);
        }

        return Result.succeed(
          await reachOf(transaction, ruleId, draft.conditions, {
            setMerchantId: draft.merchantId,
            setCategoryId: draft.categoryId,
            attachSubjectId: draft.subjectId ?? null,
          }),
        );
      },
    );

    return yield* Effect.fromResult(reach);
  });

/** The place after the user's last rule. */
async function nextPosition(transaction: UserTransaction): Promise<number> {
  const [last] = await transaction
    .select({ position: sql<number>`coalesce(max(${rule.position}), 0)`.mapWith(Number) })
    .from(rule);

  return (last?.position ?? 0) + 1;
}

/** How many rules the user has. */
async function ruleCount(transaction: UserTransaction): Promise<number> {
  const [counted] = await transaction.select({ rules: count() }).from(rule);

  return counted?.rules ?? 0;
}

/**
 * Makes a rule, tried after the user's other rules. It applies to the lines imported from now on;
 * the lines already there wait for `startApplyToPast`. Refused: conditions none, too many or that
 * cannot be read, or naming an account or a merchant the user does not have
 * (`RuleConditionsRefused`), nothing set, an archived category or subject (`RuleEffectRefused`), a
 * merchant, a category or a subject the user does not have, `MAX_RULES` reached.
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

        if ((await ruleCount(transaction)) >= MAX_RULES) {
          return Result.fail(new TooManyRules({ limit: MAX_RULES }));
        }

        const [row] = await transaction
          .insert(rule)
          .values({
            userId: owner,
            position: await nextPosition(transaction),
            enabled: input.enabled ?? true,
            conditions: input.conditions,
            setMerchantId: input.merchantId,
            setCategoryId: input.categoryId,
            attachSubjectId: input.subjectId ?? null,
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
 * Changes a rule: its conditions, what it sets, whether it is on. What it already classified or
 * attached stays as it is; apply it to the past again to follow the change. Refused as
 * `createRule` refuses it.
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

        const effect = {
          merchantId: edit.merchantId === undefined ? row.setMerchantId : edit.merchantId,
          categoryId: edit.categoryId === undefined ? row.setCategoryId : edit.categoryId,
          subjectId: edit.subjectId === undefined ? row.attachSubjectId : edit.subjectId,
        };

        // A rule that keeps its category (turned off or on, say) is not refused for a category
        // archived since, nor for a merchant marked an intermediary since, nor for a subject
        // archived since: it keeps what it had.
        const problem = await problemOf(transaction, conditions, effect, {
          categoryId: row.setCategoryId,
          merchantId: row.setMerchantId,
          subjectId: row.attachSubjectId,
        });

        if (problem !== null) {
          return Result.fail(problem);
        }

        await transaction
          .update(rule)
          .set({
            conditions,
            setMerchantId: effect.merchantId,
            setCategoryId: effect.categoryId,
            attachSubjectId: effect.subjectId,
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
 * rule; the rule's name is gone from them. The expenses it attached keep their subject.
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

        return Result.succeed(await listIn(transaction));
      },
    );

    return yield* Effect.fromResult(moved);
  });

/**
 * Applies a rule to the past in `owner`'s transaction, its category turn taken: each line it
 * applies to gets the merchant and the category it sets, classified by the rule, and its subject,
 * unless the user classified it by hand and `includeByHand` is false.
 */
async function applyToPastIn(
  transaction: UserTransaction,
  row: RuleRow,
  conditions: Conditions,
  includeByHand: boolean,
): Promise<RuleApplied> {
  const planned = plan(
    row.id,
    row,
    await matchingEntries(transaction, conditions),
    await effectFacts(transaction),
    await subjectFacts(transaction, row.attachSubjectId === null ? [] : [row.attachSubjectId]),
  ).filter(
    (each) =>
      (each.changes || each.attaches) && (includeByHand || each.entry.classifiedBy !== "user"),
  );

  const from: ReadonlyArray<RuleEntry["classifiedBy"]> = includeByHand
    ? ["default", "rule", "user"]
    : ["default", "rule"];

  const written = await writeEntries(
    transaction,
    row.id,
    planned.flatMap((each) =>
      each.changes && each.wanted !== null ? [{ entry: each.entry, wanted: each.wanted }] : [],
    ),
    from,
  );

  const attached =
    row.attachSubjectId === null
      ? NONE
      : await attachSubjects(
          transaction,
          row.attachSubjectId,
          planned.flatMap((each) => (each.attaches ? [each.entry.id] : [])),
          from,
        );

  const changed = new Set([...written, ...attached]);

  await countApplied(transaction, row.id, changed.size);

  return {
    changed: changed.size,
    byHand: planned.filter(
      (each) => each.entry.classifiedBy === "user" && changed.has(each.entry.id),
    ).length,
  };
}

/**
 * Applies a rule to the lines already there, what its job runs: each line it applies to gets the
 * merchant and the category it sets, classified by the rule, and its subject attached to its
 * expense, unless the user classified it by hand and `includeByHand` is false. A rule turned off
 * applies too: the user asked for it. In one transaction: a run again changes nothing more.
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

        return Result.succeed(
          await applyToPastIn(transaction, row, conditions.value, includeByHand),
        );
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

/** A merchant condition as the rules of a subject's merchants hold it: "merchant is" alone. */
const merchantIs = (merchantId: string): Conditions => ({
  kind: "group",
  combinator: "and",
  children: [{ kind: "rule", field: "merchant", operator: "eq", value: merchantId }],
});

/**
 * The merchant of a rule of a subject's merchants (#37): one that attaches the subject and sets
 * nothing else, with one condition, "merchant is". Null for any other rule.
 */
function merchantRuleOf(row: RuleRow): string | null {
  const conditions = conditionsOf(row);
  const [only] = Option.isSome(conditions) ? conditions.value.children : [];

  return row.setMerchantId === null &&
    row.setCategoryId === null &&
    Option.isSome(conditions) &&
    conditions.value.children.length === 1 &&
    only?.field === "merchant"
    ? only.value
    : null;
}

/** A subject's rules: those of its merchants, and how many others attach it. */
export type SubjectRules = {
  /**
   * Its merchants, by name, each with its rules ("merchant is" it and nothing else), in their order:
   * one, unless the user made two alike.
   */
  readonly merchants: ReadonlyArray<RuleMerchant & { readonly ruleIds: ReadonlyArray<string> }>;
  /** The other rules that attach it. */
  readonly others: number;
};

/** The rules that attach `subjectId`, in `owner`'s transaction. */
export async function subjectRulesIn(
  transaction: UserTransaction,
  subjectId: string,
): Promise<SubjectRules> {
  const rows = await transaction
    .select()
    .from(rule)
    .where(eq(rule.attachSubjectId, subjectId))
    .orderBy(asc(rule.position), asc(rule.id));

  const rulesOf = new Map<string, Array<string>>();
  let others = 0;

  for (const row of rows) {
    const merchantId = merchantRuleOf(row);
    const known = merchantId === null ? undefined : rulesOf.get(merchantId);

    if (merchantId === null) {
      others += 1;
    } else if (known === undefined) {
      rulesOf.set(merchantId, [row.id]);
    } else {
      known.push(row.id);
    }
  }

  const named = await merchantsAmong(transaction, [...rulesOf.keys()]);

  return {
    merchants: named.map((each) => ({
      id: each.id,
      name: each.name,
      ruleIds: rulesOf.get(each.id) ?? [],
    })),
    others,
  };
}

/** The first of `merchantIds` that is none of the user's merchants; null when each is. */
export async function unknownMerchantIn(
  transaction: UserTransaction,
  merchantIds: ReadonlyArray<string>,
): Promise<MerchantNotFound | null> {
  const known = new Set((await merchantsAmong(transaction, merchantIds)).map((each) => each.id));
  const missing = merchantIds.find((each) => !known.has(each));

  return missing === undefined ? null : new MerchantNotFound({ merchantId: missing });
}

/** The merchants a subject's merchants' rules gain and lose when they become `merchantIds`. */
async function merchantChangesIn(
  transaction: UserTransaction,
  subjectId: string | null,
  merchantIds: ReadonlyArray<string>,
) {
  const wanted = [...new Set(merchantIds)];

  const existing =
    subjectId === null ? [] : (await subjectRulesIn(transaction, subjectId)).merchants;

  const had = new Set(existing.map((each) => each.id));

  return {
    wanted,
    added: wanted.filter((each) => !had.has(each)),
    kept: existing.filter((each) => wanted.includes(each.id)),
    removed: existing.filter((each) => !wanted.includes(each.id)),
  };
}

/**
 * The past expenses of the merchants `merchantIds` that their rules would attach to `subjectId`
 * now, with each one's merchant: those of one whole line each whose line's merchant is one of them,
 * neither attached to the subject already nor declined for it. An archived subject counts as an
 * open one: what restoring it with these merchants attaches; no merchant is added to one that stays
 * archived (`editIn`). Every one of them for a subject not made yet (null).
 */
export async function merchantPastIn(
  transaction: UserTransaction,
  subjectId: string | null,
  merchantIds: ReadonlyArray<string>,
) {
  const expenses = await merchantExpensesIn(transaction, merchantIds);

  if (subjectId === null) {
    return expenses;
  }

  const subjects = await subjectFacts(transaction, [subjectId]);
  const open = new Set([subjectId]);

  return expenses.filter(
    (each) => subjectPart(subjectId, subjectTarget(subjects, each), open) === "attaches",
  );
}

/**
 * What is wrong with making a subject's merchants `merchantIds` (`setSubjectMerchantsIn`), for the
 * subject `subjectId` (null for one not made yet); null when nothing: a merchant the user does not
 * have, `MAX_RULES` passed. The merchants it would add.
 */
export async function subjectMerchantsProblemIn(
  transaction: UserTransaction,
  subjectId: string | null,
  merchantIds: ReadonlyArray<string>,
): Promise<Result.Result<ReadonlyArray<string>, MerchantNotFound | TooManyRules>> {
  const { wanted, added, removed } = await merchantChangesIn(transaction, subjectId, merchantIds);
  const missing = await unknownMerchantIn(transaction, wanted);

  if (missing !== null) {
    return Result.fail(missing);
  }

  const dropped = removed.flatMap((each) => each.ruleIds).length;

  if ((await ruleCount(transaction)) - dropped + added.length > MAX_RULES) {
    return Result.fail(new TooManyRules({ limit: MAX_RULES }));
  }

  return Result.succeed(added);
}

/**
 * Makes the rules of a subject's merchants be those of `merchantIds` (#37), in `owner`'s
 * transaction, its category turn taken, once `subjectMerchantsProblemIn` found nothing wrong: one
 * rule "merchant is" each, attaching the subject, made by the user, tried after the others; every
 * rule of a merchant left out is deleted (what they attached stays), every other rule stays as it
 * is. With `attachPast`, the past expenses of every merchant of `merchantIds` (those it had too) are
 * attached to the subject now, as applying their rules to the past with the lines classified by
 * hand would, a declined pair aside (`merchantPastIn`). How many expenses it attached.
 */
export async function setSubjectMerchantsIn(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  merchantIds: ReadonlyArray<string>,
  attachPast: boolean,
): Promise<number> {
  const { added, kept, removed } = await merchantChangesIn(transaction, subjectId, merchantIds);
  // Two rules alike, made by hand, go together: none is left to attach the subject unseen.
  const dropped = removed.flatMap((each) => each.ruleIds);

  if (dropped.length > 0) {
    await transaction.delete(rule).where(inArray(rule.id, dropped));
  }

  const first = added.length === 0 ? 0 : await nextPosition(transaction);

  const made =
    added.length === 0
      ? []
      : await transaction
          .insert(rule)
          .values(
            added.map((merchantId, index): typeof rule.$inferInsert => ({
              userId: owner,
              position: first + index,
              conditions: merchantIs(merchantId),
              attachSubjectId: subjectId,
              createdFrom: "user",
            })),
          )
          .returning({ id: rule.id, conditions: rule.conditions });

  if (!attachPast) {
    return 0;
  }

  // Each merchant's rule attaches its past: the first of those it had, or the one just made.
  const rules = [
    ...kept.flatMap((each) => {
      const [ruleId] = each.ruleIds;

      return ruleId === undefined ? [] : [{ ruleId, merchantId: each.id }];
    }),
    ...made.flatMap((row) => {
      const conditions = conditionsOf(row);
      const [merchantId] = Option.isSome(conditions) ? merchantsNamed(conditions.value) : [];

      return merchantId === undefined ? [] : [{ ruleId: row.id, merchantId }];
    }),
  ];

  const expenses = await merchantPastIn(
    transaction,
    subjectId,
    rules.map((each) => each.merchantId),
  );

  let attached = 0;

  for (const each of rules) {
    const ids = expenses.flatMap((expense) =>
      expense.lineMerchantId === each.merchantId ? [expense.id] : [],
    );

    const written = await attachSubjects(transaction, subjectId, ids, ["default", "rule", "user"]);

    await countApplied(transaction, each.ruleId, written.size);
    attached += written.size;
  }

  return attached;
}

/**
 * Moves the conditions that name the merchant `from` to the merchant `into`, in the transaction of
 * a merge that deletes `from`: a condition's merchant is an id inside the rule's JSON, which no
 * foreign key follows. Two rules of a subject's merchants made alike by the move ("merchant is"
 * `into`, the same subject, enabled alike, nothing else set) become one: the earliest stays,
 * counting what both applied to, and the other is deleted.
 */
export async function moveMerchantConditionsIn(
  transaction: UserTransaction,
  from: string,
  into: string,
): Promise<void> {
  const naming = JSON.stringify({ children: [{ field: "merchant", value: from }] });

  const rows = await transaction
    .select({ id: rule.id, conditions: rule.conditions })
    .from(rule)
    .where(sql`${rule.conditions} @> ${naming}::jsonb`)
    .for("update");

  for (const row of rows) {
    const conditions = conditionsOf(row);

    if (Option.isSome(conditions)) {
      await transaction
        .update(rule)
        .set({ conditions: mergedMerchant(conditions.value, from, into) })
        .where(eq(rule.id, row.id));
    }
  }

  if (rows.length > 0) {
    await mergeAlikeIn(transaction, into);
  }
}

/** Makes one of the rules of a subject's merchant `merchantId` that are alike. */
async function mergeAlikeIn(transaction: UserTransaction, merchantId: string): Promise<void> {
  const naming = JSON.stringify({ children: [{ field: "merchant", value: merchantId }] });

  const rows = await transaction
    .select()
    .from(rule)
    .where(and(isNotNull(rule.attachSubjectId), sql`${rule.conditions} @> ${naming}::jsonb`))
    .orderBy(asc(rule.position), asc(rule.id))
    .for("update");

  // The earliest rule of each subject, enabled or not, by `subject/enabled`.
  const earliest = new Map<string, string>();

  for (const row of rows.filter((each) => merchantRuleOf(each) === merchantId)) {
    const key = `${row.attachSubjectId ?? ""}/${row.enabled}`;
    const kept = earliest.get(key);

    if (kept === undefined) {
      earliest.set(key, row.id);
    } else {
      await transaction.delete(rule).where(eq(rule.id, row.id));

      await countApplied(transaction, kept, row.appliedCount);
    }
  }
}

/** The merchants the user's rules' conditions name, in `owner`'s transaction. */
export async function conditionMerchantsIn(
  transaction: UserTransaction,
): Promise<ReadonlySet<string>> {
  const rows = await transaction.select({ conditions: rule.conditions }).from(rule);

  return new Set(
    rows.flatMap((row) => {
      const conditions = conditionsOf(row);

      return Option.isSome(conditions) ? merchantsNamed(conditions.value) : [];
    }),
  );
}
