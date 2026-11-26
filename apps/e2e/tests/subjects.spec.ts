import {
  DatabaseLineStore,
  SplitRefused,
  SubjectNameTaken,
  SubjectNotFound,
  SubjectRefused,
  Today,
  attachSubject,
  createSubject,
  editSubject,
  expensesLayer,
  lineExpensesOf,
  listSubjects,
  monthFactsLayer,
  monthSubjectSpending,
  refuseProposals,
  searchLines,
  showSubject,
  splitLine,
} from "@gousset/core";
import type { Expenses, LineExpenses, LineStore, MonthFacts, SubjectInput } from "@gousset/core";
import {
  account,
  category,
  entry,
  entryPart,
  statementLine,
  subject,
} from "@gousset/db/schema/ledger";
import type { UserData } from "@gousset/db/user-data";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #37, subjects: what the money is spent for, nested, beside the category. The counting rule
// (an expense on a subject and its parent counts once in the parent, whole in each of several
// subjects, other currencies apart), the proposals of a subject with dates (never attached without
// the user's yes, a refusal remembered), a split keeping or setting subjects, the refusals, the
// operations list by subject and the month by subject, all through `@gousset/core` on the worker's
// real database, for a user of this file's own. Every name and amount is invented.

let data: ReturnType<typeof openUserData>;
let owner = "";
let euros = "";
let dollars = "";
let loan = "";

/** Every expense of these tests happened before this day, which the logic reads as today. */
const TODAY = "2026-11-30";

type Services = UserData | Expenses | LineStore | MonthFacts;

const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(expensesLayer, DatabaseLineStore, monthFactsLayer).pipe(
          Layer.provideMerge(data.layer),
        ),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** The refusal an effect fails with. */
const refusalOf = <A, E>(effect: Effect.Effect<A, E, Services>) => run(Effect.flip(effect));

async function newAccount(
  name: string,
  kind: "current" | "loan",
  currency = "EUR",
): Promise<string> {
  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, currency })
      .returning({ id: account.id }),
  );

  if (made === undefined) {
    throw new Error("The account was not made.");
  }

  return made.id;
}

/**
 * An expense of one line, as the import writes it: a counted line of `minor` going out, its entry
 * in the expense fallback, classified by default, with one payment part of the whole line; and its
 * refunds, each a line coming back with a refund part.
 */
async function spend(
  on: string,
  day: string,
  minor: number,
  label: string,
  refunds: ReadonlyArray<number> = [],
): Promise<{ readonly lineId: string; readonly entryId: string }> {
  return data.asUser(owner, async (transaction) => {
    const [fallback] = await transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.kind, "expense"), eq(category.isFallback, true)));

    const line = async (amountMinor: number, text: string) => {
      const [made] = await transaction
        .insert(statementLine)
        .values({
          userId: owner,
          accountId: on,
          source: "manual",
          bookedOn: day,
          amountMinor,
          label: text,
        })
        .returning({ id: statementLine.id });

      return made?.id ?? "";
    };

    const lineId = await line(-minor, label);

    const [made] = await transaction
      .insert(entry)
      .values({
        userId: owner,
        kind: "expense",
        happenedOn: day,
        categoryId: fallback?.id ?? "",
        classifiedBy: "default",
      })
      .returning({ id: entry.id });

    const entryId = made?.id ?? "";

    await transaction
      .insert(entryPart)
      .values({ userId: owner, entryId, lineId, role: "payment", amountMinor: minor });

    for (const refund of refunds) {
      await transaction.insert(entryPart).values({
        userId: owner,
        entryId,
        lineId: await line(refund, `REFUND ${label}`),
        role: "refund",
        amountMinor: refund,
      });
    }

    return { lineId, entryId };
  });
}

const newSubject = async (input: SubjectInput) => (await run(createSubject(owner, input))).id;

const attach = (subjectId: string, ...entryIds: ReadonlyArray<string>) =>
  run(attachSubject(owner, subjectId, entryIds));

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** The names of each share's subjects, share by share. */
const sharesSubjects = (split: LineExpenses) =>
  split.expenses.map((each) => each.subjects.map((named) => named.name));

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Rui Example",
    email: `rui.subjects.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-rui-password-${app.slot}`,
  });

  data = openUserData(app.database);
  owner = await data.ownerOf(person.email);
  euros = await newAccount("Everyday account", "current");
  dollars = await newAccount("Dollar account", "current", "USD");
  loan = await newAccount("Van loan", "loan");
});

test.afterAll(async () => {
  await data.close();
});

test("an expense on a subject and on its parent counts once in the parent", async () => {
  const house = await newSubject({ name: "House" });
  const shed = await newSubject({ name: "Garden shed", parentId: house, accountIds: [euros] });
  const both = await spend(euros, "2026-10-03", 4000, "CB TIMBERYARD 0310 RIVERTON");
  const paint = await spend(euros, "2026-10-09", 2500, "CB PAINTWORKS 0910", [500]);

  expect((await attach(house, both.entryId)).changed).toBe(1);
  await attach(shed, both.entryId, paint.entryId);

  const detail = await run(showSubject(owner, house, "EUR", { year: 2026 }));

  // The timber once, the paint at its net cost: 25 less the 5 refunded.
  expect(detail.total).toEqual(eur(4000 + 2000));
  expect(detail.expenses.count).toBe(2);
  expect(detail.expenses.latest.map((each) => each.entryId)).toEqual([paint.entryId, both.entryId]);
  expect(detail.months).toEqual([
    { month: "2026-10", spent: eur(6000) },
    { month: "2026-11", spent: eur(0) },
  ]);
  expect(detail.categories).toEqual([
    {
      category: expect.objectContaining({ name: expect.any(String), parentName: null }),
      spent: eur(6000),
    },
  ]);
  expect(detail.children).toEqual([
    { id: shed, name: "Garden shed", archived: false, total: eur(6000), elsewhere: [] },
  ]);
  expect(detail.proposals).toBeNull();

  const shedDetail = await run(showSubject(owner, shed, "EUR"));

  expect(shedDetail.total).toEqual(eur(6000));
  expect(shedDetail.accounts).toEqual([
    expect.objectContaining({ id: euros, name: "Everyday account", balance: expect.any(Object) }),
  ]);

  // The list: parents first, each with what it cost this year, per month from its first expense.
  const listed = (await run(listSubjects(owner, "EUR"))).subjects.filter((each) =>
    [house, shed].includes(each.id),
  );

  expect(listed.map((each) => [each.name, each.depth])).toEqual([
    ["House", 0],
    ["Garden shed", 1],
  ]);
  expect(listed[0]?.headline).toEqual({
    kind: "monthly",
    year: 2026,
    months: 2,
    total: eur(6000),
    perMonth: eur(3000),
    elsewhere: [],
  });
});

test("an expense on several subjects counts whole in each, another currency apart", async () => {
  const van = await newSubject({
    name: "Van",
    valueMinor: 1_800_000,
    valueCurrency: "EUR",
    loanAccountId: loan,
  });

  const trip = await newSubject({ name: "Coast trip" });
  const fuel = await spend(euros, "2026-08-14", 6000, "CB FUELSTOP 1408");
  const tyres = await spend(euros, "2026-07-02", 30_000, "CB TYREHOUSE 0207");
  const ferry = await spend(dollars, "2026-08-15", 1200, "CB HARBOR FERRY 1508");

  await attach(van, fuel.entryId, tyres.entryId, ferry.entryId);
  await attach(trip, fuel.entryId);

  const detail = await run(showSubject(owner, van, "EUR", "all"));

  expect(detail.total).toEqual(eur(36_000));
  expect(detail.elsewhere).toEqual([{ minor: 1200, currency: "USD" }]);
  expect(detail.value).toEqual(eur(1_800_000));
  expect(detail.loan).toEqual(
    expect.objectContaining({ id: loan, name: "Van loan", balance: eur(0) }),
  );
  expect(detail.months.map((each) => each.month)).toEqual([
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
  ]);
  expect((await run(showSubject(owner, trip, "EUR"))).total).toEqual(eur(6000));

  // Attaching again changes nothing.
  expect((await attach(van, fuel.entryId)).changed).toBe(0);
  expect((await run(showSubject(owner, van, "EUR", "all"))).total).toEqual(eur(36_000));
});

test("a dated subject proposes its period's expenses, attached only once the user says yes", async () => {
  const alps = await newSubject({
    name: "Alps 2028",
    startsOn: "2026-02-01",
    endsOn: "2026-02-10",
  });

  const before = await spend(euros, "2026-01-31", 900, "CB SNOWGEAR 3101");
  const pass = await spend(euros, "2026-02-03", 12_000, "CB SKIPASS 0302");
  const chalet = await spend(euros, "2026-02-04", 45_000, "CB CHALET 0402");
  const fondue = await spend(euros, "2026-02-06", 3800, "CB FONDUE 0602");
  const after = await spend(euros, "2026-02-11", 700, "CB SNOWGEAR 1102");

  const proposed = async () =>
    (await run(showSubject(owner, alps, "EUR"))).proposals?.expenses.map((each) => each.entryId);

  // Proposed, the oldest first: none attached.
  expect(await proposed()).toEqual([pass.entryId, chalet.entryId, fondue.entryId]);
  expect((await run(showSubject(owner, alps, "EUR"))).total).toEqual(eur(0));

  // The user confirms two and declines the third: it is never proposed again.
  await attach(alps, pass.entryId, chalet.entryId);
  expect((await run(refuseProposals(owner, alps, [fondue.entryId]))).changed).toBe(1);
  expect(await proposed()).toEqual([]);
  expect((await run(showSubject(owner, alps, "EUR"))).total).toEqual(eur(57_000));

  // Attached by hand after all, the refusal goes.
  await attach(alps, fondue.entryId);
  await run(attachSubject(owner, alps, [fondue.entryId], { remove: true }));
  expect(await proposed()).toEqual([fondue.entryId]);

  // The days around the period were never proposed.
  expect(await proposed()).not.toContain(before.entryId);
  expect(await proposed()).not.toContain(after.entryId);
});

test("a split keeps the line's subjects, or sets those given", async () => {
  const house = await newSubject({ name: "Workshop" });
  const van = await newSubject({ name: "Camper" });
  const bought = await spend(euros, "2026-09-20", 9000, "CB HARDWARE HUB 2009");

  await attach(house, bought.entryId);

  const [before] = (await run(lineExpensesOf(owner, bought.lineId))).expenses;
  const categoryId = before?.category.id ?? "";

  expect(before?.subjects).toEqual([{ id: house, name: "Workshop" }]);

  // Left out, each share keeps what the expense had.
  const kept = await run(
    splitLine(owner, bought.lineId, [
      { categoryId, amount: "50" },
      { categoryId, amount: "40" },
    ]),
  );

  expect(kept.expenses.map((each) => each.subjects.map((named) => named.name))).toEqual([
    ["Workshop"],
    ["Workshop"],
  ]);

  // Given, a share gets exactly those.
  const set = await run(
    splitLine(owner, bought.lineId, [
      { categoryId, amount: "60", subjectIds: [van] },
      { categoryId, amount: "30", subjectIds: [] },
    ]),
  );

  expect(set.expenses.map((each) => each.subjects.map((named) => named.name))).toEqual([
    ["Camper"],
    [],
  ]);
  expect((await run(showSubject(owner, van, "EUR"))).total).toEqual(eur(6000));
  expect((await run(showSubject(owner, house, "EUR"))).total).toEqual(eur(0));

  // An archived subject can no longer be chosen.
  await run(editSubject(owner, house, { archived: true }));

  expect(
    await refusalOf(
      splitLine(owner, bought.lineId, [{ categoryId, amount: "90", subjectIds: [house] }]),
    ),
  ).toEqual(new SplitRefused({ reason: "subject_archived", index: 0 }));
});

test("a split keeps an archived subject the line already had, and refuses another archived one", async () => {
  const old = await newSubject({ name: "Old van" });
  const shed = await newSubject({ name: "Boat shed" });
  const fuel = await spend(euros, "2026-09-22", 8000, "CB FUELSTOP 2209");

  await attach(old, fuel.entryId);

  const [before] = (await run(lineExpensesOf(owner, fuel.lineId))).expenses;
  const categoryId = before?.category.id ?? "";

  await run(editSubject(owner, old, { archived: true }));
  await run(editSubject(owner, shed, { archived: true }));

  // The split form gives each share the line's subjects: one archived since is kept, as a rule keeps
  // an archived category it had.
  const kept = await run(
    splitLine(owner, fuel.lineId, [
      { categoryId, amount: "50", subjectIds: [old] },
      { categoryId, amount: "30", subjectIds: [] },
    ]),
  );

  expect(sharesSubjects(kept)).toEqual([["Old van"], []]);

  // Split again: one of its expenses still had it.
  const again = await run(
    splitLine(owner, fuel.lineId, [
      { categoryId, amount: "40", subjectIds: [old] },
      { categoryId, amount: "40", subjectIds: [old] },
    ]),
  );

  expect(sharesSubjects(again)).toEqual([["Old van"], ["Old van"]]);

  // An archived subject the line never had is still refused, under its share.
  expect(
    await refusalOf(
      splitLine(owner, fuel.lineId, [
        { categoryId, amount: "40", subjectIds: [old] },
        { categoryId, amount: "40", subjectIds: [old, shed] },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "subject_archived", index: 1 }));
});

test("a move that would make a cycle is refused, and so are the other wrong subjects", async () => {
  const home = await newSubject({ name: "Cottage" });
  const shed = await newSubject({ name: "Cottage shed", parentId: home });
  const roof = await newSubject({ name: "Shed roof", parentId: shed });

  expect(await refusalOf(editSubject(owner, home, { parentId: roof }))).toEqual(
    new SubjectRefused({ reason: "cycle", subjectId: roof }),
  );
  expect(await refusalOf(editSubject(owner, home, { parentId: home }))).toEqual(
    new SubjectRefused({ reason: "cycle", subjectId: home }),
  );

  // Nothing moved; a move elsewhere goes.
  expect((await run(editSubject(owner, roof, { parentId: home }))).parentId).toBe(home);

  const refused = async (input: SubjectInput) => refusalOf(createSubject(owner, input));

  expect(await refused({ name: "  " })).toEqual(new SubjectRefused({ reason: "name" }));
  expect(await refused({ name: "cottage" })).toEqual(new SubjectNameTaken({ name: "cottage" }));
  const nowhere = crypto.randomUUID();

  expect(await refused({ name: "Pond", parentId: nowhere })).toEqual(
    new SubjectRefused({ reason: "parent_missing", subjectId: nowhere }),
  );
  expect(await refused({ name: "Pond", valueMinor: 50_000 })).toEqual(
    new SubjectRefused({ reason: "value" }),
  );
  expect(await refused({ name: "Pond", loanAccountId: euros })).toEqual(
    new SubjectRefused({ reason: "loan", accountId: euros }),
  );
  expect(await refused({ name: "Pond", accountIds: [nowhere] })).toEqual(
    new SubjectRefused({ reason: "account", accountId: nowhere }),
  );
  expect(await refused({ name: "Pond", startsOn: "2026-05-10", endsOn: "2026-05-01" })).toEqual(
    new SubjectRefused({ reason: "dates" }),
  );

  await run(editSubject(owner, shed, { archived: true }));

  expect(await refused({ name: "Pond", parentId: shed })).toEqual(
    new SubjectRefused({ reason: "parent_archived", subjectId: shed }),
  );

  const spent = await spend(euros, "2026-06-01", 100, "CB POND SHOP 0106");

  expect(await refusalOf(attachSubject(owner, shed, [spent.entryId]))).toEqual(
    new SubjectRefused({ reason: "archived", subjectId: shed }),
  );
  // Taking an expense off it adds nothing to it: an archived subject allows that (a line's
  // detail removes its chip).
  expect((await run(attachSubject(owner, shed, [spent.entryId], { remove: true }))).changed).toBe(
    0,
  );
  expect(await refusalOf(attachSubject(owner, nowhere, [spent.entryId]))).toEqual(
    new SubjectNotFound({ subjectId: nowhere }),
  );
  expect(await refusalOf(showSubject(owner, "no-id", "EUR"))).toEqual(
    new SubjectNotFound({ subjectId: "no-id" }),
  );
});

test("the operations list gives a subject's lines, its descendants' included", async () => {
  const farm = await newSubject({ name: "Farm" });
  const barn = await newSubject({ name: "Barn", parentId: farm });
  const hay = await spend(euros, "2026-05-02", 1500, "CB HAYLOFT 0205");
  const nails = await spend(euros, "2026-05-03", 300, "CB NAILERY 0305");

  await attach(farm, hay.entryId);
  await attach(barn, nails.entryId);

  const page = await run(searchLines(owner, { subjectId: farm }));

  expect(page.lines.map((line) => [line.id, line.subjects.map((each) => each.name)])).toEqual([
    [nails.lineId, ["Barn"]],
    [hay.lineId, ["Farm"]],
  ]);
  expect((await run(searchLines(owner, { subjectId: barn }))).total).toBe(1);
  expect((await run(searchLines(owner, { subjectId: crypto.randomUUID() }))).total).toBe(0);
});

test("the month by subject counts each subject's subtree once", async () => {
  const boat = await newSubject({ name: "Boat" });
  const sail = await newSubject({ name: "Boat sail", parentId: boat });
  const rope = await spend(euros, "2026-03-04", 2200, "CB ROPEMAKER 0403");

  await attach(boat, rope.entryId);
  await attach(sail, rope.entryId);

  const read = await run(monthSubjectSpending(owner, "2026-03", "EUR"));
  const rows = read.rows.filter((row) => [boat, sail].includes(row.id));

  expect(rows.map((row) => [row.name, row.depth, row.spent])).toEqual([
    ["Boat", 0, eur(2200)],
    ["Boat sail", 1, eur(2200)],
  ]);
});

test("a subject's parent is kept: one with children is not deleted", async () => {
  const garage = await newSubject({ name: "Garage" });

  await newSubject({ name: "Garage door", parentId: garage });

  // The app never deletes a subject (it archives it): only the key is tried here, checked at
  // commit, once every cascade of a user's deletion has run.
  expect(
    await data.refusal(owner, (transaction) =>
      transaction.delete(subject).where(eq(subject.id, garage)),
    ),
  ).toBe("23503");
});
