import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import {
  DatabaseLineStore,
  Today,
  lineTransferOf,
  pairEveryLine,
  pairLines,
  searchLines,
  transfersLayer,
  unpairLine,
} from "@gousset/core";
import type { LineStore, Transfers } from "@gousset/core";
import { account, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { asc, eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #26, "How to verify": a clear pair is paired, two candidates go to review, a deferred
// card's monthly debit pairs with the card account, and undoing an import unpairs; then the MCP
// door's `lines` pairs and unpairs. Statements are imported as the import job runs them, through
// `@gousset/core`, on the worker's database, into accounts of a user of this file's own. Each test
// moves amounts no other test moves, so that its lines are no other test's candidates. Every
// amount and label is invented.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Noa Example",
    email: `noa.transfers.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

/** Every line of these tests is booked before this day, which the logic reads as today. */
const TODAY = "2026-11-30";

/** Runs the transfers' and the lines' logic on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Transfers | LineStore>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(transfersLayer, DatabaseLineStore).pipe(Layer.provide(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

const transferOf = (lineId: string) => run(lineTransferOf(owner, lineId));

/** The lines the operations page and `lines` list to review. */
const toReview = async () =>
  (await run(searchLines(owner, { toReview: true, limit: 500 }))).lines.map((line) => line.id);

/** Whether the monthly review still lists each line. */
const reviewOf = (lineIds: ReadonlyArray<string>) =>
  Promise.all(
    lineIds.map(async (lineId) => {
      const [row] = await data.asUser(owner, (transaction) =>
        transaction
          .select({ reviewState: statementLine.reviewState })
          .from(statementLine)
          .where(eq(statementLine.id, lineId)),
      );

      return row?.reviewState;
    }),
  );

/** How each line is classified: its entries' `classified_by`, none for a side of a transfer. */
const entriesOf = (lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, async (transaction) => {
    const parts = await transaction
      .select({ lineId: entryPart.lineId, classifiedBy: entry.classifiedBy })
      .from(entryPart)
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .where(inArray(entryPart.lineId, [...lineIds]));

    return lineIds.map((lineId) =>
      parts.flatMap((part) => (part.lineId === lineId ? [part.classifiedBy] : [])),
    );
  });

/** A new account of the user's, of this kind; a card settles into `settlesInto`. */
async function newAccount(
  name: string,
  kind: "current" | "savings" | "card",
  settlesInto: string | null = null,
): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, currency: "EUR", settlesIntoAccountId: settlesInto })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** A statement of these lines alone, each with a reference of its own. */
function statementOf(name: string, lines: ReadonlyArray<Omit<StatementLine, "reference">>) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  return statementFile("ofx", statement, `${name}.ofx`);
}

/** Imports the statement into the account, to the end. */
async function importInto(
  accountId: string,
  name: string,
  lines: Parameters<typeof statementOf>[1],
) {
  const done = await imports.importFile(owner, accountId, statementOf(name, lines));

  expect(done.status, name).toBe("done");

  return done;
}

/** The account's lines, oldest first, with what made them. */
const linesOf = (accountId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({
        id: statementLine.id,
        amountMinor: statementLine.amountMinor,
        source: statementLine.source,
      })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );

/** The account's line of this amount. */
async function lineOf(accountId: string, amountMinor: number): Promise<string> {
  const found = (await linesOf(accountId)).find((line) => line.amountMinor === amountMinor);

  if (found === undefined) {
    throw new Error(`No line of ${String(amountMinor)} on the account.`);
  }

  return found.id;
}

test("a clear pair is paired", async () => {
  const current = await newAccount("Pair current", "current");
  const savings = await newAccount("Pair savings", "savings");

  await importInto(current, "pair-current", [
    { bookedOn: "2026-10-10", amountMinor: -25_000, label: "SEPA TRF TO MY SAVINGS" },
  ]);

  await importInto(savings, "pair-savings", [
    { bookedOn: "2026-10-11", amountMinor: 25_000, label: "SEPA TRF FROM MY CURRENT" },
  ]);

  const out = await lineOf(current, -25_000);
  const into = await lineOf(savings, 25_000);
  const transfer = await transferOf(out);

  expect(transfer.paired).toMatchObject({
    direction: "out",
    other: { id: into, madeByApp: false, account: { id: savings } },
    // Money moved to a savings account: the month sets it aside.
    setAside: true,
    pairedBy: "import",
  });

  // One click goes from one side to the other: each side names the other.
  expect((await transferOf(into)).paired).toMatchObject({ direction: "in", other: { id: out } });
});

test("an import that pairs a transfer leaves its two lines without entries", async () => {
  const current = await newAccount("Entries current", "current");
  const savings = await newAccount("Entries savings", "savings");

  await importInto(current, "entries-current", [
    { bookedOn: "2026-10-08", amountMinor: -13_370, label: "SEPA TRF TO MY SAVINGS" },
  ]);

  const out = await lineOf(current, -13_370);

  // Alone, the line is an expense, in its kind's fallback, until its other side comes.
  expect(await entriesOf([out])).toEqual([["default"]]);

  await importInto(savings, "entries-savings", [
    { bookedOn: "2026-10-09", amountMinor: 13_370, label: "SEPA TRF FROM MY CURRENT" },
  ]);

  const into = await lineOf(savings, 13_370);

  // Paired, both lines are the transfer: neither an expense nor an income.
  expect((await transferOf(out)).paired).toMatchObject({ other: { id: into } });
  expect(await entriesOf([out, into])).toEqual([[], []]);

  // "Not a transfer": each line is an expense or an income again, to classify.
  await run(unpairLine(owner, out));

  expect(await entriesOf([out, into])).toEqual([["default"], ["default"]]);
  expect(await toReview()).toEqual(expect.arrayContaining([out, into]));

  // Paired by hand, their entries go again.
  await run(pairLines(owner, out, into));

  expect(await entriesOf([out, into])).toEqual([[], []]);
});

test("two candidates go to review", async () => {
  const current = await newAccount("Review current", "current");
  const first = await newAccount("Review savings one", "savings");
  const second = await newAccount("Review savings two", "savings");

  // Both lines in first: the line out, imported last, finds two candidates at once.
  await importInto(first, "review-one", [
    { bookedOn: "2026-10-16", amountMinor: 5000, label: "SEPA TRF RECEIVED" },
  ]);

  await importInto(second, "review-two", [
    { bookedOn: "2026-10-14", amountMinor: 5000, label: "SEPA TRF RECEIVED" },
  ]);

  await importInto(current, "review-current", [
    { bookedOn: "2026-10-15", amountMinor: -5000, label: "SEPA TRF TO SAVINGS" },
  ]);

  const out = await lineOf(current, -5000);
  const waiting = await transferOf(out);

  // Nothing is written: the line waits, its two candidates found again when it is shown.
  expect(waiting.paired).toBeNull();
  expect(waiting.candidates.map((side) => side.account.id).toSorted()).toEqual(
    [first, second].toSorted(),
  );
  expect(await toReview()).toContain(out);

  // The user chooses one: both lines are settled, and leave the lines to review.
  const into = await lineOf(first, 5000);
  const chosen = await run(pairLines(owner, out, into));

  expect(chosen.paired).toMatchObject({ pairedBy: "user", other: { account: { id: first } } });
  expect((await transferOf(await lineOf(second, 5000))).paired).toBeNull();
  expect(await reviewOf([out, into])).toEqual(["done", "done"]);
  expect(await toReview()).not.toContain(out);
});

test("a deferred card's monthly debit pairs with the card account", async () => {
  const current = await newAccount("Card current", "current");
  const card = await newAccount("Deferred card", "card", current);

  // September's purchases on the card, then October's.
  await importInto(card, "card-purchases", [
    { bookedOn: "2026-09-04", amountMinor: -12_000, label: "CB GREENMARKET" },
    { bookedOn: "2026-09-18", amountMinor: -29_230, label: "CB HILLSIDE PHARMACY" },
    { bookedOn: "2026-10-02", amountMinor: -4500, label: "CB CORNER CAFE" },
    { bookedOn: "2026-10-20", amountMinor: -3000, label: "CB NOODLE BAR" },
  ]);

  // The current account pays what the card owed at the end of each month, both in one file.
  await importInto(current, "card-debits", [
    { bookedOn: "2026-10-05", amountMinor: -41_230, label: "DEFERRED CARD DEBIT" },
    { bookedOn: "2026-11-05", amountMinor: -7500, label: "DEFERRED CARD DEBIT" },
  ]);

  const debit = await lineOf(current, -41_230);

  // October's debit is found once September's is paired: the card owed 75.00 for October alone.
  expect((await transferOf(await lineOf(current, -7500))).paired).toMatchObject({
    other: { madeByApp: true, account: { id: card } },
  });
  const paired = (await transferOf(debit)).paired;

  expect(paired).toMatchObject({
    direction: "out",
    other: { madeByApp: true, account: { id: card } },
    setAside: false,
    pairedBy: "import",
  });

  // The card's statement does not show the debit: the app made its side on the card.
  const made = (await linesOf(card)).filter((line) => line.source === "counterpart");

  expect(made.map((line) => line.amountMinor)).toEqual([41_230, 7500]);

  // A later card file brings the first debit's real line: the transfer moves to it, the made one
  // goes.
  await importInto(card, "card-payment", [
    { bookedOn: "2026-10-06", amountMinor: 41_230, label: "PAYMENT RECEIVED THANK YOU" },
  ]);

  const real = await lineOf(card, 41_230);

  expect(
    (await linesOf(card))
      .filter((line) => line.source === "counterpart")
      .map((line) => line.amountMinor),
  ).toEqual([7500]);
  expect((await transferOf(debit)).paired).toMatchObject({
    other: { id: real, madeByApp: false },
  });

  // Unpaired from the side the app made, that side goes: the card's balance holds its own lines.
  const madeLine = await lineOf(card, 7500);
  const unpaired = await run(unpairLine(owner, madeLine));

  expect(unpaired).toMatchObject({
    madeSideDeleted: true,
    other: { id: await lineOf(current, -7500) },
  });
  expect((await linesOf(card)).filter((line) => line.source === "counterpart")).toEqual([]);
});

test("undoing an import unpairs", async () => {
  const current = await newAccount("Undo current", "current");
  const savings = await newAccount("Undo savings", "savings");
  const card = await newAccount("Undo card", "card", current);

  const debit = await importInto(current, "undo-current", [
    { bookedOn: "2026-10-12", amountMinor: -31_700, label: "SEPA TRF TO MY SAVINGS" },
    { bookedOn: "2026-11-05", amountMinor: -8640, label: "DEFERRED CARD DEBIT" },
  ]);

  const saved = await importInto(savings, "undo-savings", [
    { bookedOn: "2026-10-12", amountMinor: 31_700, label: "SEPA TRF FROM MY CURRENT" },
  ]);

  await importInto(card, "undo-card", [
    { bookedOn: "2026-10-20", amountMinor: -8640, label: "CB FRESH BASKET" },
  ]);

  const out = await lineOf(current, -31_700);
  const cardDebit = await lineOf(current, -8640);

  expect((await transferOf(out)).paired).not.toBeNull();
  expect((await transferOf(cardDebit)).paired).toMatchObject({ other: { madeByApp: true } });

  // Paired again by the user, the two lines are settled.
  await run(unpairLine(owner, out));
  await run(pairLines(owner, out, await lineOf(savings, 31_700)));

  expect(await reviewOf([out])).toEqual(["done"]);

  // The savings import undone, its line's transfer goes with it: the other side is no transfer,
  // and goes back to the review.
  const undone = await imports.undo(owner, saved.id);

  expect(undone.transfersRemoved).toBe(1);
  expect((await transferOf(out)).paired).toBeNull();
  expect(await reviewOf([out])).toEqual(["to_review"]);
  // An expense again, until the user says what it is.
  expect(await entriesOf([out])).toEqual([["default"]]);

  // The current account's import undone, the side the app made on the card goes too.
  expect((await imports.undo(owner, debit.id)).transfersRemoved).toBe(1);
  expect((await linesOf(card)).map((line) => line.source)).toEqual(["import"]);
});

test("a line the user says is no transfer is not paired again by itself", async () => {
  const current = await newAccount("Refused current", "current");
  const savings = await newAccount("Refused savings", "savings");
  const card = await newAccount("Refused card", "card", current);

  await importInto(card, "refused-card", [
    { bookedOn: "2026-09-15", amountMinor: -6420, label: "CB LITTLE BISTRO" },
  ]);

  await importInto(current, "refused-current", [
    { bookedOn: "2026-09-20", amountMinor: -2222, label: "SEPA TRF TO A FRIEND" },
    { bookedOn: "2026-10-05", amountMinor: -6420, label: "DEFERRED CARD DEBIT" },
  ]);

  await importInto(savings, "refused-savings", [
    { bookedOn: "2026-09-21", amountMinor: 2222, label: "SEPA TRF RECEIVED" },
  ]);

  const out = await lineOf(current, -2222);
  const into = await lineOf(savings, 2222);
  const debit = await lineOf(current, -6420);

  expect((await transferOf(out)).paired).not.toBeNull();
  expect((await transferOf(debit)).paired).not.toBeNull();

  // "Not a transfer", twice: both lines go back to the review, the card's made side goes.
  await run(unpairLine(owner, out));
  await run(unpairLine(owner, debit));

  expect(await reviewOf([out, into])).toEqual(["to_review", "to_review"]);

  // Neither the pairing on demand nor the card's next statement pairs them again.
  await run(pairEveryLine(owner));

  // Its period reaches the debit, which the card still owed: only the user's word keeps it apart.
  await importInto(card, "refused-card-october", [
    { bookedOn: "2026-10-01", amountMinor: -1500, label: "CB CORNER CAFE" },
  ]);

  expect((await transferOf(out)).paired).toBeNull();
  expect((await transferOf(debit)).paired).toBeNull();
  expect((await linesOf(card)).filter((line) => line.source === "counterpart")).toEqual([]);

  // The user may still pair them by hand: the old other side is still offered.
  expect((await transferOf(out)).candidates.map((side) => side.id)).toEqual([into]);
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of the tool's answer, and whether it is an error. */
async function callLines(client: Client, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** The first handle a search result gives. */
const firstHandle = (text: string) => /; line: (\S+)$/m.exec(text)?.[1] ?? "";

test("an MCP client shows a transfer, unpairs it, pairs it again and pairs every clear one", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(90_000);

  // A user of the test's own, holding the made-up data, whose transfers the seed paired.
  const person = await addUser(app.baseURL, user, {
    name: "Ari Example",
    email: `ari.transfers.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-ari-password-${app.slot}`,
  });

  await data.seed(await data.ownerOf(person.email));
  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const found = await callLines(session.client, {
    action: "search",
    text: "sepa trf to livret a",
    account: "Current account",
  });

  const line = firstHandle(found.text);

  expect(line, found.text).not.toBe("");

  const shown = await callLines(session.client, { action: "show", line });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain(
    "Transfer to Livret A (Riverside Bank), paired by Gousset: never counted as spending. Set aside: money moved to savings or investments.",
  );
  // A transfer is no expense: it has no category.
  expect(shown.text).not.toContain("Category:");

  const unpaired = await callLines(session.client, { action: "unpair", line });

  expect(unpaired.isError, unpaired.text).toBe(false);
  expect(unpaired.text).toMatch(
    /^No longer a transfer: the line and the line of \d{4}-\d\d-\d\d, Livret A/,
  );
  const separate = await callLines(session.client, { action: "show", line });

  expect(separate.text).not.toContain("Transfer to");
  // An expense again, in its kind's fallback, until the user classifies it.
  expect(separate.text).toContain("Category: Other (expense)");

  // Its only candidate is the Livret A's line it was paired with.
  const paired = await callLines(session.client, { action: "pair", line });

  expect(paired.isError, paired.text).toBe(false);
  expect(paired.text).toContain("Transfer to Livret A (Riverside Bank), paired by the user");
  expect((await callLines(session.client, { action: "show", line })).text).not.toContain(
    "Category:",
  );

  const again = await callLines(session.client, { action: "pair", line });

  expect(again.isError).toBe(true);
  expect(again.text).toContain("is already a side of a transfer");

  // Unpaired once more, the user's "no transfer" holds: the pairing on demand leaves it alone.
  await callLines(session.client, { action: "unpair", line });

  const everyOne = await callLines(session.client, { action: "pair" });

  expect(everyOne.isError, everyOne.text).toBe(false);
  expect(everyOne.text).toMatch(/^Paired every clear transfer: \d+ between two lines/);
  expect((await callLines(session.client, { action: "show", line })).text).not.toContain(
    "Transfer to",
  );
});
