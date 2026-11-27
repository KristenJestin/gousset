import {
  AccountNotFound,
  DatabaseAccountStore,
  DatabaseCategoryStore,
  DatabaseLineStore,
  InvalidIsin,
  LinkRefused,
  NotAnInvestmentAccount,
  OperationNotFound,
  OperationRefused,
  SecurityNotOnAccount,
  SplitRefused,
  Today,
  TransferRefused,
  checkOperation,
  correctInvestmentOperation,
  deleteInvestmentOperation,
  enterInvestmentOperation,
  expensesLayer,
  investmentAccounts,
  investmentOperationOn,
  investmentOperations,
  investmentPosition,
  investmentPositionByIsin,
  investmentsLayer,
  isinCheckDigit,
  lineTransferOf,
  linkLine,
  listMerchants,
  merchantsLayer,
  monthFactsLayer,
  monthSummary,
  operationDedupKeys,
  pairEveryLine,
  pairLines,
  recogniseMerchants,
  reviewQueue,
  saveImportedOperations,
  splitLine,
  transfersLayer,
  unpairLine,
} from "@gousset/core";
import type {
  AccountStore,
  CategoryStore,
  Expenses,
  Investments,
  LineStore,
  Merchants,
  MonthFacts,
  OperationInput,
  Transfers,
} from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { investmentOperation, security } from "@gousset/db/schema/investments";
import {
  account,
  entry,
  entryPart,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 1: an investment account's operations, each a cash line with what the broker
// says of it, written through `@gousset/core` on the worker's database for a user of this file's
// own (docs/data-model.md, v0.6). A purchase's, a sale's, a dividend's and a fee's cash is none of
// the month's: no entry, no transfer, no merchant, nothing to review. Each test moves amounts no
// other test moves, so that its lines are no other test's candidates. Every amount, label, broker
// and ISIN is invented; the ISINs are in the country code XX, which no country has.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Ines Example",
    email: `ines.investments.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-ines-password-${app.slot}`,
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

/** An invented ISIN: `XX`, nine letters or digits, and its check digit. */
const isin = (rest: string) => `XX${rest}${String(isinCheckDigit(`XX${rest}`))}`;

/** What the logic of these tests runs on. */
type Services =
  | AccountStore
  | LineStore
  | CategoryStore
  | Transfers
  | Merchants
  | Expenses
  | MonthFacts
  | Investments
  | UserData;

/** Runs the logic on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          DatabaseAccountStore,
          DatabaseLineStore,
          DatabaseCategoryStore,
          transfersLayer,
          merchantsLayer,
          expensesLayer,
          monthFactsLayer,
          investmentsLayer,
        ).pipe(Layer.provideMerge(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** What a failed run failed with; null when it did not fail. */
const failure = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  run(effect.pipe(Effect.match({ onFailure: (error): E | null => error, onSuccess: () => null })));

/** A new account of the user's. */
async function newAccount(
  name: string,
  kind: "current" | "investment" | "savings",
  mode: "lines" | "balance" = "lines",
): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({
        userId: owner,
        name,
        kind,
        envelope: kind === "investment" ? "pea" : null,
        institution: "Harbour Broker",
        currency: "EUR",
        mode,
      })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** An operation of these values, the others as a purchase of one unit at 100 € has them. */
const operation = (values: Partial<OperationInput>): OperationInput => ({
  kind: "purchase",
  bookedOn: "2026-10-14",
  valueOn: null,
  amountMinor: -10_000,
  isin: null,
  securityName: null,
  securityCurrency: null,
  quantity: null,
  unitPrice: null,
  feesMinor: 0,
  label: null,
  ...values,
});

const enter = (accountId: string, values: Partial<OperationInput>) =>
  run(enterInvestmentOperation(owner, accountId, operation(values)));

/** How each line is classified: its entries' `classified_by`, none for no entry. */
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

/** Whether each line is said to be no transfer (`transfer_refused`); null for none. */
const refusedOf = (lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, async (transaction) => {
    const rows = await transaction
      .select({ id: statementLine.id, refused: statementLine.transferRefused })
      .from(statementLine)
      .where(inArray(statementLine.id, [...lineIds]));

    return lineIds.map((lineId) => rows.find((row) => row.id === lineId)?.refused ?? null);
  });

/** A statement of these lines alone, each with a reference of its own. */
function statementOf(name: string, lines: ReadonlyArray<Omit<StatementLine, "reference">>) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  return statementFile("ofx", statement, `${name}.ofx`);
}

/** The account's line of this amount, after importing these lines into it. */
async function importLine(accountId: string, name: string, line: Omit<StatementLine, "reference">) {
  const done = await imports.importFile(owner, accountId, statementOf(name, [line]));

  expect(done.status, name).toBe("done");

  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId)),
  );

  if (found === undefined) {
    throw new Error(`No line imported into ${name}.`);
  }

  return found.id;
}

test("an operation entered by hand is a line of its own, its security found or made by ISIN", async () => {
  const pea = await newAccount("Entered PEA", "investment");
  const world = isin("ENT000001");

  const bought = await enter(pea, {
    bookedOn: "2026-10-14",
    valueOn: "2026-10-16",
    amountMinor: -33_599,
    isin: world,
    securityName: "Entered World ETF",
    quantity: "2,9791",
    unitPrice: "112.4519",
    feesMinor: 99,
  });

  expect(bought).toMatchObject({
    kind: "purchase",
    bookedOn: "2026-10-14",
    valueOn: "2026-10-16",
    amount: { minor: -33_599, currency: "EUR" },
    fees: { minor: 99, currency: "EUR" },
    quantity: "2.9791",
    unitPrice: { value: "112.4519", currency: "EUR" },
    security: { isin: world, name: "Entered World ETF", currency: "EUR" },
    // No label given: the security's name.
    label: "Entered World ETF",
    source: "manual",
    state: "counted",
    paired: false,
  });

  // The same ISIN, in any case, is the same security, which keeps its name.
  const again = await enter(pea, {
    bookedOn: "2026-10-20",
    amountMinor: -11_000,
    isin: world.toLowerCase(),
    securityName: "Another name",
    quantity: "1",
    unitPrice: "110",
    label: "ACHAT ENTERED WORLD",
  });

  expect(again.security?.id).toBe(bought.security?.id);
  expect(again.security?.name).toBe("Entered World ETF");
  expect(again.label).toBe("ACHAT ENTERED WORLD");

  const [line] = await data.asUser(owner, (transaction) =>
    transaction
      .select({
        source: statementLine.source,
        importId: statementLine.importId,
        dedupKey: statementLine.dedupKey,
      })
      .from(statementLine)
      .where(eq(statementLine.id, bought.lineId)),
  );

  expect(line).toEqual({ source: "manual", importId: null, dedupKey: null });

  const detail = await run(investmentPosition(owner, pea, bought.security?.id ?? ""));

  expect(detail.position).toMatchObject({
    quantity: "3.9791",
    cost: { minor: 44_599, currency: "EUR" },
    incomplete: false,
    open: true,
  });
  expect(detail.operations.map((each) => each.id)).toEqual([again.id, bought.id]);
});

test("an operation is refused on an account that is no investment, or kept by its balance", async () => {
  const current = await newAccount("Refusing current", "current");
  const kept = await newAccount("Refusing PEA kept by balance", "investment", "balance");
  const pea = await newAccount("Refusing PEA", "investment");
  const deposit = { kind: "deposit", amountMinor: 1001 } as const;

  expect(await failure(enterInvestmentOperation(owner, current, operation(deposit)))).toEqual(
    new NotAnInvestmentAccount({ accountId: current, reason: "kind" }),
  );
  expect(await failure(enterInvestmentOperation(owner, kept, operation(deposit)))).toEqual(
    new NotAnInvestmentAccount({ accountId: kept, reason: "balance" }),
  );

  // A purchase brings no money in, an ISIN with a typo is no ISIN.
  expect(
    await failure(
      enterInvestmentOperation(
        owner,
        pea,
        operation({ amountMinor: 1001, isin: isin("REF000001"), quantity: "1", unitPrice: "10" }),
      ),
    ),
  ).toEqual(new OperationRefused({ reason: "sign" }));

  const typo = `${isin("REF000001").slice(0, 11)}${String((isinCheckDigit("XXREF000001") + 1) % 10)}`;

  expect(
    await failure(
      enterInvestmentOperation(
        owner,
        pea,
        operation({ amountMinor: -1001, isin: typo, quantity: "1", unitPrice: "10" }),
      ),
    ),
  ).toEqual(new InvalidIsin({ isin: typo }));

  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(inArray(statementLine.accountId, [current, kept, pea])),
  );

  expect(lines).toEqual([]);
});

test("a purchase's, a sale's, a dividend's and a fee's cash has no entry; a deposit's has its own", async () => {
  const pea = await newAccount("Entries PEA", "investment");
  const fund = isin("ENR000001");

  const deposit = await enter(pea, { kind: "deposit", amountMinor: 50_017 });

  const purchase = await enter(pea, {
    isin: fund,
    amountMinor: -20_017,
    quantity: "2",
    unitPrice: "100",
  });

  const sale = await enter(pea, {
    kind: "sale",
    isin: fund,
    amountMinor: 10_517,
    quantity: "1",
    unitPrice: "105.17",
  });

  const dividend = await enter(pea, { kind: "dividend", isin: fund, amountMinor: 317 });
  const fee = await enter(pea, { kind: "fee", amountMinor: -117 });

  expect(
    await entriesOf([deposit, purchase, sale, dividend, fee].map((each) => each.lineId)),
  ).toEqual([["default"], [], [], [], []]);
});

test("an operation's cash is never paired as a transfer, nor offered as a side", async () => {
  const current = await newAccount("Pairing current", "current");
  const pea = await newAccount("Pairing PEA", "investment");

  // A sale's cash and a line out of the current account of its amount, the same day.
  const out = await importLine(current, "pairing-current", {
    bookedOn: "2026-10-09",
    amountMinor: -24_013,
    label: "SEPA TRF TO MY BROKER",
  });

  const sale = await enter(pea, {
    kind: "sale",
    bookedOn: "2026-10-09",
    amountMinor: 24_013,
    isin: isin("PAI000001"),
    quantity: "1",
    unitPrice: "240.13",
  });

  await run(pairEveryLine(owner));

  expect((await run(lineTransferOf(owner, out))).paired).toBeNull();
  expect((await run(lineTransferOf(owner, out))).candidates).toEqual([]);
  expect((await run(lineTransferOf(owner, sale.lineId))).candidates).toEqual([]);

  expect(await failure(pairLines(owner, out, sale.lineId))).toEqual(
    new TransferRefused({ reason: "investment_operation", lineId: sale.lineId }),
  );

  // A deposit of that amount is the current account's other side, as any line is: its only
  // candidate, paired at once.
  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-09",
    amountMinor: 24_013,
  });

  expect(deposit.paired).toBe(true);
  expect((await run(lineTransferOf(owner, out))).paired?.other.id).toBe(deposit.lineId);
});

test("a deposit or a withdrawal entered by hand is paired at once with its only candidate", async () => {
  const current = await newAccount("At once current", "current");
  const savings = await newAccount("At once savings", "savings");
  const pea = await newAccount("At once PEA", "investment");

  const out = await importLine(current, "at-once-current", {
    bookedOn: "2026-10-06",
    amountMinor: -60_047,
    label: "SEPA TRF TO MY PEA",
  });

  // One candidate: the transfer is made, and the deposit loses its entry.
  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-06",
    amountMinor: 60_047,
  });

  expect(deposit.paired).toBe(true);
  expect((await run(lineTransferOf(owner, out))).paired?.other.id).toBe(deposit.lineId);
  expect(await entriesOf([out, deposit.lineId])).toEqual([[], []]);

  // Two candidates, on two accounts: the withdrawal waits for the user's choice, with its entry.
  const other = await newAccount("At once other current", "current");

  const intoCurrent = await importLine(other, "at-once-current-in", {
    bookedOn: "2026-10-20",
    amountMinor: 7047,
    label: "SEPA TRF FROM MY PEA",
  });

  const intoSavings = await importLine(savings, "at-once-savings-in", {
    bookedOn: "2026-10-20",
    amountMinor: 7047,
    label: "SEPA TRF FROM MY PEA",
  });

  const withdrawal = await enter(pea, {
    kind: "withdrawal",
    bookedOn: "2026-10-20",
    amountMinor: -7047,
  });

  expect(withdrawal.paired).toBe(false);

  const waiting = await run(lineTransferOf(owner, withdrawal.lineId));

  expect(waiting.paired).toBeNull();
  expect(waiting.candidates.map((each) => each.id).toSorted()).toEqual(
    [intoCurrent, intoSavings].toSorted(),
  );
  expect(await entriesOf([withdrawal.lineId])).toEqual([["default"]]);

  // A fee corrected into a withdrawal is paired at once too, with its one candidate.
  const back = await importLine(await newAccount("At once back", "savings"), "at-once-back", {
    bookedOn: "2026-10-27",
    amountMinor: 3047,
    label: "SEPA TRF FROM MY PEA",
  });

  const fee = await enter(pea, { kind: "fee", bookedOn: "2026-10-27", amountMinor: -3047 });

  expect(fee.paired).toBe(false);

  const corrected = await run(
    correctInvestmentOperation(
      owner,
      fee.id,
      operation({ kind: "withdrawal", bookedOn: "2026-10-27", amountMinor: -3047 }),
    ),
  );

  expect(corrected.paired).toBe(true);
  expect((await run(lineTransferOf(owner, back))).paired?.other.id).toBe(fee.lineId);
});

test("a purchase's label names no merchant", async () => {
  const pea = await newAccount("Merchants PEA", "investment");

  await enter(pea, {
    amountMinor: -10_019,
    isin: isin("MER000001"),
    quantity: "1",
    unitPrice: "100.19",
    label: "ACHAT QUILLWORK ROBOTICS",
  });

  await enter(pea, { kind: "fee", amountMinor: -119, label: "FRAIS QUILLWORK CUSTODY" });
  await run(recogniseMerchants(owner));

  const named = (await run(listMerchants(owner, { text: "QUILLWORK" }))).merchants;

  expect(named).toEqual([]);
});

test("the lines to review leave an operation's cash out", async () => {
  const pea = await newAccount("Review PEA", "investment");
  const fund = isin("REV000001");

  const deposit = await enter(pea, { kind: "deposit", amountMinor: 30_023 });

  const purchase = await enter(pea, {
    isin: fund,
    amountMinor: -20_023,
    quantity: "2",
    unitPrice: "100",
  });

  const dividend = await enter(pea, { kind: "dividend", isin: fund, amountMinor: 223 });
  const fee = await enter(pea, { kind: "fee", amountMinor: -123 });

  const queued = (await run(reviewQueue(owner, { accountId: pea, limit: 100 }))).lines.map(
    (each) => each.line.id,
  );

  // The deposit, an income by default, is to review as any line is; the others are no one's.
  expect(queued).toContain(deposit.lineId);
  expect(queued).not.toContain(purchase.lineId);
  expect(queued).not.toContain(dividend.lineId);
  expect(queued).not.toContain(fee.lineId);
});

test("an operation's cash joins no expense, as a part or a target, and is not split", async () => {
  const current = await newAccount("Linking current", "current");
  const pea = await newAccount("Linking PEA", "investment");
  const fund = isin("LNK000001");

  const paid = await importLine(current, "linking-current", {
    bookedOn: "2026-10-03",
    amountMinor: -4031,
    label: "CB LINKWORTH STORES 0310",
  });

  const purchase = await enter(pea, {
    isin: fund,
    amountMinor: -20_031,
    quantity: "2",
    unitPrice: "100.155",
  });

  const dividend = await enter(pea, { kind: "dividend", isin: fund, amountMinor: 231 });

  expect(await failure(linkLine(owner, purchase.lineId, paid))).toEqual(
    new LinkRefused({ reason: "investment_operation", lineId: purchase.lineId }),
  );
  expect(await failure(linkLine(owner, paid, dividend.lineId))).toEqual(
    new LinkRefused({ reason: "investment_operation", lineId: dividend.lineId }),
  );
  expect(
    await failure(
      splitLine(owner, purchase.lineId, [
        { categoryId: crypto.randomUUID(), amount: "100" },
        { categoryId: crypto.randomUUID(), amount: "100.31" },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "investment_operation" }));

  // Neither line was given an entry on the way.
  expect(await entriesOf([purchase.lineId, dividend.lineId])).toEqual([[], []]);
});

test("the month: received and spent are unchanged, and set aside is the deposit", async () => {
  const current = await newAccount("Month current", "current");
  const pea = await newAccount("Month PEA", "investment");
  const fund = isin("MON000001");

  await imports.importFile(
    owner,
    current,
    statementOf("month-current", [
      { bookedOn: "2026-09-01", amountMinor: 310_029, label: "SEPA TRF MONTHWORKS SALARY" },
      { bookedOn: "2026-09-05", amountMinor: -70_029, label: "DIRECT DEBIT MONTH HOMES RENT" },
      { bookedOn: "2026-09-12", amountMinor: -35_029, label: "SEPA TRF TO MY PEA" },
    ]),
  );

  const [out] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.amountMinor, -35_029)),
  );

  // Its only candidate: paired at once.
  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-09-12",
    amountMinor: 35_029,
  });

  expect((await run(lineTransferOf(owner, out?.id ?? ""))).paired?.other.id).toBe(deposit.lineId);

  const before = await run(monthSummary(owner, "2026-09", "EUR"));

  await enter(pea, {
    bookedOn: "2026-09-14",
    isin: fund,
    amountMinor: -33_529,
    quantity: "2.9791",
    unitPrice: "112.4519",
    feesMinor: 99,
  });
  await enter(pea, { kind: "dividend", bookedOn: "2026-09-25", isin: fund, amountMinor: 1829 });
  await enter(pea, { kind: "fee", bookedOn: "2026-09-30", amountMinor: -129 });

  const after = await run(monthSummary(owner, "2026-09", "EUR"));

  expect(after.received).toEqual(before.received);
  expect(after.spent).toEqual(before.spent);
  expect(after.setAside).toEqual({ minor: 35_029, currency: "EUR" });
  expect(after.left).toEqual(before.left);

  // The account's cash counts them all; its position holds the purchase, at cost.
  const [listed] = (await run(investmentAccounts(owner))).filter((each) => each.id === pea);

  expect(listed?.cash).toEqual({ minor: 35_029 - 33_529 + 1829 - 129, currency: "EUR" });
  expect(listed?.positions).toMatchObject([
    { security: { isin: fund }, quantity: "2.9791", cost: { minor: 33_529, currency: "EUR" } },
  ]);
});

test("correcting an operation changes its line with it, and unpairs a deposit moved", async () => {
  const current = await newAccount("Correct current", "current");
  const pea = await newAccount("Correct PEA", "investment");
  const fund = isin("COR000001");

  const out = await importLine(current, "correct-current", {
    bookedOn: "2026-10-03",
    amountMinor: -40_031,
    label: "SEPA TRF TO MY PEA",
  });

  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-03",
    amountMinor: 40_031,
  });

  // Paired at once, with its only candidate.
  expect(deposit.paired).toBe(true);

  // A deposit moved in its amount is no transfer any more: both lines to review, each its entry.
  const moved = await run(
    correctInvestmentOperation(
      owner,
      deposit.id,
      operation({ kind: "deposit", bookedOn: "2026-10-03", amountMinor: 40_131 }),
    ),
  );

  expect(moved).toMatchObject({ amount: { minor: 40_131 }, paired: false });
  expect((await run(lineTransferOf(owner, out))).paired).toBeNull();
  expect(await entriesOf([out, deposit.lineId])).toEqual([["default"], ["default"]]);

  const [part] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ amountMinor: entryPart.amountMinor })
      .from(entryPart)
      .where(eq(entryPart.lineId, deposit.lineId)),
  );

  expect(part?.amountMinor).toBe(40_131);

  // Made a fee, it loses its entry; a deposit again, it gets one back.
  await run(
    correctInvestmentOperation(owner, deposit.id, operation({ kind: "fee", amountMinor: -131 })),
  );
  expect(await entriesOf([deposit.lineId])).toEqual([[]]);

  await run(
    correctInvestmentOperation(owner, deposit.id, operation({ kind: "deposit", amountMinor: 131 })),
  );
  expect(await entriesOf([deposit.lineId])).toEqual([["default"]]);

  // A purchase corrected: its quantity and its cost follow.
  const purchase = await enter(pea, {
    isin: fund,
    amountMinor: -20_031,
    quantity: "2",
    unitPrice: "100",
  });

  await run(
    correctInvestmentOperation(
      owner,
      purchase.id,
      operation({ isin: fund, amountMinor: -30_031, quantity: "3", unitPrice: "100" }),
    ),
  );

  const detail = await run(investmentPosition(owner, pea, purchase.security?.id ?? ""));

  expect(detail.position).toMatchObject({ quantity: "3", cost: { minor: 30_031 } });
  expect(await entriesOf([purchase.lineId])).toEqual([[]]);
});

test('a deposit corrected in its day is paired again: a correction is no "not a transfer"', async () => {
  const current = await newAccount("Repair current", "current");
  const pea = await newAccount("Repair PEA", "investment");

  const out = await importLine(current, "repair-current", {
    bookedOn: "2026-10-03",
    amountMinor: -40_047,
    label: "SEPA TRF TO MY PEA",
  });

  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-03",
    amountMinor: 40_047,
  });

  expect(deposit.paired).toBe(true);

  // Its day corrected: unpaired, then paired again at once with its only candidate.
  const moved = await run(
    correctInvestmentOperation(
      owner,
      deposit.id,
      operation({ kind: "deposit", bookedOn: "2026-10-04", amountMinor: 40_047 }),
    ),
  );

  expect(moved).toMatchObject({ bookedOn: "2026-10-04", paired: true });
  expect((await run(lineTransferOf(owner, out))).paired).toMatchObject({
    other: { id: deposit.lineId },
    setAside: true,
  });
  expect(await entriesOf([out, deposit.lineId])).toEqual([[], []]);
  expect(await refusedOf([out, deposit.lineId])).toEqual([false, false]);

  // Deleted: its other side stays pairable, and the next deposit of its amount pairs with it.
  await run(deleteInvestmentOperation(owner, deposit.id));

  expect(await refusedOf([out])).toEqual([false]);

  const again = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-03",
    amountMinor: 40_047,
  });

  expect(again.paired).toBe(true);
  expect((await run(lineTransferOf(owner, out))).paired?.other.id).toBe(again.lineId);

  // The user's own unpairing is still a "not a transfer" on both sides.
  await run(unpairLine(owner, out));

  expect(await refusedOf([out, again.lineId])).toEqual([true, true]);
});

test("a correction keeps the line's settlement day on its day, and names it after a new security", async () => {
  const pea = await newAccount("Settled PEA", "investment");
  const first = isin("SET000001");
  const second = isin("SET000002");

  const bought = await enter(pea, {
    bookedOn: "2026-10-14",
    valueOn: "2026-10-16",
    amountMinor: -10_053,
    isin: first,
    securityName: "First Settled Fund",
    quantity: "1",
    unitPrice: "100.53",
  });

  expect(bought).toMatchObject({ valueOn: "2026-10-16", label: "First Settled Fund" });

  const correct = (values: Partial<OperationInput>) =>
    run(
      correctInvestmentOperation(
        owner,
        bought.id,
        operation({
          bookedOn: "2026-10-14",
          amountMinor: -10_053,
          isin: second,
          securityName: "Second Settled Fund",
          quantity: "1",
          unitPrice: "100.53",
          ...values,
        }),
      ),
    );

  // Corrected with no settlement day nor label, as the page and the MCP door correct one: its
  // settlement day kept, its line named after its new security rather than the old one.
  expect(await correct({})).toMatchObject({
    valueOn: "2026-10-16",
    label: "Second Settled Fund",
    security: { isin: second, name: "Second Settled Fund" },
  });

  // A label given is the line's; the same security and none given, the line keeps its own.
  expect((await correct({ label: "ACHAT SECOND SETTLED" })).label).toBe("ACHAT SECOND SETTLED");
  expect(await correct({})).toMatchObject({
    valueOn: "2026-10-16",
    label: "ACHAT SECOND SETTLED",
  });

  // Moved to another day, the settlement day no longer follows it; one given is the line's.
  expect((await correct({ bookedOn: "2026-10-15" })).valueOn).toBeNull();
  expect((await correct({ bookedOn: "2026-10-15", valueOn: "2026-10-19" })).valueOn).toBe(
    "2026-10-19",
  );
});

test("deleting an operation deletes its line, unpairs a deposit, and keeps its security", async () => {
  const current = await newAccount("Delete current", "current");
  const pea = await newAccount("Delete PEA", "investment");
  const fund = isin("DEL000001");

  const out = await importLine(current, "delete-current", {
    bookedOn: "2026-10-04",
    amountMinor: -40_037,
    label: "SEPA TRF TO MY PEA",
  });

  const deposit = await enter(pea, {
    kind: "deposit",
    bookedOn: "2026-10-04",
    amountMinor: 40_037,
  });

  // Paired at once, with its only candidate.
  expect(deposit.paired).toBe(true);

  const removed = await run(deleteInvestmentOperation(owner, deposit.id));

  expect(removed.id).toBe(deposit.id);
  expect((await run(lineTransferOf(owner, out))).paired).toBeNull();
  // The other side is to review again, an expense of its own.
  expect(await entriesOf([out])).toEqual([["default"]]);

  const purchase = await enter(pea, {
    isin: fund,
    amountMinor: -10_037,
    quantity: "1",
    unitPrice: "100",
  });

  await run(deleteInvestmentOperation(owner, purchase.id));

  const left = await data.asUser(owner, async (transaction) => ({
    lines: await transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.accountId, pea)),
    operations: await transaction
      .select({ id: investmentOperation.id })
      .from(investmentOperation)
      .where(inArray(investmentOperation.id, [deposit.id, purchase.id])),
    securities: await transaction
      .select({ id: security.id })
      .from(security)
      .where(eq(security.isin, fund)),
  }));

  expect(left).toMatchObject({
    lines: [],
    operations: [],
    securities: [{ id: purchase.security?.id }],
  });

  expect(await failure(deleteInvestmentOperation(owner, purchase.id))).toEqual(
    new OperationNotFound({ operationId: purchase.id }),
  );
});

test("a security with operations is not deleted", async () => {
  const pea = await newAccount("Kept PEA", "investment");

  const bought = await enter(pea, {
    isin: isin("KEP000001"),
    amountMinor: -10_041,
    quantity: "1",
    unitPrice: "100.41",
  });

  expect(
    await data.refusal(owner, (transaction) =>
      transaction.delete(security).where(eq(security.id, bought.security?.id ?? "")),
    ),
  ).toBe("23503");
});

test("an import's operations are saved once, by their keys, a deposit with its entry", async () => {
  const pea = await newAccount("Imported PEA", "investment");
  const fund = isin("IMP000001");

  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(statementImport)
      .values({
        userId: owner,
        accountId: pea,
        fileName: "harbour-operations.csv",
        fileSha256: "1".repeat(64),
        format: "csv",
        status: "saving",
      })
      .returning({ id: statementImport.id }),
  );

  const importId = made?.id ?? "";

  const read: ReadonlyArray<OperationInput & { readonly reference: string | null }> = [
    {
      ...operation({
        kind: "deposit",
        bookedOn: "2026-10-01",
        amountMinor: 50_043,
        label: "VERSEMENT",
      }),
      reference: null,
    },
    {
      ...operation({
        bookedOn: "2026-10-02",
        isin: fund,
        securityName: "Imported Fund",
        amountMinor: -10_043,
        quantity: "1",
        unitPrice: "100.43",
        label: "ACHAT IMPORTED FUND",
      }),
      reference: null,
    },
    // The same purchase twice the same day: two operations.
    {
      ...operation({
        bookedOn: "2026-10-02",
        isin: fund,
        securityName: "Imported Fund",
        amountMinor: -10_043,
        quantity: "1",
        unitPrice: "100.43",
        label: "ACHAT IMPORTED FUND",
      }),
      reference: null,
    },
  ];

  const checked = read.map((each) => ({
    ...Result.getOrThrow(checkOperation(each)),
    reference: each.reference,
  }));

  const keys = operationDedupKeys(
    checked.map((each) => ({
      bookedOn: each.bookedOn,
      kind: each.kind,
      isin: each.security?.isin ?? null,
      quantity: each.quantity,
      unitPrice: each.unitPrice,
      amountMinor: each.amountMinor,
      reference: each.reference,
      referenceUnique: false,
    })),
  );

  const keyed = checked.map((each, index) => ({ ...each, dedupKey: keys[index] ?? "" }));

  const save = () =>
    data.asUser(owner, (transaction) =>
      saveImportedOperations(transaction, owner, { accountId: pea, importId }, keyed),
    );

  expect(await save()).toEqual({ added: 3, duplicate: 0 });
  // Run again, as an attempt after a crash: nothing more.
  expect(await save()).toEqual({ added: 0, duplicate: 3 });

  const page = await run(investmentOperations(owner, pea, { limit: 2 }));

  expect(page.total).toBe(3);
  expect(page.operations.map((each) => [each.kind, each.source, each.label])).toEqual([
    ["purchase", "import", "ACHAT IMPORTED FUND"],
    ["purchase", "import", "ACHAT IMPORTED FUND"],
  ]);

  const rest = await run(investmentOperations(owner, pea, { after: page.next, limit: 2 }));

  expect(rest.operations.map((each) => each.kind)).toEqual(["deposit"]);
  expect(rest.next).toBeNull();

  const deposit = rest.operations[0];

  expect(await entriesOf([deposit?.lineId ?? ""])).toEqual([["default"]]);

  // Corrected, an imported line keeps its key: its file imported again brings nothing back.
  const purchase = page.operations[0];

  const [keyBefore] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ dedupKey: statementLine.dedupKey })
      .from(statementLine)
      .where(eq(statementLine.id, purchase?.lineId ?? "")),
  );

  await run(
    correctInvestmentOperation(
      owner,
      purchase?.id ?? "",
      operation({
        bookedOn: "2026-10-02",
        isin: fund,
        amountMinor: -10_143,
        quantity: "1",
        unitPrice: "101.43",
      }),
    ),
  );

  const [keyAfter] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ dedupKey: statementLine.dedupKey })
      .from(statementLine)
      .where(eq(statementLine.id, purchase?.lineId ?? "")),
  );

  expect(keyAfter).toEqual(keyBefore);
  expect(await save()).toEqual({ added: 0, duplicate: 3 });
});

test("one operation is read by its id on its account, and refused on another or once discarded", async () => {
  const pea = await newAccount("Handle PEA", "investment");
  const other = await newAccount("Handle other PEA", "investment");

  const bought = await enter(pea, {
    isin: isin("HAN000001"),
    amountMinor: -10_059,
    quantity: "1",
    unitPrice: "100.59",
  });

  expect(await run(investmentOperationOn(owner, pea, bought.id))).toEqual(bought);

  // On another account of the user's, or a handle that is no id: none.
  expect(await failure(investmentOperationOn(owner, other, bought.id))).toEqual(
    new OperationNotFound({ operationId: bought.id }),
  );
  expect(await failure(investmentOperationOn(owner, pea, "not-a-handle"))).toEqual(
    new OperationNotFound({ operationId: "not-a-handle" }),
  );

  const missing = crypto.randomUUID();

  expect(await failure(investmentOperationOn(owner, missing, bought.id))).toEqual(
    new AccountNotFound({ accountId: missing }),
  );

  // A discarded line's operation is none of the account's operations, as their pages leave it out.
  await data.asUser(owner, (transaction) =>
    transaction
      .update(statementLine)
      .set({ state: "discarded" })
      .where(eq(statementLine.id, bought.lineId)),
  );

  expect(await failure(investmentOperationOn(owner, pea, bought.id))).toEqual(
    new OperationNotFound({ operationId: bought.id }),
  );
});

test("one security's position on an account is read by ISIN, open or sold out, and refused when it has none", async () => {
  const pea = await newAccount("By ISIN PEA", "investment");
  const other = await newAccount("By ISIN other PEA", "investment");
  const sold = isin("BYI000001");
  const held = isin("BYI000002");

  const purchase = await enter(pea, {
    bookedOn: "2026-10-05",
    isin: sold,
    amountMinor: -20_061,
    quantity: "2",
    unitPrice: "100.305",
  });

  const sale = await enter(pea, {
    kind: "sale",
    bookedOn: "2026-10-06",
    isin: sold,
    amountMinor: 21_061,
    quantity: "2",
    unitPrice: "105.305",
  });

  const kept = await enter(pea, {
    bookedOn: "2026-10-07",
    isin: held,
    amountMinor: -10_061,
    quantity: "1",
    unitPrice: "100.61",
  });

  // Sold to zero: its position is closed, its operations stay, as by its security's id.
  const soldOut = await run(investmentPositionByIsin(owner, pea, sold));

  expect(soldOut).toEqual(await run(investmentPosition(owner, pea, purchase.security?.id ?? "")));
  expect(soldOut.position).toMatchObject({ quantity: "0", open: false });
  expect(soldOut.operations.map((each) => each.id)).toEqual([sale.id, purchase.id]);

  const open = await run(investmentPositionByIsin(owner, pea, held));

  expect(open.security).toEqual(kept.security);
  expect(open.position).toMatchObject({ quantity: "1", open: true });
  expect(open.operations.map((each) => each.id)).toEqual([kept.id]);

  // An account with no operation of it, an ISIN of no security: none.
  expect(await failure(investmentPositionByIsin(owner, other, sold))).toEqual(
    new SecurityNotOnAccount({ accountId: other, isin: sold }),
  );

  const unknown = isin("BYI000003");

  expect(await failure(investmentPositionByIsin(owner, pea, unknown))).toEqual(
    new SecurityNotOnAccount({ accountId: pea, isin: unknown }),
  );

  const missing = crypto.randomUUID();

  expect(await failure(investmentPositionByIsin(owner, missing, sold))).toEqual(
    new AccountNotFound({ accountId: missing }),
  );
});
