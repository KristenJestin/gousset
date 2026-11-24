import type { Page } from "@playwright/test";
import {
  DatabaseCategoryStore,
  FundRefused,
  NotFunding,
  SplitRefused,
  Today,
  classifyLine,
  createCategory,
  expensesLayer,
  fundExpense,
  lineExpensesOf,
  lineTransferOf,
  linkLine,
  listCategories,
  pairLines,
  splitLine,
  transfersLayer,
  unfundExpense,
  unpairLine,
} from "@gousset/core";
import type { CategoryNode, CategoryStore, Expenses, Transfers } from "@gousset/core";
import { account, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { asc, eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import type { TestUser } from "../src/auth";
import { onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import {
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #29, "How to verify": a refund from a works council account to a bank account is a
// transfer that funds the expense it covers; the link shows on both sides, and the month's spending
// does not count the refund as income. And what keeps it honest around them: what may fund what,
// unfunding, unpairing, a funded line joining another expense, a split waiting. Each test has a user
// of its own, so that its expenses are the only ones offered. The bank's lines are imported as the
// import job runs them; the works council account's are entered by hand, as an account without a
// file is kept, then paired by hand. Every name, label and amount is invented: PerksHub refunds 80
// of a sports club's 120.

const TODAY = "2026-11-30";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

type Services = Expenses | Transfers | CategoryStore;

/** Runs the expenses', the transfers' and the categories' logic, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(expensesLayer, transfersLayer, DatabaseCategoryStore).pipe(
          Layer.provide(data.layer),
        ),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** The refusal an effect fails with. */
const refusalOf = <A, E>(effect: Effect.Effect<A, E, Services>) => run(Effect.flip(effect));

/** A user of the test's own, with no account yet: their id, and their session's cookies. */
async function ownUser(app: { readonly baseURL: string }, user: TestUser, local: string) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));

  return { owner: await data.ownerOf(person.email), cookies: person.cookies };
}

async function newAccount(
  owner: string,
  name: string,
  kind: "current" | "benefit",
): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({
        userId: owner,
        name,
        kind,
        institution: kind === "benefit" ? "PerksHub" : "Riverside Bank",
        currency: "EUR",
      })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** Imports these lines into the account, each with a reference of its own, to the end. */
async function importInto(
  owner: string,
  accountId: string,
  name: string,
  lines: ReadonlyArray<Omit<StatementLine, "reference">>,
) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${name}.ofx`),
  );

  expect(done.status, name).toBe("done");
}

/** A line entered by hand on the account: its id. */
async function enterLine(
  owner: string,
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  label: string,
): Promise<string> {
  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(statementLine)
      .values({ userId: owner, accountId, source: "manual", bookedOn, amountMinor, label })
      .returning({ id: statementLine.id }),
  );

  if (made === undefined) {
    throw new Error("The line was not entered.");
  }

  return made.id;
}

/** The account's line of this amount. */
async function lineOf(owner: string, accountId: string, amountMinor: number): Promise<string> {
  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );

  const found = lines.find((line) => line.amountMinor === amountMinor);

  if (found === undefined) {
    throw new Error(`No line of ${String(amountMinor)} on the account.`);
  }

  return found.id;
}

const SPORTS_CLUB = "CB RIVERSIDE SPORTS CLUB 0210";
const REFUND = "PERKSHUB REFUND 0042";

/** A refund the works council account sends to the bank: its two sides, paired by hand. */
type Refund = { readonly out: string; readonly into: string };

/** The day of the refund at `index`: from 19 October, three days apart. */
const refundDay = (index: number) => `2026-10-${String(19 + 3 * index).padStart(2, "0")}`;

/**
 * The user's bank account, its expenses (the sports club's fee of 120 on 2 October, books of 90 on
 * 15 September, a coffee of 20, a dinner of 150 after the refunds) and incomes as given; and the
 * works council's account, PerksHub, refunding to the bank each amount of `refunds`, from 19 October
 * on, each a transfer paired by hand. The bank's lines come first, so that no import pairs them.
 */
async function worksCouncil(
  owner: string,
  refunds: ReadonlyArray<number> = [8000],
  more: ReadonlyArray<Omit<StatementLine, "reference">> = [],
) {
  const bank = await newAccount(owner, "Everyday account", "current");
  const perksHub = await newAccount(owner, "PerksHub", "benefit");

  await importInto(owner, bank, "works-council-bank", [
    { bookedOn: "2026-09-15", amountMinor: -9000, label: "CB HARBOR BOOKS 1509" },
    { bookedOn: "2026-10-02", amountMinor: -12_000, label: SPORTS_CLUB },
    { bookedOn: "2026-10-05", amountMinor: -2000, label: "CB CORNER CAFE 0510" },
    { bookedOn: "2026-11-10", amountMinor: -15_000, label: "CB LANTERN DINER 1011" },
    ...refunds.map((amountMinor, index) => ({
      bookedOn: refundDay(index),
      amountMinor,
      label: `VIR PERKSHUB REMBOURSEMENT ${String(index + 1)}`,
    })),
    ...more,
  ]);

  const paired: Array<Refund> = [];

  for (const [index, amountMinor] of refunds.entries()) {
    const out = await enterLine(
      owner,
      perksHub,
      refundDay(index),
      -amountMinor,
      index === 0 ? REFUND : `PERKSHUB REFUND 00${String(43 + index)}`,
    );

    const into = await lineOf(owner, bank, amountMinor);

    await run(pairLines(owner, out, into));
    paired.push({ out, into });
  }

  return {
    bank,
    perksHub,
    refunds: paired,
    sportsClub: await lineOf(owner, bank, -12_000),
    books: await lineOf(owner, bank, -9000),
    coffee: await lineOf(owner, bank, -2000),
    dinner: await lineOf(owner, bank, -15_000),
  };
}

/** The line's one expense. */
async function expenseOf(owner: string, lineId: string) {
  const [only, ...others] = (await run(lineExpensesOf(owner, lineId))).expenses;

  expect(others).toHaveLength(0);

  if (only === undefined) {
    throw new Error("The line is part of no expense.");
  }

  return only;
}

/** Every entry part of these lines. */
const partsOf = (owner: string, lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({ lineId: entryPart.lineId, role: entryPart.role })
      .from(entryPart)
      .where(inArray(entryPart.lineId, [...lineIds])),
  );

/** How many incomes the user has. */
const incomesOf = async (owner: string) =>
  (
    await data.asUser(owner, (transaction) =>
      transaction.select({ id: entry.id }).from(entry).where(eq(entry.kind, "income")),
    )
  ).length;

/** A category as the categories page lists it, with its entries and its six-month average. */
async function categoryNamed(owner: string, name: string): Promise<CategoryNode> {
  const tree = await run(listCategories(owner));
  const found = [...tree.expense, ...tree.income].find((node) => node.name === name);

  if (found === undefined) {
    throw new Error(`No category named ${name}.`);
  }

  return found;
}

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

/** Opens the line of this label from the operations page: its detail. */
async function openLine(page: Page, label: string) {
  await rows(page).filter({ hasText: label }).first().getByRole("button").click();

  const detail = page.getByRole("region", { name: label });

  await expect(detail).toBeVisible();

  return detail;
}

test("the link shows on both sides", async ({ page, app, user }) => {
  test.setTimeout(90_000);

  const { owner, cookies } = await ownUser(app, user, "lou.works-council");
  const made = await worksCouncil(owner);

  await page.context().addCookies([...cookies]);
  await fixDay(page, TODAY);
  await visit(page, "/operations");
  await hydrated(page);

  // The refund's side out, on PerksHub: no expense funded yet, never one unasked.
  const side = await openLine(page, REFUND);
  const block = side.getByRole("region", { name: "Funds an expense" });

  await expect(block).toContainText("which keeps its cost");
  await block.getByRole("button", { name: "Fund an expense" }).click();

  // The expenses it may fund, the nearest first: the sports club, then the books; not the coffee,
  // which costs less than the refund, nor the dinner, after it.
  const dialog = page.getByRole("dialog", { name: "Fund an expense" });

  // The shared dialog's motion: it fades and grows in 200 ms; on a phone it rises in 300 ms.
  await expect(dialog).toHaveCSS("transition-duration", onPhone(page) ? "0.3s" : "0.2s");
  await expect(dialog).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("radio").first()).toBeChecked();
  await expect(dialog.locator("label").first()).toContainText(SPORTS_CLUB);
  await expect(dialog.locator("label").first()).toContainText("€120.00");
  await expect(dialog).not.toContainText("CB CORNER CAFE");
  await expect(dialog).not.toContainText("CB LANTERN DINER");
  await animationsDone(page);
  await expectAccessible(page);

  await dialog.getByRole("button", { name: "Fund", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // This side: the expense it funds, which keeps its cost.
  const funded = block.locator('[data-slot="funded-expense"]');

  await expect(funded).toContainText(SPORTS_CLUB);
  await expect(funded).toContainText("€120.00");
  await expect(block.getByRole("button", { name: "Unfund" })).toBeVisible();

  // The other side: the expense's detail, funded by the refund, at its whole cost.
  await funded.click();

  const expense = page.getByRole("region", { name: SPORTS_CLUB });
  const fundedBy = expense.getByRole("region", { name: "Funded by" });

  await expect(fundedBy).toBeVisible();
  await expect(fundedBy.locator('[data-slot="funding"]')).toHaveCount(1);
  await expect(fundedBy).toContainText(REFUND);
  await expect(fundedBy).toContainText("PerksHub");
  await expect(fundedBy.locator('[data-slot="funded-total"]')).toContainText("€80.00");
  await expect(fundedBy.locator('[data-slot="funded-cost"]')).toHaveText(
    "It keeps its cost of €120.00.",
  );

  // Back to the refund from its funding, and unfunded there: the transfer stays.
  await fundedBy.getByRole("button", { name: new RegExp(REFUND) }).click();

  const again = page.getByRole("region", { name: REFUND });
  const block2 = again.getByRole("region", { name: "Funds an expense" });

  await block2.getByRole("button", { name: "Unfund" }).click();
  await expect(block2.getByRole("button", { name: "Fund an expense" })).toBeVisible();
  await expect(again.locator('[data-slot="line-transfer"]')).toContainText("Everyday account");

  // Under reduced motion, the dialog appears at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await block2.getByRole("button", { name: "Fund an expense" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0s");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // The logic agrees: the expense is funded by nothing, and still costs 120.
  const left = await expenseOf(owner, made.sportsClub);

  expect(left.fundings).toEqual([]);
  expect(left.net).toEqual({ minor: 12_000, currency: "EUR" });
});

test("the month's spending does not count the refund as income", async ({ app, user }) => {
  const { owner } = await ownUser(app, user, "noa.works-council-month");
  const made = await worksCouncil(owner);
  const [refund] = made.refunds;

  if (refund === undefined) {
    throw new Error("No refund was made.");
  }

  const sport = (await run(createCategory(owner, { kind: "expense", name: "Sport refunded" }))).id;

  await run(classifyLine(owner, made.sportsClub, { categoryId: sport }));

  // Paired, the refund is a transfer: never an income, before it funds anything and after.
  expect(await incomesOf(owner)).toBe(0);

  // Funded from the refund's side in, on the bank: either side names the transfer.
  const funded = await run(fundExpense(owner, refund.into, made.sportsClub));

  expect(funded.net).toEqual({ minor: 12_000, currency: "EUR" });
  expect(funded.funded).toEqual({ minor: 8000, currency: "EUR" });
  expect(funded.fundings.map((each) => [each.account.name, each.amount.minor])).toEqual([
    ["PerksHub", 8000],
  ]);

  // Where the money goes counts the expense once, at its whole cost: 120, not 40.
  const counted = await categoryNamed(owner, "Sport refunded");

  expect(counted.entries).toBe(1);
  expect(counted.average).toEqual([{ currency: "EUR", minor: Math.round(12_000 / 6) }]);

  // And the refund as no income: its two sides are the transfer, an entry of neither.
  expect(await partsOf(owner, [refund.out, refund.into])).toEqual([]);
  expect(await incomesOf(owner)).toBe(0);
  expect((await run(lineTransferOf(owner, refund.into))).paired?.other.id).toBe(refund.out);
});

test("a works council refund funds an expense it does not pass, and nothing else", async ({
  app,
  user,
}) => {
  const { owner } = await ownUser(app, user, "kai.works-council-rules");

  const made = await worksCouncil(
    owner,
    [8000, 5000, 4000],
    [{ bookedOn: "2026-10-01", amountMinor: 250_000, label: "SALARY EXAMPLE CORP" }],
  );

  const [first, second, third] = made.refunds;

  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("The refunds were not made.");
  }

  // Never funded unasked: pairing funded nothing; the side is offered what it may fund.
  const offered = (await run(lineExpensesOf(owner, first.out))).funding;

  expect(offered?.funds).toBeNull();
  expect(offered?.candidates.map((each) => each.line.lineId)).toEqual([
    made.sportsClub,
    made.books,
  ]);

  await run(fundExpense(owner, first.out, made.sportsClub));

  // Funding it again changes nothing.
  expect((await run(fundExpense(owner, first.out, made.sportsClub))).funded.minor).toBe(8000);

  // 80 + 50 would pass the 120 it costs; 80 + 40 does not.
  expect(await refusalOf(fundExpense(owner, second.out, made.sportsClub))).toEqual(
    new FundRefused({ reason: "over_cost", lineId: made.sportsClub }),
  );
  expect((await run(fundExpense(owner, third.out, made.sportsClub))).funded.minor).toBe(12_000);

  // A transfer funds one expense: another is refused until it is unfunded.
  expect(await refusalOf(fundExpense(owner, first.out, made.books))).toEqual(
    new FundRefused({ reason: "already_funding", lineId: first.out }),
  );

  // An expense after the refund, an income, a line that is no transfer's side.
  expect(await refusalOf(fundExpense(owner, second.out, made.dinner))).toEqual(
    new FundRefused({ reason: "later", lineId: made.dinner }),
  );

  const salary = await lineOf(owner, made.bank, 250_000);

  expect(await refusalOf(fundExpense(owner, second.out, salary))).toEqual(
    new FundRefused({ reason: "not_an_expense", lineId: salary }),
  );
  expect(await refusalOf(fundExpense(owner, made.books, made.sportsClub))).toEqual(
    new FundRefused({ reason: "not_a_transfer", lineId: made.books }),
  );

  // A transfer between two bank accounts is no works council refund.
  const savings = await newAccount(owner, "Second current", "current");
  const out = await enterLine(owner, made.bank, "2026-10-21", -7000, "VIR TO SECOND CURRENT");
  const into = await enterLine(owner, savings, "2026-10-21", 7000, "VIR FROM EVERYDAY");

  await run(pairLines(owner, out, into));

  expect(await refusalOf(fundExpense(owner, out, made.books))).toEqual(
    new FundRefused({ reason: "not_from_benefit", lineId: out }),
  );
  expect((await run(lineExpensesOf(owner, out))).funding).toBeNull();
});

test("unfunding keeps the transfer, and unpairing takes its funding with it", async ({
  app,
  user,
}) => {
  const { owner } = await ownUser(app, user, "ari.works-council-undo");
  const made = await worksCouncil(owner);
  const [refund] = made.refunds;

  if (refund === undefined) {
    throw new Error("No refund was made.");
  }

  await run(fundExpense(owner, refund.out, made.sportsClub));

  const unfunded = await run(unfundExpense(owner, refund.out));

  expect(unfunded.funding?.funds).toBeNull();
  expect((await expenseOf(owner, made.sportsClub)).fundings).toEqual([]);
  expect((await run(lineTransferOf(owner, refund.out))).paired?.other.id).toBe(refund.into);
  expect(await refusalOf(unfundExpense(owner, refund.out))).toEqual(
    new NotFunding({ lineId: refund.out }),
  );

  // Funded again, then unpaired: the transfer is gone, and its funding with it.
  await run(fundExpense(owner, refund.into, made.sportsClub));
  await run(unpairLine(owner, refund.out));

  const left = await expenseOf(owner, made.sportsClub);

  expect(left.fundings).toEqual([]);
  expect(left.net).toEqual({ minor: 12_000, currency: "EUR" });
});

test("a funded expense's line takes its funding into the expense it joins, and splits once unfunded", async ({
  app,
  user,
}) => {
  const { owner } = await ownUser(app, user, "sam.works-council-link");
  const made = await worksCouncil(owner);
  const [refund] = made.refunds;

  if (refund === undefined) {
    throw new Error("No refund was made.");
  }

  await run(fundExpense(owner, refund.out, made.sportsClub));

  // Which share the refund would fund, the user says by unfunding first.
  const other = (await run(createCategory(owner, { kind: "expense", name: "Split sport" }))).id;
  const kept = (await expenseOf(owner, made.sportsClub)).category.id;

  expect(
    await refusalOf(
      splitLine(owner, made.sportsClub, [
        { categoryId: kept, amount: "60" },
        { categoryId: other, amount: "60" },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "funded" }));

  // The sports club's line joins the books' expense: the refund funds that expense now.
  const linked = await run(linkLine(owner, made.sportsClub, made.books));

  expect(linked.expense.net).toEqual({ minor: 21_000, currency: "EUR" });
  expect(linked.expense.fundings.map((each) => each.outLineId)).toEqual([refund.out]);
  expect((await run(lineExpensesOf(owner, refund.out))).funding?.funds?.id).toBe(linked.expense.id);
});
