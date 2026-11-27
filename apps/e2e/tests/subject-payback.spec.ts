import {
  DatabaseCategoryStore,
  DatabaseLineStore,
  LinkRefused,
  PaybackRefused,
  SplitRefused,
  SubjectRefused,
  Today,
  attachPayback,
  attachSubject,
  createSubject,
  editSubject,
  expensesLayer,
  lineExpensesOf,
  lineTransferOf,
  linkLine,
  listSubjects,
  monthBenchmarks,
  monthFactsLayer,
  monthMovements,
  monthSummary,
  pairEveryLine,
  paybacksWaiting,
  searchLines,
  showLine,
  showSubject,
  splitLine,
  transfersLayer,
} from "@gousset/core";
import type {
  CategoryStore,
  Expenses,
  LineStore,
  MonthFacts,
  SubjectInput,
  Transfers,
} from "@gousset/core";
import { account, category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import type { UserData } from "@gousset/db/user-data";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #217, a subject paid back by someone else: the lines that pay it back (no income, nothing
// to review, left alone by the pairing of transfers), its figures and where it stands, the share
// of its expenses left to the user in the month and the benchmarks, the refusals, and what the user
// still waits for, all through `@gousset/core` on the worker's real database, for a user of this
// file's own. Every name and amount is invented; each test keeps to months of its own.

let data: ReturnType<typeof openUserData>;
let owner = "";
let euros = "";
let savings = "";
let dollars = "";

const TODAY = "2026-11-30";

type Services = UserData | Expenses | LineStore | MonthFacts | Transfers | CategoryStore;

const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          expensesLayer,
          DatabaseLineStore,
          monthFactsLayer,
          transfersLayer,
          DatabaseCategoryStore,
        ).pipe(Layer.provideMerge(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

const refusalOf = <A, E>(effect: Effect.Effect<A, E, Services>) => run(Effect.flip(effect));

async function newAccount(name: string, kind: "current" | "savings", currency = "EUR") {
  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, currency })
      .returning({ id: account.id }),
  );

  return made?.id ?? "";
}

/**
 * A counted line of one entry, as the import writes it: `minor` signed (out negative), its entry an
 * expense or an income in its kind's fallback, classified by default, of one payment part.
 */
async function line(on: string, day: string, minor: number, label: string) {
  return data.asUser(owner, async (transaction) => {
    const kind = minor < 0 ? "expense" : "income";

    const [fallback] = await transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.kind, kind), eq(category.isFallback, true)));

    const [made] = await transaction
      .insert(statementLine)
      .values({
        userId: owner,
        accountId: on,
        source: "manual",
        bookedOn: day,
        amountMinor: minor,
        label,
      })
      .returning({ id: statementLine.id });

    const [written] = await transaction
      .insert(entry)
      .values({
        userId: owner,
        kind,
        happenedOn: day,
        categoryId: fallback?.id ?? "",
        classifiedBy: "default",
      })
      .returning({ id: entry.id });

    const lineId = made?.id ?? "";
    const entryId = written?.id ?? "";

    await transaction.insert(entryPart).values({
      userId: owner,
      entryId,
      lineId,
      role: "payment",
      amountMinor: Math.abs(minor),
    });

    return { lineId, entryId };
  });
}

const newSubject = async (input: SubjectInput) => (await run(createSubject(owner, input))).id;

const pay = (subjectId: string, lineIds: ReadonlyArray<string>, remove = false) =>
  run(attachPayback(owner, subjectId, lineIds, "EUR", { remove }));

const eur = (minor: number) => ({ minor, currency: "EUR" });

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Noor Example",
    email: `noor.payback.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noor-password-${app.slot}`,
  });

  data = openUserData(app.database);
  owner = await data.ownerOf(person.email);
  euros = await newAccount("Everyday account", "current");
  savings = await newAccount("Savings book", "savings");
  dollars = await newAccount("Dollar account", "current", "USD");
});

test.afterAll(async () => {
  await data.close();
});

test("an expense report pays a work trip back: no income, and the trip says what came back", async () => {
  const trip = await newSubject({ name: "Lyon trip", paybackFrom: "Example Corp" });
  const train = await line(euros, "2026-09-28", -12_000, "CB RAILWAYS 2809");
  const hotel = await line(euros, "2026-10-02", -13_185, "CB GRAND HOTEL 0210");
  const report = await line(euros, "2026-10-15", 10_000, "VIR EXAMPLE CORP NOTE DE FRAIS");
  const other = await line(euros, "2026-10-16", 2500, "VIR SOMEONE ELSE");

  await run(attachSubject(owner, trip, [train.entryId, hotel.entryId]));

  // Offered, the payer's words first, never attached unasked.
  const before = await run(showSubject(owner, trip, "EUR", "all"));

  expect(before.payback?.state).toBe("to_ask");
  expect(before.payback?.candidates.map((each) => each.lineId).slice(0, 2)).toEqual([
    report.lineId,
    other.lineId,
  ]);
  expect(before.payback?.lines).toEqual([]);

  expect(await pay(trip, [report.lineId])).toEqual({ subjectId: trip, lines: 1, changed: 1 });
  // Attaching it again changes nothing.
  expect((await pay(trip, [report.lineId])).changed).toBe(0);

  const after = await run(showSubject(owner, trip, "EUR", "all"));

  expect(after.payback).toEqual(
    expect.objectContaining({
      from: "Example Corp",
      spent: eur(25_185),
      paidBack: eur(10_000),
      difference: eur(-15_185),
      state: "partly",
    }),
  );
  expect(after.payback?.lines.map((each) => [each.lineId, each.amount])).toEqual([
    [report.lineId, eur(10_000)],
  ]);
  expect(after.payback?.candidates.map((each) => each.lineId)).not.toContain(report.lineId);
  // A subject's own page keeps its spent at full net cost.
  expect(after.total).toEqual(eur(25_185));

  const listed = (await run(listSubjects(owner, "EUR"))).subjects.find((each) => each.id === trip);

  expect(listed?.payback?.state).toBe("partly");

  // The line is classified by its subject: no entry, no category, nothing to review.
  const shown = await run(showLine(owner, report.lineId));

  expect(shown.payback).toEqual({ id: trip, name: "Lyon trip" });
  expect(shown.category).toBeNull();
  expect((await run(lineExpensesOf(owner, report.lineId))).expenses).toEqual([]);

  const toReview = await run(searchLines(owner, { toReview: true, from: "2026-10-01" }));

  expect(toReview.lines.map((each) => each.id)).not.toContain(report.lineId);

  // Each month counts its own expense at the share left: 151.85 of 251.85 is the user's.
  const september = await run(monthSummary(owner, "2026-09", "EUR"));
  const october = await run(monthSummary(owner, "2026-10", "EUR"));

  expect(september.spent).toEqual(eur(7235));
  expect(october.spent).toEqual(eur(7950));
  // What came back is no income; the other line coming in is.
  expect(october.received).toEqual(eur(2500));

  const benchmarks = await run(monthBenchmarks(owner, "2026-10", "EUR"));

  expect(benchmarks.categories.reduce((sum, each) => sum + each.spent.minor, 0)).toBe(7950);

  expect((await run(monthMovements(owner, "2026-10", "EUR"))).movements).toContainEqual({
    kind: "payback",
    day: "2026-10-15",
    from: "Example Corp",
    to: "Everyday account",
    note: "Lyon trip",
    amount: eur(10_000),
    subject: { id: trip, name: "Lyon trip" },
  });

  // Detached, it is an income of its own again, and the trip's expenses count in full.
  expect((await pay(trip, [report.lineId], true)).changed).toBe(1);

  const [income] = (await run(lineExpensesOf(owner, report.lineId))).expenses;

  expect(income?.kind).toBe("income");
  expect(income?.classifiedBy).toBe("default");
  expect((await run(monthSummary(owner, "2026-10", "EUR"))).spent).toEqual(eur(13_185));
});

test("a payback line is refused what it cannot be, and refuses what would touch it", async () => {
  const holiday = await newSubject({ name: "Shared holiday", paybackFrom: "Sam Example" });
  const insurer = await newSubject({ name: "Water damage", paybackFrom: "Example Insurance" });
  const plain = await newSubject({ name: "Bicycle" });
  const cabin = await line(euros, "2026-06-03", -40_000, "CB LAKE CABIN 0306");
  const share = await line(euros, "2026-06-20", 20_000, "VIR SAM EXAMPLE CABIN");
  const foreign = await line(dollars, "2026-06-21", 5000, "WIRE SAM EXAMPLE");

  await run(attachSubject(owner, holiday, [cabin.entryId]));

  // What cannot pay back: money going out, another currency, a subject without the option.
  expect(await refusalOf(attachPayback(owner, holiday, [cabin.lineId], "EUR"))).toEqual(
    new PaybackRefused({ reason: "going_out", lineId: cabin.lineId }),
  );
  expect(await refusalOf(attachPayback(owner, holiday, [foreign.lineId], "EUR"))).toEqual(
    new PaybackRefused({ reason: "currency", lineId: foreign.lineId }),
  );
  expect(await refusalOf(attachPayback(owner, plain, [share.lineId], "EUR"))).toEqual(
    new PaybackRefused({ reason: "not_paid_back", subjectId: plain }),
  );
  expect(
    await refusalOf(
      attachPayback(
        owner,
        holiday,
        Array.from({ length: 101 }, () => crypto.randomUUID()),
        "EUR",
      ),
    ),
  ).toEqual(new PaybackRefused({ reason: "lines", subjectId: holiday }));

  await pay(holiday, [share.lineId]);

  // A line pays back one subject at most.
  expect(await refusalOf(attachPayback(owner, insurer, [share.lineId], "EUR"))).toEqual(
    new PaybackRefused({ reason: "other_subject", lineId: share.lineId, subjectId: holiday }),
  );

  // Linking, splitting and turning the option off leave it alone.
  expect(await refusalOf(linkLine(owner, share.lineId, cabin.lineId))).toEqual(
    new LinkRefused({ reason: "payback", lineId: share.lineId }),
  );
  expect(
    await refusalOf(
      splitLine(owner, share.lineId, [
        { categoryId: crypto.randomUUID(), amount: "100" },
        { categoryId: crypto.randomUUID(), amount: "100" },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "payback" }));
  expect(await refusalOf(editSubject(owner, holiday, { paybackFrom: null }))).toEqual(
    new SubjectRefused({ reason: "payback_lines", subjectId: holiday }),
  );

  // The pairing on demand never makes it a transfer's side, whatever line matches it.
  const moved = await line(savings, "2026-06-20", -20_000, "VIR TO EVERYDAY");

  await run(pairEveryLine(owner));
  expect((await run(lineTransferOf(owner, moved.lineId))).paired).toBeNull();
  expect((await run(showLine(owner, share.lineId))).payback?.name).toBe("Shared holiday");

  // An archived subject gets no line; a line may still be taken off it.
  await run(editSubject(owner, insurer, { archived: true }));

  const claim = await line(euros, "2026-06-25", 9000, "VIR EXAMPLE INSURANCE CLAIM");

  expect(await refusalOf(attachPayback(owner, insurer, [claim.lineId], "EUR"))).toEqual(
    new PaybackRefused({ reason: "archived", subjectId: insurer }),
  );
});

test("the option is set and checked on a subject, and what the user waits for comes in order", async () => {
  expect(await refusalOf(createSubject(owner, { name: "Blank payer", paybackFrom: " " }))).toEqual(
    new SubjectRefused({ reason: "payback" }),
  );
  expect(
    await refusalOf(createSubject(owner, { name: "No payer", paybackAskedOn: "2026-05-02" })),
  ).toEqual(new SubjectRefused({ reason: "payback" }));

  const asked = await newSubject({
    name: "Conference",
    paybackFrom: "Example Corp",
    paybackAskedOn: "2026-05-10",
  });

  const askedFirst = await newSubject({
    name: "Client visit",
    paybackFrom: "Example Corp",
    paybackAskedOn: "2026-05-04",
  });

  const toAsk = await newSubject({ name: "Gift pool", paybackFrom: "Friends" });
  const settled = await newSubject({ name: "Old trip", paybackFrom: "Example Corp" });

  await run(editSubject(owner, settled, { paybackSettledOn: "2026-05-20" }));

  const flight = await line(euros, "2026-05-02", -30_000, "CB AIRLINE 0205");
  const taxi = await line(euros, "2026-05-03", -4000, "CB TAXI 0305");

  await run(attachSubject(owner, asked, [flight.entryId]));
  await run(attachSubject(owner, askedFirst, [taxi.entryId]));

  const waiting = (await run(paybacksWaiting(owner, "EUR"))).filter((each) =>
    [asked, askedFirst, toAsk, settled].includes(each.subjectId),
  );

  // Those to ask first, then those asked by their day; settled by hand, none.
  expect(waiting.map((each) => [each.name, each.state, each.waiting])).toEqual([
    ["Gift pool", "to_ask", eur(0)],
    ["Client visit", "asked", eur(4000)],
    ["Conference", "asked", eur(30_000)],
  ]);

  // Turning the option off clears both days.
  const saved = await run(editSubject(owner, asked, { paybackFrom: null }));

  expect(saved.payback).toBeNull();
});
