import {
  DatabaseCategoryStore,
  DatabaseLineStore,
  MerchantNotFound,
  Merchants,
  RuleConditionsRefused,
  RuleEffectRefused,
  SubjectNotFound,
  Today,
  applyRuleToPast,
  attachSubject,
  classifyLine,
  createRule,
  createSubject,
  editSubject,
  listRules,
  merchantKey,
  merchantsLayer,
  previewRule,
  refuseProposals,
  searchLines,
  showRule,
  showSubject,
  subjectMerchantsPreview,
} from "@gousset/core";
import type { CategoryStore, LineStore, RuleInput } from "@gousset/core";
import { exampleStatement } from "@gousset/fixture";
import {
  category,
  entry,
  entryPart,
  entrySubject,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserData } from "@gousset/db/user-data";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { importsOn, statementFile } from "../src/imports";
import { addUser, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #37, the rules' part of the subjects: a rule's merchant condition and the subject it
// attaches, at import and applied to the past, beside "first rule wins" rather than in it; a subject
// made from merchants, and a merge of merchants moving the conditions. Through `@gousset/core` on
// the worker's real database, each test with a user of its own. Every label and amount is invented.

const TODAY = "2026-11-30";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

type Services = UserData | LineStore | Merchants | CategoryStore;

const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(DatabaseLineStore, DatabaseCategoryStore, merchantsLayer).pipe(
          Layer.provideMerge(data.layer),
        ),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

const refusalOf = <A, E>(effect: Effect.Effect<A, E, Services>) => run(Effect.flip(effect));

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

async function ownerFor(
  app: { baseURL: string },
  admin: Parameters<typeof addUser>[1],
  local: string,
) {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return data.ownerOf(person.email);
}

let files = 0;

/**
 * Lines going out, imported as the app imports them, in an account of their own: their merchants
 * recognised, the user's rules applied. The ids of each line and of its entry, by label.
 */
async function importLines(
  owner: string,
  lines: ReadonlyArray<{ readonly day: string; readonly minor: number; readonly label: string }>,
) {
  files += 1;

  const accountId = await imports.createAccount(owner, `Account ${files}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: lines.map((line, index) => ({
        bookedOn: line.day,
        amountMinor: -line.minor,
        label: line.label,
        reference: `E2E-SUBJECT-RULE-${files}-${index}`,
      })),
    }),
  );

  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ lineId: statementLine.id, label: statementLine.label, entryId: entryPart.entryId })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .where(eq(statementLine.accountId, accountId)),
  );

  return new Map(rows.map((row) => [row.label, row]));
}

/** The entry of the imported line `label`. */
function entryOf(
  lines: ReadonlyMap<string, { readonly lineId: string; readonly entryId: string }>,
  label: string,
) {
  const found = lines.get(label);

  if (found === undefined) {
    throw new Error(`The line ${label} was not imported.`);
  }

  return found;
}

/** The merchant recognised from `label`. */
async function merchantOf(owner: string, label: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: merchantAlias.merchantId })
      .from(merchantAlias)
      .where(eq(merchantAlias.alias, merchantKey(label, null) ?? label)),
  );

  if (found === undefined) {
    throw new Error(`No merchant for ${label}.`);
  }

  return found.id;
}

/** The subjects an entry is attached to. */
async function subjectsOf(owner: string, entryId: string): Promise<ReadonlyArray<string>> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: entrySubject.subjectId })
      .from(entrySubject)
      .where(eq(entrySubject.entryId, entryId)),
  );

  return rows.map((row) => row.id).toSorted();
}

async function classificationOf(owner: string, entryId: string) {
  const [row] = await data.asUser(owner, (transaction) =>
    transaction
      .select({
        categoryId: entry.categoryId,
        classifiedBy: entry.classifiedBy,
        ruleId: entry.ruleId,
      })
      .from(entry)
      .where(eq(entry.id, entryId)),
  );

  return row;
}

async function expenseCategory(owner: string, name: string, parent: string | null = null) {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id, name: category.name, parentId: category.parentId })
      .from(category)
      .where(and(eq(category.kind, "expense"), eq(category.name, name))),
  );

  const parentId =
    parent === null
      ? null
      : (
          await data.asUser(owner, (transaction) =>
            transaction
              .select({ id: category.id })
              .from(category)
              .where(and(eq(category.name, parent), isNull(category.parentId))),
          )
        )[0]?.id;

  const found = rows.find((row) => row.parentId === (parentId ?? null));

  if (found === undefined) {
    throw new Error(`No expense category ${name}.`);
  }

  return found.id;
}

const merchantIs = (merchantId: string): RuleInput["conditions"] => ({
  kind: "group",
  combinator: "and",
  children: [{ kind: "rule", field: "merchant", operator: "eq", value: merchantId }],
});

/** A rule made as the rules' screen makes one. */
const rule = (owner: string, input: Partial<RuleInput> & Pick<RuleInput, "conditions">) =>
  run(
    createRule(owner, {
      merchantId: null,
      categoryId: null,
      subjectId: null,
      createdFrom: "user",
      ...input,
    }),
  );

const newSubject = async (owner: string, name: string) =>
  (await run(createSubject(owner, { name }))).id;

const eur = (minor: number) => ({ minor, currency: "EUR" });

test("a merchant rule attaches its subject at import", async ({ app, user }) => {
  const owner = await ownerFor(app, user, "subject-rule-import");

  const before = await importLines(owner, [
    { day: "2026-10-01", minor: 5000, label: "CB FUELSTOP 0110" },
  ]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0110");
  const van = await newSubject(owner, "Van");
  const made = await rule(owner, { conditions: merchantIs(fuelstop), subjectId: van });

  expect(made.subject).toEqual(expect.objectContaining({ id: van, name: "Van", path: "Van" }));

  const after = await importLines(owner, [
    { day: "2026-10-15", minor: 6200, label: "CB FUELSTOP 1510" },
    { day: "2026-10-16", minor: 900, label: "CB BAKEHOUSE 1610" },
  ]);

  // The new line of the merchant gets the subject; the other merchant's, and the line already there
  // (which waits for the rule to be applied to the past), do not.
  expect(await subjectsOf(owner, entryOf(after, "CB FUELSTOP 1510").entryId)).toEqual([van]);
  expect(await subjectsOf(owner, entryOf(after, "CB BAKEHOUSE 1610").entryId)).toEqual([]);
  expect(await subjectsOf(owner, entryOf(before, "CB FUELSTOP 0110").entryId)).toEqual([]);
  expect((await run(showRule(owner, made.id))).appliedCount).toBe(1);
});

test("a rule's merchant and subject must be the user's, the subject not archived", async ({
  app,
  user,
}) => {
  const owner = await ownerFor(app, user, "subject-rule-refusals");

  await importLines(owner, [{ day: "2026-10-01", minor: 5000, label: "CB FUELSTOP 0110" }]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0110");
  const shed = await newSubject(owner, "Garden shed");
  const nobody = "019a0000-0000-7000-8000-000000000000";

  expect(
    await refusalOf(
      createRule(owner, {
        conditions: merchantIs(nobody),
        merchantId: null,
        categoryId: null,
        subjectId: shed,
        createdFrom: "user",
      }),
    ),
  ).toEqual(new RuleConditionsRefused({ reason: "unknown_merchant", index: 0 }));

  expect(
    await refusalOf(
      createRule(owner, {
        conditions: merchantIs(fuelstop),
        merchantId: null,
        categoryId: null,
        subjectId: nobody,
        createdFrom: "user",
      }),
    ),
  ).toEqual(new SubjectNotFound({ subjectId: nobody }));

  // A rule keeps a subject archived after it was chosen; a new one cannot choose it.
  const kept = await rule(owner, { conditions: merchantIs(fuelstop), subjectId: shed });

  await run(editSubject(owner, shed, { archived: true }));

  expect(
    await refusalOf(
      createRule(owner, {
        conditions: merchantIs(fuelstop),
        merchantId: null,
        categoryId: null,
        subjectId: shed,
        createdFrom: "user",
      }),
    ),
  ).toEqual(new RuleEffectRefused({ reason: "subject_archived" }));
  expect((await run(showRule(owner, kept.id))).subject).toEqual(
    expect.objectContaining({ id: shed, archived: true }),
  );
});

test("applying to the past attaches, and respects a declined pair and the by-hand rule", async ({
  app,
  user,
}) => {
  const owner = await ownerFor(app, user, "subject-rule-past");

  const lines = await importLines(owner, [
    { day: "2026-09-01", minor: 5000, label: "CB FUELSTOP 0109" },
    { day: "2026-09-08", minor: 5100, label: "CB FUELSTOP 0809" },
    { day: "2026-09-15", minor: 5200, label: "CB FUELSTOP 1509" },
    { day: "2026-09-22", minor: 5300, label: "CB FUELSTOP 2209" },
    { day: "2026-09-23", minor: 800, label: "CB BAKEHOUSE 2309" },
  ]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0109");
  const van = await newSubject(owner, "Van");
  const plain = entryOf(lines, "CB FUELSTOP 0109");
  const declined = entryOf(lines, "CB FUELSTOP 0809");
  const byHand = entryOf(lines, "CB FUELSTOP 1509");
  const attached = entryOf(lines, "CB FUELSTOP 2209");

  await run(refuseProposals(owner, van, [declined.entryId]));
  await run(attachSubject(owner, van, [attached.entryId]));
  await run(
    classifyLine(owner, byHand.lineId, {
      categoryId: await expenseCategory(owner, "Fuel", "Transport"),
    }),
  );

  const made = await rule(owner, { conditions: merchantIs(fuelstop), subjectId: van });

  // The declined pair is none of the rule's; the one attached already needs no change.
  expect((await run(showRule(owner, made.id))).reach).toEqual({ lines: 3, toChange: 1, byHand: 1 });
  expect(
    await run(
      previewRule(owner, {
        conditions: merchantIs(fuelstop),
        merchantId: null,
        categoryId: null,
        subjectId: van,
      }),
    ),
  ).toEqual({ lines: 3, toChange: 1, byHand: 1 });

  expect(await run(applyRuleToPast(owner, made.id, false))).toEqual({ changed: 1, byHand: 0 });
  expect(await subjectsOf(owner, plain.entryId)).toEqual([van]);
  expect(await subjectsOf(owner, declined.entryId)).toEqual([]);
  expect(await subjectsOf(owner, byHand.entryId)).toEqual([]);

  // Asked for, the line classified by hand gets it too, and stays the user's.
  expect(await run(applyRuleToPast(owner, made.id, true))).toEqual({ changed: 1, byHand: 1 });
  expect(await subjectsOf(owner, byHand.entryId)).toEqual([van]);
  expect((await classificationOf(owner, byHand.entryId))?.classifiedBy).toBe("user");
  expect(await subjectsOf(owner, declined.entryId)).toEqual([]);
  expect(await subjectsOf(owner, entryOf(lines, "CB BAKEHOUSE 2309").entryId)).toEqual([]);

  // Run again, it changes nothing more.
  expect(await run(applyRuleToPast(owner, made.id, true))).toEqual({ changed: 0, byHand: 0 });
  expect((await run(showRule(owner, made.id))).appliedCount).toBe(2);
});

test("a category rule and a subject rule for one line both apply", async ({ app, user }) => {
  const owner = await ownerFor(app, user, "subject-rule-both");

  await importLines(owner, [{ day: "2026-10-01", minor: 5000, label: "CB FUELSTOP 0110" }]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0110");
  const fuel = await expenseCategory(owner, "Fuel", "Transport");
  const groceries = await expenseCategory(owner, "Groceries");
  const van = await newSubject(owner, "Van");
  const trip = await newSubject(owner, "Coast trip");
  const shed = await newSubject(owner, "Garden shed");

  // Tried first, a rule that sets only a subject takes nothing from the category rule after it; a
  // later rule that sets a category too still attaches its subject.
  const vanRule = await rule(owner, { conditions: merchantIs(fuelstop), subjectId: van });

  const fuelRule = await rule(owner, {
    conditions: {
      kind: "group",
      combinator: "and",
      children: [{ kind: "rule", field: "label", operator: "contains", value: "FUELSTOP" }],
    },
    categoryId: fuel,
  });

  const tripRule = await rule(owner, {
    conditions: merchantIs(fuelstop),
    categoryId: groceries,
    subjectId: trip,
  });

  const unmet = await rule(owner, {
    conditions: {
      kind: "group",
      combinator: "and",
      children: [
        { kind: "rule", field: "merchant", operator: "eq", value: fuelstop },
        { kind: "rule", field: "amount", operator: "gt", value: 1000 },
      ],
    },
    subjectId: shed,
  });

  const lines = await importLines(owner, [
    { day: "2026-10-20", minor: 7000, label: "CB FUELSTOP 2010" },
  ]);

  const fuelLine = entryOf(lines, "CB FUELSTOP 2010");

  expect(await classificationOf(owner, fuelLine.entryId)).toEqual({
    categoryId: fuel,
    classifiedBy: "rule",
    ruleId: fuelRule.id,
  });
  expect(await subjectsOf(owner, fuelLine.entryId)).toEqual([van, trip].toSorted());

  const counts = new Map(
    (await run(listRules(owner))).rules.map((each) => [each.id, each.appliedCount]),
  );

  expect([vanRule, fuelRule, tripRule, unmet].map((each) => counts.get(each.id))).toEqual([
    1, 1, 1, 0,
  ]);
});

test("a subject-only rule leaves the line to review", async ({ app, user }) => {
  const owner = await ownerFor(app, user, "subject-rule-review");

  await importLines(owner, [{ day: "2026-10-01", minor: 5000, label: "CB FUELSTOP 0110" }]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0110");
  const van = await newSubject(owner, "Van");

  await rule(owner, { conditions: merchantIs(fuelstop), subjectId: van });

  const lines = await importLines(owner, [
    { day: "2026-10-21", minor: 6600, label: "CB FUELSTOP 2110" },
  ]);

  const fuelLine = entryOf(lines, "CB FUELSTOP 2110");

  expect(await classificationOf(owner, fuelLine.entryId)).toEqual(
    expect.objectContaining({ classifiedBy: "default", ruleId: null }),
  );

  const toReview = await run(searchLines(owner, { toReview: true, subjectId: van }));

  expect(toReview.lines.map((each) => each.id)).toEqual([fuelLine.lineId]);
  expect(toReview.lines[0]?.subjects).toEqual([{ id: van, name: "Van" }]);
});

test("creating a subject with merchants and attachPast attaches the past", async ({
  app,
  user,
}) => {
  const owner = await ownerFor(app, user, "subject-rule-create");

  const lines = await importLines(owner, [
    { day: "2026-08-02", minor: 5000, label: "CB FUELSTOP 0208" },
    { day: "2026-08-20", minor: 4500, label: "CB FUELSTOP 2008" },
    { day: "2026-08-21", minor: 30_000, label: "CB TYREHOUSE 2108" },
    { day: "2026-08-22", minor: 700, label: "CB BAKEHOUSE 2208" },
  ]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0208");
  const tyrehouse = await merchantOf(owner, "CB TYREHOUSE 2108");

  // The sheet's figure before the subject is made: the past expenses of those merchants.
  expect(await run(subjectMerchantsPreview(owner, [fuelstop, tyrehouse], "EUR"))).toEqual({
    expenses: 3,
    total: eur(39_500),
    elsewhere: [],
  });

  const nobody = "019a0000-0000-7000-8000-000000000000";

  expect(
    await refusalOf(createSubject(owner, { name: "Van", merchantIds: [fuelstop, nobody] })),
  ).toEqual(new MerchantNotFound({ merchantId: nobody }));

  const van = await run(
    createSubject(owner, { name: "Van", merchantIds: [fuelstop, tyrehouse], attachPast: true }),
  );

  expect(van.attached).toBe(3);
  expect(await subjectsOf(owner, entryOf(lines, "CB FUELSTOP 0208").entryId)).toEqual([van.id]);
  expect(await subjectsOf(owner, entryOf(lines, "CB TYREHOUSE 2108").entryId)).toEqual([van.id]);
  expect(await subjectsOf(owner, entryOf(lines, "CB BAKEHOUSE 2208").entryId)).toEqual([]);

  const shown = await run(showSubject(owner, van.id, "EUR", "all"));

  expect(shown.total).toEqual(eur(39_500));
  expect(shown.merchants.map((each) => each.name).toSorted()).toEqual(["Fuelstop", "Tyrehouse"]);
  expect(shown.otherRules).toBe(0);

  const rules = (await run(listRules(owner))).rules;

  expect(
    rules.map((each) => [each.createdFrom, each.subject?.id, each.conditions.children]),
  ).toEqual(
    expect.arrayContaining([
      ["user", van.id, [{ kind: "rule", field: "merchant", operator: "eq", value: fuelstop }]],
      ["user", van.id, [{ kind: "rule", field: "merchant", operator: "eq", value: tyrehouse }]],
    ]),
  );

  // Its merchants changed: the rule of the one taken off goes, what it attached stays.
  await run(editSubject(owner, van.id, { merchantIds: [fuelstop] }));

  expect(
    (await run(showSubject(owner, van.id, "EUR", "all"))).merchants.map((each) => each.id),
  ).toEqual([fuelstop]);
  expect(await subjectsOf(owner, entryOf(lines, "CB TYREHOUSE 2108").entryId)).toEqual([van.id]);

  const later = await importLines(owner, [
    { day: "2026-10-02", minor: 5500, label: "CB FUELSTOP 0210" },
    { day: "2026-10-03", minor: 12_000, label: "CB TYREHOUSE 0310" },
  ]);

  expect(await subjectsOf(owner, entryOf(later, "CB FUELSTOP 0210").entryId)).toEqual([van.id]);
  expect(await subjectsOf(owner, entryOf(later, "CB TYREHOUSE 0310").entryId)).toEqual([]);
});

test("a merge moves the condition", async ({ app, user }) => {
  const owner = await ownerFor(app, user, "subject-rule-merge");

  await importLines(owner, [
    { day: "2026-10-01", minor: 5000, label: "CB FUELSTOP 0110" },
    { day: "2026-10-02", minor: 4000, label: "CB PETROLPOINT 0210" },
  ]);

  const fuelstop = await merchantOf(owner, "CB FUELSTOP 0110");
  const petrolpoint = await merchantOf(owner, "CB PETROLPOINT 0210");
  const van = await newSubject(owner, "Van");
  const made = await rule(owner, { conditions: merchantIs(petrolpoint), subjectId: van });

  await run(
    Effect.gen(function* () {
      const merchants = yield* Merchants;

      return yield* merchants.merge(owner, petrolpoint, fuelstop);
    }),
  );

  expect((await run(showRule(owner, made.id))).conditions).toEqual(merchantIs(fuelstop));

  const later = await importLines(owner, [
    { day: "2026-10-12", minor: 4100, label: "CB PETROLPOINT 1210" },
  ]);

  expect(await subjectsOf(owner, entryOf(later, "CB PETROLPOINT 1210").entryId)).toEqual([van]);
});
