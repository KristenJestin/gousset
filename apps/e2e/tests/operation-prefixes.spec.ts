import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { lineMerchant, merchantsLayer, rereadMerchants } from "@gousset/core";
import type { Merchants } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import {
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import type { TestUser } from "../src/auth";
import { lineDetail } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { addUser, connectMcp, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #194, "How to verify": a label's operation prefix says what the line is, never its
// merchant. An invented statement with a payment and its cancellation shows one merchant, the
// cancellation proposed as a refund, in the browser and through the MCP door; a loan's instalment,
// a fee and interest make no merchant. And the boot job's re-read: the merchants a release before
// made from such labels go when the user never touched them, the others stay. Each test has a user
// of its own. Every shop, label and amount is invented.

const TODAY = "2026-11-15";

const PAYMENT = "CB SHOPLY 1010 RIVERTON";
const CANCELLATION = "ANN CARTE SHOPLY 1210 RIVERTON";

/** A card payment, its cancellation, and lines whose prefix names no one. */
const LINES: ReadonlyArray<Omit<StatementLine, "reference">> = [
  { bookedOn: "2026-10-10", amountMinor: -3000, label: PAYMENT },
  { bookedOn: "2026-10-12", amountMinor: 3000, label: CANCELLATION },
  { bookedOn: "2026-10-05", amountMinor: -52_000, label: "ECH PRET 0000001" },
  { bookedOn: "2026-10-06", amountMinor: -400, label: "F COTISATION CARTE" },
  { bookedOn: "2026-10-07", amountMinor: -200, label: "FRAIS TENUE DE COMPTE" },
  { bookedOn: "2026-10-31", amountMinor: 120, label: "INTERETS" },
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
    lines: LINES.map((line, index) => ({ ...line, reference: `PREFIX-${index + 1}` })),
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

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

test("a payment and its cancellation show one merchant, the cancellation as a refund", async ({
  page,
  app,
  user,
}) => {
  const { person } = await withStatement(app.baseURL, user, "nell.prefixes");

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  // One merchant: the shop. The cancellation, the loan, the fee and the interest make none.
  await visit(page, "/settings/merchants");

  const merchants = page.getByRole("list", { name: "Merchants" }).getByRole("link");

  await expect(merchants).toHaveCount(1);
  await expect(merchants.first()).toHaveAccessibleName(/^Shoply 1 label/);

  // The cancellation is proposed as a refund of the payment it cancels.
  await visit(page, "/operations?q=shoply");
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
  await rows(page).filter({ hasText: CANCELLATION }).first().getByRole("button").click();

  const cancelled = lineDetail(page, CANCELLATION);

  await expect(cancelled).toBeVisible();

  const proposal = cancelled.getByRole("region", { name: "Maybe a refund" });

  await expect(proposal).toContainText(PAYMENT);
  await expect(proposal).toContainText("Other · costs €30.00");
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

async function callTool(client: Client, name: string, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return first?.type === "text" ? first.text : "";
}

test("an MCP client reads the cancellation as a refund at the shop, and no merchant of a prefix", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  const { person } = await withStatement(app.baseURL, user, "odile.prefixes");

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const listed = await callTool(client, "merchants", { action: "list" });

  expect(listed).toContain("Shoply");
  expect(listed).not.toContain("Ann Carte");
  expect(listed).not.toContain("Ech Pret");
  expect(listed).not.toContain("Cotisation");
  expect(listed).not.toContain("Interets");
  expect(listed).not.toContain("Frais");

  const found = await callTool(client, "lines", { action: "search", text: "ann carte shoply" });
  const [handle] = [...found.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id ?? "");
  const shown = await callTool(client, "lines", { action: "show", line: handle ?? "" });

  expect(shown).toContain("Maybe a refund: this line may cancel all or part of an expense");
  expect(shown).toContain("costing 30.00 EUR");
});

test("a fee and interest go to the categories of their operation, still to review; a loan stays in Other", async ({
  app,
  user,
}) => {
  const { owner } = await withStatement(app.baseURL, user, "quinn.prefixes");
  const parent = alias(category, "parent");

  const classified = await data.asUser(owner, (transaction) =>
    transaction
      .select({
        label: statementLine.label,
        category: category.name,
        parent: parent.name,
        classifiedBy: entry.classifiedBy,
      })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .innerJoin(category, eq(category.id, entry.categoryId))
      .leftJoin(parent, eq(parent.id, category.parentId))
      .orderBy(asc(statementLine.label)),
  );

  expect(
    classified.map(
      (row) => `${row.label}: ${row.parent ?? ""} > ${row.category}, ${row.classifiedBy}`,
    ),
  ).toEqual([
    `${CANCELLATION}:  > Other, default`,
    `${PAYMENT}:  > Other, default`,
    "ECH PRET 0000001:  > Other, default",
    "F COTISATION CARTE: Fees and taxes > Bank fees, default",
    "FRAIS TENUE DE COMPTE: Fees and taxes > Bank fees, default",
    "INTERETS: Investment income > Interest, default",
  ]);
});

test("the boot job forgets the merchants a release made from a prefix, unless the user touched them", async ({
  app,
  user,
}) => {
  const { owner } = await withStatement(app.baseURL, user, "pia.prefixes");

  const [anyCategory] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: category.id }).from(category).where(eq(category.kind, "expense")),
  );

  // The merchants v0.3 made from these labels' former keys: two the user never touched, one given
  // a default category, one renamed, one set by hand on its line's entry.
  const made = await data.asUser(owner, async (transaction) => {
    const merchants = await transaction
      .insert(merchant)
      .values([
        { userId: owner, name: "Ann Carte Shoply" },
        { userId: owner, name: "F Cotisation" },
        { userId: owner, name: "Ech Pret", defaultCategoryId: anyCategory?.id ?? null },
        { userId: owner, name: "Account Fees" },
        { userId: owner, name: "Interets" },
      ])
      .returning({ id: merchant.id, name: merchant.name });

    const idOf = (name: string) => merchants.find((each) => each.name === name)?.id ?? "";

    await transaction.insert(merchantAlias).values([
      { userId: owner, merchantId: idOf("Ann Carte Shoply"), alias: "ANN CARTE SHOPLY" },
      { userId: owner, merchantId: idOf("F Cotisation"), alias: "F COTISATION" },
      { userId: owner, merchantId: idOf("Ech Pret"), alias: "ECH PRET" },
      { userId: owner, merchantId: idOf("Account Fees"), alias: "FRAIS TENUE DE COMPTE" },
      { userId: owner, merchantId: idOf("Interets"), alias: "INTERETS" },
    ]);

    return idOf;
  });

  // The interest's entry was set to its merchant by hand.
  const interest = await lineOf(owner, "INTERETS");

  await data.asUser(owner, async (transaction) => {
    const [part] = await transaction
      .select({ entryId: entryPart.entryId })
      .from(entryPart)
      .where(eq(entryPart.lineId, interest));

    await transaction
      .update(entry)
      .set({ merchantId: made("Interets"), classifiedBy: "user" })
      .where(eq(entry.id, part?.entryId ?? ""));
  });

  const reread = await run(rereadMerchants(owner));

  expect(reread).toEqual({ forgotten: 2, merchants: 0, aliases: 0 });
  expect(await merchantsOf(owner)).toEqual([
    "Account Fees: FRAIS TENUE DE COMPTE",
    "Ech Pret: ECH PRET",
    "Interets: INTERETS",
    "Shoply: SHOPLY",
  ]);

  // The cancellation's merchant is the shop's.
  const cancellation = await lineOf(owner, CANCELLATION);

  expect((await run(lineMerchant(owner, cancellation))).merchant?.name).toBe("Shoply");

  // Run again, it finds nothing to do.
  expect(await run(rereadMerchants(owner))).toEqual({ forgotten: 0, merchants: 0, aliases: 0 });
});

test("the boot job moves a fee still in Other into Bank fees, with no new label to recognise", async ({
  app,
  user,
}) => {
  const { owner } = await withStatement(app.baseURL, user, "rhea.prefixes");
  const fee = await lineOf(owner, "F COTISATION CARTE");

  // As a release before left it: the fee in Other, classified by default, before the marks.
  const placed = await data.asUser(owner, async (transaction) => {
    const [other] = await transaction
      .select({ id: category.id })
      .from(category)
      .where(
        and(eq(category.kind, "expense"), eq(category.name, "Other"), isNull(category.parentId)),
      );

    const [part] = await transaction
      .select({ entryId: entryPart.entryId })
      .from(entryPart)
      .where(eq(entryPart.lineId, fee));

    await transaction
      .update(entry)
      .set({ categoryId: other?.id ?? "", classifiedBy: "default" })
      .where(eq(entry.id, part?.entryId ?? ""));

    return part?.entryId ?? "";
  });

  // Every label names a merchant already: the re-read recognises nothing new.
  expect(await run(rereadMerchants(owner))).toEqual({ forgotten: 0, merchants: 0, aliases: 0 });

  const [moved] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ category: category.name, classifiedBy: entry.classifiedBy })
      .from(entry)
      .innerJoin(category, eq(category.id, entry.categoryId))
      .where(eq(entry.id, placed)),
  );

  expect(moved).toEqual({ category: "Bank fees", classifiedBy: "default" });
});
