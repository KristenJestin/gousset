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

// Issue #193, "How to verify": a card label's trailing town is no part of its merchant. An invented
// statement with one shop in two towns shows one merchant, in the browser and through the MCP door;
// the towns are known from the statement's own card labels (other shops paid in both), and a shop
// whose name ends in a place word that is no town keeps it. And the boot job, once per user made
// before: the merchants a release before made one per town go into one when the user never touched
// them; those the user renamed or split stay, and so does a split made now. Each test has a user of
// its own. Every shop, town, label and amount is invented.

const TODAY = "2026-11-15";

const PIZZA_RIVERTON = "CARTE X1234 03/10 PIZZA NOVA RIVERTON";
const PIZZA_LAKESIDE = "CARTE X1234 17/10 PIZZA NOVA LAKESIDE";

/** One shop in two towns, two other shops paid in both, and a café named after a place. */
const LINES: ReadonlyArray<Omit<StatementLine, "reference">> = [
  { bookedOn: "2026-10-03", amountMinor: -2450, label: PIZZA_RIVERTON },
  { bookedOn: "2026-10-17", amountMinor: -1890, label: PIZZA_LAKESIDE },
  { bookedOn: "2026-10-04", amountMinor: -6120, label: "CARTE X1234 04/10 FRESHMART RIVERTON" },
  { bookedOn: "2026-10-18", amountMinor: -3375, label: "CARTE X1234 18/10 FRESHMART LAKESIDE" },
  { bookedOn: "2026-10-06", amountMinor: -1500, label: "CARTE X1234 06/10 BOOKMILL RIVERTON" },
  { bookedOn: "2026-10-19", amountMinor: -990, label: "CARTE X1234 19/10 BOOKMILL LAKESIDE" },
  { bookedOn: "2026-10-09", amountMinor: -420, label: "CARTE X1234 09/10 CAFE DU PORT" },
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
    lines: LINES.map((line, index) => ({ ...line, reference: `TOWN-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, "riverton-2026-10.ofx"),
  );

  expect(done.status).toBe("done");

  return { person, owner };
}

/** The user's merchants, by name, each with its cleaned labels. */
async function merchantsOf(owner: string) {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ name: merchant.name, alias: merchantAlias.alias })
      .from(merchant)
      .leftJoin(merchantAlias, eq(merchantAlias.merchantId, merchant.id))
      .orderBy(asc(merchant.name), asc(merchantAlias.alias)),
  );

  return rows.map((row) => `${row.name}: ${row.alias ?? ""}`);
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

test("an invented statement with one shop in two towns shows one merchant", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await withStatement(app.baseURL, user, "tobin.towns");

  expect(await merchantsOf(owner)).toEqual([
    "Bookmill: BOOKMILL LAKESIDE",
    "Bookmill: BOOKMILL RIVERTON",
    "Cafe Du Port: CAFE DU PORT",
    "Freshmart: FRESHMART LAKESIDE",
    "Freshmart: FRESHMART RIVERTON",
    "Pizza Nova: PIZZA NOVA LAKESIDE",
    "Pizza Nova: PIZZA NOVA RIVERTON",
  ]);

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, "/settings/merchants");

  const merchants = page.getByRole("list", { name: "Merchants" }).getByRole("link");

  await expect(merchants).toHaveCount(4);
  await expect(merchants.filter({ hasText: "Pizza Nova" })).toHaveAccessibleName(
    /^Pizza Nova 2 labels/,
  );
  await expect(merchants.filter({ hasText: "Freshmart" })).toHaveAccessibleName(
    /^Freshmart 2 labels/,
  );
  await expect(merchants.filter({ hasText: "Cafe Du Port" })).toHaveAccessibleName(
    /^Cafe Du Port 1 label/,
  );
});

const allowRead = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

async function callTool(client: Client, name: string, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return first?.type === "text" ? first.text : "";
}

test("an MCP client reads one merchant for the shop in two towns", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  const { person } = await withStatement(app.baseURL, user, "ulla.towns");

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
  expect(listed).toContain("Cafe Du Port");
  expect(listed).not.toContain("Pizza Nova Riverton");
  expect(listed).not.toContain("Pizza Nova Lakeside");
  expect(listed).not.toContain("Freshmart Lakeside");
});

test("the boot job merges the merchants a release made per town, unless the user touched them", async ({
  app,
  user,
}) => {
  const { owner } = await withStatement(app.baseURL, user, "vera.towns");

  // As a release before left them, recognition writing each merchant with its cleaned label in one
  // transaction: one merchant per town, one of them renamed by the user.
  await data.asUser(owner, async (transaction) => {
    await transaction.delete(merchant);

    const made = await transaction
      .insert(merchant)
      .values([
        { userId: owner, name: "Pizza Nova Riverton" },
        { userId: owner, name: "Pizza Nova Lakeside" },
        { userId: owner, name: "Freshmart Riverton" },
        { userId: owner, name: "Freshmart By The Lake" },
        { userId: owner, name: "Bookmill Riverton" },
        { userId: owner, name: "Cafe Du Port" },
      ])
      .returning({ id: merchant.id, name: merchant.name });

    const id = (name: string) => made.find((each) => each.name === name)?.id ?? "";

    await transaction.insert(merchantAlias).values([
      { userId: owner, merchantId: id("Pizza Nova Riverton"), alias: "PIZZA NOVA RIVERTON" },
      { userId: owner, merchantId: id("Pizza Nova Lakeside"), alias: "PIZZA NOVA LAKESIDE" },
      { userId: owner, merchantId: id("Freshmart Riverton"), alias: "FRESHMART RIVERTON" },
      { userId: owner, merchantId: id("Freshmart By The Lake"), alias: "FRESHMART LAKESIDE" },
      { userId: owner, merchantId: id("Bookmill Riverton"), alias: "BOOKMILL RIVERTON" },
      { userId: owner, merchantId: id("Bookmill Riverton"), alias: "BOOKMILL LAKESIDE" },
      { userId: owner, merchantId: id("Cafe Du Port"), alias: "CAFE DU PORT" },
    ]);
  });

  // Later, as a release before split it: Bookmill's Lakeside label moved into a merchant of its own,
  // named as recognition would name it, neither merchant marked as changed.
  await data.asUser(owner, async (transaction) => {
    const [split] = await transaction
      .insert(merchant)
      .values({ userId: owner, name: "Bookmill Lakeside" })
      .returning({ id: merchant.id });

    await transaction
      .update(merchantAlias)
      .set({ merchantId: split?.id ?? "" })
      .where(eq(merchantAlias.alias, "BOOKMILL LAKESIDE"));
  });

  await data.madeBeforeTowns(owner);

  expect(await run(rereadMerchants(owner))).toEqual({
    forgotten: 0,
    merged: 1,
    merchants: 0,
    aliases: 0,
  });

  // The pizzeria's two merchants are one, named after the shop. Freshmart's, one of them renamed,
  // and Bookmill's, split, stay as they are.
  expect(await merchantsOf(owner)).toEqual([
    "Bookmill Lakeside: BOOKMILL LAKESIDE",
    "Bookmill Riverton: BOOKMILL RIVERTON",
    "Cafe Du Port: CAFE DU PORT",
    "Freshmart By The Lake: FRESHMART LAKESIDE",
    "Freshmart Riverton: FRESHMART RIVERTON",
    "Pizza Nova: PIZZA NOVA LAKESIDE",
    "Pizza Nova: PIZZA NOVA RIVERTON",
  ]);

  const lakeside = await lineOf(owner, PIZZA_LAKESIDE);

  expect((await run(lineMerchant(owner, lakeside))).merchant?.name).toBe("Pizza Nova");

  // The boot's rename is not the user's: the merchant still reads as never changed.
  const [renamed] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ createdAt: merchant.createdAt, updatedAt: merchant.updatedAt })
      .from(merchant)
      .where(eq(merchant.name, "Pizza Nova")),
  );

  expect(renamed?.updatedAt.getTime()).toBe(renamed?.createdAt.getTime());

  // Once per user: the next boot finds the user marked, and merges nothing.
  expect(await run(rereadMerchants(owner))).toEqual({
    forgotten: 0,
    merged: 0,
    merchants: 0,
    aliases: 0,
  });
});

test("a shop the user split by town stays split at the boot", async ({ app, user }) => {
  const { owner } = await withStatement(app.baseURL, user, "wren.towns");

  const [pizza] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: merchant.id }).from(merchant).where(eq(merchant.name, "Pizza Nova")),
  );

  // The user keeps the Lakeside pizzeria apart: its label moves into a merchant of its own.
  await run(
    Effect.gen(function* () {
      const merchants = yield* Merchants;

      return yield* merchants.moveAlias(
        owner,
        pizza?.id ?? "",
        "PIZZA NOVA LAKESIDE",
        "Pizza Nova Lakeside",
      );
    }),
  );

  await data.madeBeforeTowns(owner);

  expect((await run(rereadMerchants(owner))).merged).toBe(0);
  expect(await merchantsOf(owner)).toContain("Pizza Nova Lakeside: PIZZA NOVA LAKESIDE");
  expect(await merchantsOf(owner)).toContain("Pizza Nova: PIZZA NOVA RIVERTON");
});
