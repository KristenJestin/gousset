import { readFile } from "node:fs/promises";

import { DatabaseAccountStore, Today, investmentAccounts, investmentsLayer } from "@gousset/core";
import type { AccountStore, Investments } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { account } from "@gousset/db/schema/ledger";
import { BROKER_ISINS, exampleStatement, fortuneoExport, fortuneoRow } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { importsOn, statementFile } from "../src/imports";
import { block, monthBarKey, seedReviewMonths } from "../src/review";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, "How to verify", the two scenarios the broker specs leave to others: a sale lowers
// the quantity held, and neither a purchase nor a sale counts in the month's spent or income. Each
// imports an invented Fortuneo-shaped export into an investment account of its user's own, through
// the library's Fortuneo profile file (`packages/import/profiles/`), as the import's job runs it on
// the worker's database. Every amount and name is invented, and the ISIN is in the country code XX,
// which no country has (`@gousset/fixture`).

const TODAY = "2026-11-15";
const OCTOBER = "/?month=2026-10";
const FUND = BROKER_ISINS.share;

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** Runs the investments' reads on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Investments | AccountStore | UserData>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(investmentsLayer, DatabaseAccountStore).pipe(Layer.provideMerge(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** The library's Fortuneo profile file, as a user downloads it from the repository. */
const LIBRARY_FILE = new URL(
  "../../../packages/import/profiles/operations/fortuneo-operations.json",
  import.meta.url,
);

/** A new PEA of the user's, kept by its lines, and the library's Fortuneo profile, imported. */
async function peaWithProfile(owner: string) {
  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({
        userId: owner,
        name: "Verify PEA",
        kind: "investment",
        envelope: "pea",
        institution: "Fortuneo",
        currency: "EUR",
      })
      .returning({ id: account.id }),
  );

  const content = await readFile(LIBRARY_FILE, "utf8");

  const saved = await imports.withProfiles((service) =>
    service.importFile(owner, { name: "Fortuneo (library)", institution: "Fortuneo", content }),
  );

  if (made === undefined || saved.source !== "stored") {
    throw new Error("The PEA or the profile was not made.");
  }

  return { pea: made.id, profile: saved.id };
}

/** Reads a Fortuneo-shaped file into the PEA with the profile, as the import screen does. */
async function importFortuneo(
  owner: string,
  pea: string,
  profile: string,
  fileName: string,
  rows: ReadonlyArray<ReadonlyArray<string>>,
) {
  const { started } = await imports.keep(owner, pea, { fileName, bytes: fortuneoExport(rows) });

  await imports.resumeWith(owner, started.id, {
    accountId: null,
    csvProfile: null,
    profile: { kind: "stored", id: profile },
  });
  await imports.run(owner, started.id);

  const done = await imports.show(owner, started.id);

  expect(done, fileName).toMatchObject({ status: "done", reads: "operations" });

  return done;
}

/** The PEA's position in the fund. */
async function fundPosition(owner: string, pea: string) {
  const [listed] = (await run(investmentAccounts(owner))).filter((each) => each.id === pea);

  return listed?.positions.find((each) => each.security.isin === FUND);
}

const PURCHASE = fortuneoRow({
  date: "06/10/2026",
  kind: "Achat Comptant",
  name: "VERIFY GLOBAL SHARES",
  isin: FUND,
  quantity: "10",
  price: "25,10",
  fees: "1,95",
  amount: "-252,95",
});

const SALE = fortuneoRow({
  date: "20/10/2026",
  kind: "Vente Comptant",
  name: "VERIFY GLOBAL SHARES",
  isin: FUND,
  quantity: "4",
  price: "27,00",
  fees: "0,99",
  amount: "107,01",
});

test("a sale lowers the quantity", async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, personOfItsOwn("verify-sale"));
  const owner = await data.ownerOf(person.email);
  const { pea, profile } = await peaWithProfile(owner);

  await importFortuneo(owner, pea, profile, "fortuneo-purchase.csv", [PURCHASE]);

  const bought = await fundPosition(owner, pea);

  expect(bought).toMatchObject({ quantity: "10", cost: { minor: 25_295 }, open: true });
  expect(bought?.averageCost).not.toBeNull();

  await importFortuneo(owner, pea, profile, "fortuneo-sale.csv", [SALE]);

  const sold = await fundPosition(owner, pea);

  // 4 of the 10 sold: 6 held, at the same cost each, the sale taking off its share of the cost.
  expect(sold).toMatchObject({
    quantity: "6",
    cost: { minor: (25_295 * 6) / 10, currency: "EUR" },
    incomplete: false,
    open: true,
  });
  expect(sold?.averageCost).toEqual(bought?.averageCost);
});

test("neither purchase nor sale counts in the month's spent or income", async ({
  page,
  app,
  user,
}) => {
  const person = await addUser(app.baseURL, user, personOfItsOwn("verify-month"));
  const owner = await data.ownerOf(person.email);

  // October: €2,000 received, €155 spent, €500 set aside, €1,345 left (`seedReviewMonths`).
  await seedReviewMonths(data, owner);

  const { pea, profile } = await peaWithProfile(owner);

  const [everyday] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: account.id })
      .from(account)
      .where(eq(account.name, "Everyday account")),
  );

  // €600 out of the everyday account to the PEA, the day the broker says it came in.
  const out: Statement = {
    ...exampleStatement,
    lines: [
      {
        bookedOn: "2026-10-02",
        amountMinor: -60_000,
        label: "SEPA TRF TO MY PEA",
        reference: "verify-month-1",
      },
    ],
  };

  expect(
    (await imports.importFile(owner, everyday?.id ?? "", statementFile("ofx", out, "out.ofx")))
      .status,
  ).toBe("done");

  // The deposit, a purchase and a sale, in one file: the deposit paired with the line out.
  const done = await importFortuneo(owner, pea, profile, "fortuneo-2026-10.csv", [
    fortuneoRow({
      date: "02/10/2026",
      kind: "Versement espèces",
      name: "VIREMENT",
      amount: "600,00",
    }),
    PURCHASE,
    SALE,
  ]);

  expect(done.linesAdded).toBe(3);

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, OCTOBER);

  const month = block(page, "The month");

  // Received and spent as before: neither the purchase's €252.95 nor the sale's €107.01.
  await expect(month).toContainText("€2,000");
  await expect(month).toContainText("received");
  await expect(monthBarKey(page, "spent")).toContainText("€155");
  // Set aside: the €500 to savings and the €600 paired into the PEA.
  await expect(monthBarKey(page, "saved")).toContainText("€1,100");
  await expect(monthBarKey(page, "left")).toContainText("€745");
});
