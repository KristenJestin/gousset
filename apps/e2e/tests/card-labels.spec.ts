import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { Merchants, lineMerchant, merchantsLayer, rereadMerchants } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { merchant, merchantAlias, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { addUser, connectMcp, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #243, "How to verify": an English card label that starts with `CARD` and a date is cleaned
// to the shop's name, not to `CARD`. An invented statement with two shops paid by `CARD dd/mm`
// labels makes two merchants, in the browser and through the MCP door, and a shop whose name starts
// with "Card" keeps it whole. And the boot job, once per user made before: the merchant "Card" a
// release before made of such labels goes when the user never touched it, and stays when they did.
// Each test has a user of its own. Every shop, label and amount is invented.

const TODAY = "2026-11-15";

// An OFX name holds 32 characters, which the statement's writer keeps: each label fits whole.
const PIZZA = "CARD 03/10 PIZZA NOVA";

/** Two shops paid by English card labels, one of them twice, and a shop named "Cardinal…". */
const LINES: ReadonlyArray<Omit<StatementLine, "reference">> = [
  { bookedOn: "2026-10-03", amountMinor: -2450, label: PIZZA },
  { bookedOn: "2026-10-17", amountMinor: -1890, label: "CARD 17/10 PIZZA NOVA" },
  { bookedOn: "2026-10-04", amountMinor: -6120, label: "CARD 04/10 FRESHMART" },
  { bookedOn: "2026-10-06", amountMinor: -1500, label: "CARDINAL BOOKS" },
];

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

const run = <A, E>(effect: Effect.Effect<A, E, Merchants | UserData>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.mergeAll(merchantsLayer, data.layer).pipe(Layer.provide(data.layer))),
    ),
  );

/** A user of the test's own, with the statement imported into an account of theirs. */
async function withStatement(baseURL: string, admin: TestUser, local: string) {
  const person = await addUser(baseURL, admin, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);
  const accountId = await imports.createAccount(owner, "Everyday");

  const statement: Statement = {
    ...exampleStatement,
    lines: LINES.map((line, index) => ({ ...line, reference: `CARD-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, "cards-2026-10.ofx"),
  );

  expect(done.status).toBe("done");

  return { person, owner };
}

/**
 * The user's merchants, each with its cleaned labels, sorted by code unit: a collation's order would
 * set "Card Payments" after "Cardinal Books" or before it.
 */
async function merchantsOf(owner: string) {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ name: merchant.name, alias: merchantAlias.alias })
      .from(merchant)
      .leftJoin(merchantAlias, eq(merchantAlias.merchantId, merchant.id))
      .orderBy(asc(merchant.name), asc(merchantAlias.alias)),
  );

  return rows.map((row) => `${row.name}: ${row.alias ?? ""}`).toSorted();
}

/** The id of the user's line of this label. */
async function lineOf(owner: string, label: string): Promise<string> {
  const [line] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.label, label)),
  );

  if (line === undefined) {
    throw new Error(`No line ${label}.`);
  }

  return line.id;
}

/**
 * The user's merchants as a release before #243 left them, recognition writing each with its
 * cleaned label in one transaction: one merchant "Card" for every `CARD dd/mm` label.
 */
async function asBeforeCardLabels(owner: string) {
  await data.asUser(owner, async (transaction) => {
    await transaction.delete(merchant);

    const made = await transaction
      .insert(merchant)
      .values([
        { userId: owner, name: "Card" },
        { userId: owner, name: "Cardinal Books" },
      ])
      .returning({ id: merchant.id, name: merchant.name });

    const id = (name: string) => made.find((each) => each.name === name)?.id ?? "";

    await transaction.insert(merchantAlias).values([
      { userId: owner, merchantId: id("Card"), alias: "CARD" },
      { userId: owner, merchantId: id("Cardinal Books"), alias: "CARDINAL BOOKS" },
    ]);
  });

  await data.madeBeforeCardLabels(owner);
}

test("an invented statement with two shops paid by CARD dd/mm labels shows two merchants", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await withStatement(app.baseURL, user, "abel.cards");

  expect(await merchantsOf(owner)).toEqual([
    "Cardinal Books: CARDINAL BOOKS",
    "Freshmart: FRESHMART",
    "Pizza Nova: PIZZA NOVA",
  ]);

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, "/settings/merchants");

  const merchants = page.getByRole("list", { name: "Merchants" }).getByRole("link");

  await expect(merchants).toHaveCount(3);
  await expect(merchants.filter({ hasText: "Pizza Nova" })).toHaveAccessibleName(
    /^Pizza Nova 1 label/,
  );
  await expect(merchants.filter({ hasText: "Freshmart" })).toHaveAccessibleName(
    /^Freshmart 1 label/,
  );
  await expect(merchants.filter({ hasText: "Cardinal Books" })).toHaveAccessibleName(
    /^Cardinal Books 1 label/,
  );
});

const allowRead = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

async function callTool(client: Client, name: string, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return first?.type === "text" ? first.text : "";
}

test("an MCP client reads a merchant for each shop paid by CARD dd/mm labels", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  const { person } = await withStatement(app.baseURL, user, "bree.cards");

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowRead,
    scope: "read",
    clientId: mcpClientId,
  });

  const listed = await callTool(client, "merchants", { action: "list" });

  expect(listed).toContain("Pizza Nova");
  expect(listed).toContain("Freshmart");
  expect(listed).toContain("Cardinal Books");
  // "Card" alone, a word of its own: "Cardinal Books" is no match.
  expect(listed).not.toMatch(/\bCard\b/);
});

test("the boot job forgets the merchant Card a release made of CARD dd/mm labels", async ({
  app,
  user,
}) => {
  const { owner } = await withStatement(app.baseURL, user, "cyd.cards");

  await asBeforeCardLabels(owner);

  expect(await run(rereadMerchants(owner))).toEqual({
    forgotten: 1,
    merged: 0,
    merchants: 2,
    aliases: 2,
  });

  // "Card" is gone, each shop has its merchant, and the shop named "Cardinal…" is as it was.
  expect(await merchantsOf(owner)).toEqual([
    "Cardinal Books: CARDINAL BOOKS",
    "Freshmart: FRESHMART",
    "Pizza Nova: PIZZA NOVA",
  ]);

  expect((await run(lineMerchant(owner, await lineOf(owner, PIZZA)))).merchant?.name).toBe(
    "Pizza Nova",
  );

  // Once per user: the next boot finds the user marked, and forgets nothing.
  expect(await run(rereadMerchants(owner))).toEqual({
    forgotten: 0,
    merged: 0,
    merchants: 0,
    aliases: 0,
  });
});

test("a merchant Card the user renamed stays at the boot", async ({ app, user }) => {
  const { owner } = await withStatement(app.baseURL, user, "dov.cards");

  await asBeforeCardLabels(owner);

  const [card] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: merchant.id }).from(merchant).where(eq(merchant.name, "Card")),
  );

  await run(
    Effect.gen(function* () {
      const merchants = yield* Merchants;

      return yield* merchants.rename(owner, card?.id ?? "", "Card Payments");
    }),
  );

  expect((await run(rereadMerchants(owner))).forgotten).toBe(0);

  // The user's merchant stays as they left it; the lines, whose cleaned label changed, name their
  // shops.
  expect(await merchantsOf(owner)).toEqual([
    "Card Payments: CARD",
    "Cardinal Books: CARDINAL BOOKS",
    "Freshmart: FRESHMART",
    "Pizza Nova: PIZZA NOVA",
  ]);
});
