import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { accountBalance, statementImport } from "@gousset/db/schema/ledger";
import { eq } from "drizzle-orm";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #20, "How to verify": reimporting adds no duplicate, the second coffee of a day stays, a
// near duplicate is held for review, undoing removes exactly the import's lines, and a job run
// again doubles nothing. Each test imports into an account of its own, on the worker's database,
// through `@gousset/core` as the import job runs it (docs/data-model.md, "Imports and
// deduplication"). The accounts belong to a user of this file's own: the worker's users stay
// without accounts, which other specs seed as they need.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const importer = await addUser(app.baseURL, user, {
    name: "Sam Example",
    email: `sam.dedup.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-sam-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(importer.email);
});

test.afterAll(async () => {
  await data.close();
});

const { lines } = exampleStatement;

/** The example statement with these lines only. */
const withLines = (kept: ReadonlyArray<StatementLine>): Statement => ({
  ...exampleStatement,
  lines: kept,
});

// A CSV file's days must tell the day from the month (one after the 12th), or its import waits
// for the user to say which comes first: the last test shows it.
const coffee: StatementLine = {
  bookedOn: "2026-10-17",
  amountMinor: -250,
  label: "CB CAFE DU PORT 16/10",
  reference: "COFFEE",
};

/** A line as every format keeps it: some cut a long label (OFX's `NAME`, 32 characters). */
const dayAndAmount = (line: { bookedOn: string; amountMinor: number }) =>
  `${line.bookedOn} ${String(line.amountMinor)}`;

test("the same file twice adds nothing", async () => {
  for (const format of ["ofx", "csv"] as const) {
    const accountId = await imports.createAccount(owner, `Twice ${format}`);
    const file = statementFile(format, exampleStatement);

    const first = await imports.importFile(owner, accountId, file);

    expect(first.status).toBe("done");
    expect(first.linesAdded).toBe(lines.length);

    const second = await imports.importFile(owner, accountId, file);

    expect(second.sameFile).toBe(true);
    expect(second).toMatchObject({
      status: "done",
      linesRead: lines.length,
      linesAdded: 0,
      linesDuplicate: lines.length,
      linesHeld: 0,
    });
    expect(await imports.linesOf(owner, accountId)).toHaveLength(lines.length);
  }
});

test("overlapping files add only the new lines", async () => {
  for (const format of ["ofx", "qif", "csv"] as const) {
    const accountId = await imports.createAccount(owner, `Overlap ${format}`);
    const early = statementFile(format, withLines(lines.slice(0, 5)), `early.${format}`);
    const late = statementFile(format, withLines(lines.slice(3)), `late.${format}`);

    expect(await imports.importFile(owner, accountId, early), format).toMatchObject({
      status: "done",
      linesAdded: 5,
    });

    const second = await imports.importFile(owner, accountId, late);

    expect(second, format).toMatchObject({
      status: "done",
      linesRead: 3,
      linesAdded: 1,
      linesDuplicate: 2,
      linesHeld: 0,
    });

    const saved = await imports.linesOf(owner, accountId);

    expect(saved.map(dayAndAmount), format).toEqual(lines.map(dayAndAmount));
  }
});

test("identical lines of one day are kept", async () => {
  const accountId = await imports.createAccount(owner, "Two coffees");
  const twice = withLines([coffee, coffee]);

  const first = await imports.importFile(owner, accountId, statementFile("csv", twice, "a.csv"));

  expect(first).toMatchObject({ status: "done", linesAdded: 2 });

  // A day read again with a third coffee adds that one only.
  const thrice = withLines([coffee, coffee, coffee]);
  const second = await imports.importFile(owner, accountId, statementFile("csv", thrice, "b.csv"));

  expect(second).toMatchObject({ linesAdded: 1, linesDuplicate: 2, linesHeld: 0 });
  expect(await imports.linesOf(owner, accountId)).toHaveLength(3);
});

test("a near duplicate is held for review", async () => {
  const accountId = await imports.createAccount(owner, "Near duplicates");
  const payment = lines[4];

  if (payment === undefined) {
    throw new Error("The example statement has no fifth line.");
  }

  await imports.importFile(owner, accountId, statementFile("ofx", withLines([payment])));

  // The same payment read from a CSV: booked a day later, its label written otherwise.
  const readAgain = withLines([
    { ...payment, bookedOn: "2026-10-16", label: "PRLV STREAMFLIX ABONNEMENT" },
  ]);

  const second = await imports.importFile(owner, accountId, statementFile("csv", readAgain));

  expect(second).toMatchObject({ linesAdded: 0, linesDuplicate: 0, linesHeld: 1 });

  const saved = await imports.linesOf(owner, accountId);
  const held = saved.find((line) => line.state === "held");

  expect(saved).toHaveLength(2);
  expect(held?.importId).toBe(second.id);
  expect(held?.duplicateOfLineId).not.toBeNull();
});

test("undoing removes exactly the import's lines", async () => {
  const accountId = await imports.createAccount(owner, "Undo");

  const early = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", withLines(lines.slice(0, 4)), "early.ofx"),
  );

  const late = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", withLines(lines.slice(2)), "late.ofx"),
  );

  const undone = await imports.undo(owner, late.id);

  expect(undone).toMatchObject({ linesRemoved: 2, linesGivenBack: 0, laterOverlapping: 0 });
  expect(undone.undone.status).toBe("undone");

  const left = await imports.linesOf(owner, accountId);

  expect(left).toHaveLength(4);
  expect(left.every((line) => line.importId === early.id)).toBe(true);

  // Its balances and its file go with it; the row stays, with its counts, in the history.
  const balances = await data.asUser(owner, (transaction) =>
    transaction.select().from(accountBalance).where(eq(accountBalance.importId, late.id)),
  );

  expect(balances).toEqual([]);
  expect((await imports.show(owner, late.id)).linesAdded).toBe(2);
});

test("undoing an import counts again the lines held as its near duplicates", async () => {
  const accountId = await imports.createAccount(owner, "Undo near duplicates");
  const payment = lines[4];

  if (payment === undefined) {
    throw new Error("The example statement has no fifth line.");
  }

  const fromOfx = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", withLines([payment])),
  );

  const readAgain = withLines([
    { ...payment, bookedOn: "2026-10-16", label: "STREAMFLIX ABONNEMENT" },
  ]);

  const fromCsv = await imports.importFile(owner, accountId, statementFile("csv", readAgain));

  expect(fromCsv.linesHeld).toBe(1);

  const undone = await imports.undo(owner, fromOfx.id);

  expect(undone).toMatchObject({ linesRemoved: 1, linesGivenBack: 1 });
  expect(await imports.linesOf(owner, accountId)).toEqual([
    expect.objectContaining({ state: "counted", importId: fromCsv.id, duplicateOfLineId: null }),
  ]);
});

test("a job run again doubles no line", async () => {
  const accountId = await imports.createAccount(owner, "Run again");

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("camt053", exampleStatement),
  );

  expect(done.linesAdded).toBe(lines.length);

  // An attempt that stopped after saving its lines, before the import was marked done: the next
  // attempt runs from the first step.
  await data.asUser(owner, (transaction) =>
    transaction
      .update(statementImport)
      .set({ status: "saving" })
      .where(eq(statementImport.id, done.id)),
  );

  await imports.run(owner, done.id);

  expect(await imports.show(owner, done.id)).toMatchObject({
    status: "done",
    linesAdded: lines.length,
    linesDuplicate: 0,
  });
  expect(await imports.linesOf(owner, accountId)).toHaveLength(lines.length);

  const balances = await data.asUser(owner, (transaction) =>
    transaction.select().from(accountBalance).where(eq(accountBalance.importId, done.id)),
  );

  // The opening and the closing balance, once each.
  expect(balances).toHaveLength(2);

  // And an attempt left over once the import is done changes nothing.
  await imports.run(owner, done.id);
  expect(await imports.linesOf(owner, accountId)).toHaveLength(lines.length);
});

test("a file that names its account goes to it", async () => {
  const accountId = await imports.createAccount(
    owner,
    "Recognised by its IBAN",
    exampleStatement.account.iban,
  );

  for (const format of ["camt053", "mt940"] as const) {
    const imported = await imports.importFile(owner, null, statementFile(format, exampleStatement));

    expect(imported.account?.id, format).toBe(accountId);
    expect(imported.status, format).toBe("done");
  }

  // A QIF file names none: the import waits for the user to choose.
  const waiting = await imports.importFile(owner, null, statementFile("qif", exampleStatement));

  expect(waiting).toMatchObject({ status: "waiting", waitingFor: "account" });
});

test("a CSV file whose dates read both ways waits for the user to say which", async () => {
  const accountId = await imports.createAccount(owner, "Dates both ways");

  // Every day of these is the 12th or before: 03/10 may be the 3rd of October or the 10th of March.
  const early = withLines(lines.slice(0, 3));
  const waiting = await imports.importFile(owner, accountId, statementFile("csv", early));

  expect(waiting).toMatchObject({ status: "waiting", waitingFor: "profile", linesAdded: 0 });
  expect(await imports.linesOf(owner, accountId)).toEqual([]);
});
