import type { Page } from "@playwright/test";
import { merchantKey } from "@gousset/core";
import {
  account,
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import type { Client } from "@modelcontextprotocol/client";
import { and, eq, isNull } from "drizzle-orm";

import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #32 through the MCP door: `month` `summary`, `spending` and `days` read the user's own
// month, through the official MCP client and the real OAuth flow, against the built app and a real
// Postgres. Each user is the file's own, their rows written as the app writes them: a salary, two
// grocery runs at a market a month apart, a payment still in "Other" waiting to be reviewed, a
// transfer to a savings account. Every name and amount is invented.
//
// The MCP door reads today from the server's clock (a client sends no cookie): the rows are written
// in the two months before the current one, so that they read the same whenever the test runs.

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** The month `offset` months from the current one, `YYYY-MM`, as the server's clock reads it. */
function monthFromNow(offset: number): string {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

const LAST_MONTH = monthFromNow(-1);
const TWO_MONTHS_AGO = monthFromNow(-2);

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: string | boolean };

async function callTool(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** A top-level category of the user's, of the defaults they were given. */
async function categoryNamed(
  transaction: UserTransaction,
  kind: "expense" | "income",
  name: string,
) {
  const [found] = await transaction
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.kind, kind), eq(category.name, name), isNull(category.parentId)));

  if (found === undefined) {
    throw new Error(`No ${kind} category named ${name}.`);
  }

  return found.id;
}

/**
 * The user's month, as the app writes it: each line counted with its entry, the transfer's two
 * sides with none.
 */
function seedMonth(owner: string) {
  return data.asUser(owner, async (transaction) => {
    const [everyday, savings] = await transaction
      .insert(account)
      .values([
        { userId: owner, name: "Everyday account", kind: "current", currency: "EUR" },
        { userId: owner, name: "Rainy-day savings", kind: "savings", currency: "EUR" },
      ])
      .returning({ id: account.id });

    if (everyday === undefined || savings === undefined) {
      throw new Error("The accounts were not made.");
    }

    const groceries = await categoryNamed(transaction, "expense", "Groceries");
    const other = await categoryNamed(transaction, "expense", "Other");
    const salary = await categoryNamed(transaction, "income", "Salary");

    const [market] = await transaction
      .insert(merchant)
      .values({ userId: owner, name: "Greenmarket" })
      .returning({ id: merchant.id });

    if (market === undefined) {
      throw new Error("The merchant was not made.");
    }

    await transaction.insert(merchantAlias).values({
      userId: owner,
      merchantId: market.id,
      alias: merchantKey("GREENMARKET", null) ?? "GREENMARKET",
    });

    const line = async (
      accountId: string,
      bookedOn: string,
      amountMinor: number,
      label: string,
    ) => {
      const [made] = await transaction
        .insert(statementLine)
        .values({ userId: owner, accountId, source: "manual", bookedOn, amountMinor, label })
        .returning({ id: statementLine.id });

      if (made === undefined) {
        throw new Error("The line was not made.");
      }

      return made.id;
    };

    /** A line and its one entry; classified by the user unless said otherwise. */
    const classified = async (
      kind: "expense" | "income",
      categoryId: string,
      bookedOn: string,
      amountMinor: number,
      label: string,
      classifiedBy: "default" | "user" = "user",
    ) => {
      const lineId = await line(everyday.id, bookedOn, amountMinor, label);

      const [made] = await transaction
        .insert(entry)
        .values({ userId: owner, kind, happenedOn: bookedOn, categoryId, classifiedBy })
        .returning({ id: entry.id });

      if (made === undefined) {
        throw new Error("The entry was not made.");
      }

      await transaction.insert(entryPart).values({
        userId: owner,
        entryId: made.id,
        lineId,
        role: "payment",
        amountMinor: Math.abs(amountMinor),
      });
    };

    await classified("expense", groceries, `${TWO_MONTHS_AGO}-10`, -12_000, "GREENMARKET");
    await classified("income", salary, `${LAST_MONTH}-01`, 200_000, "ACME PAYROLL");
    await classified("expense", groceries, `${LAST_MONTH}-12`, -8000, "GREENMARKET");
    await classified("expense", other, `${LAST_MONTH}-18`, -1500, "CARD 4417 KIOSK", "default");

    await transaction.insert(transfer).values({
      userId: owner,
      outLineId: await line(everyday.id, `${LAST_MONTH}-05`, -50_000, "TO SAVINGS"),
      inLineId: await line(savings.id, `${LAST_MONTH}-05`, 50_000, "FROM EVERYDAY"),
      pairedBy: "user",
    });
  });
}

/** A user of the file's own, signed in on `page`, with their month seeded unless `empty`. */
async function personWithMonth(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  local: string,
  empty = false,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));

  if (!empty) {
    await seedMonth(await data.ownerOf(person.email));
  }

  await page.context().addCookies([...person.cookies]);

  return person;
}

test("month summary reads the user's own month", async ({ page, app, user, mcpClientId }) => {
  await personWithMonth(page, app, user, "solene");

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const { text, isError } = await callTool(client, "month", {
    action: "summary",
    month: LAST_MONTH,
  });

  expect(isError, text).toBe(false);
  expect(text).toContain(`The month ${LAST_MONTH}, in EUR`);
  expect(text).toContain("Received 2,000.00 EUR, from Salary 2,000.00 EUR.");
  expect(text).toContain("Spent 95.00 EUR; average 120.00 EUR; previous month 120.00 EUR.");
  expect(text).toContain("Set aside 500.00 EUR (net, onto savings and investment accounts).");
  expect(text).toContain("Left 1,405.00 EUR.");
  expect(text).toContain(
    `- ${LAST_MONTH}-05, transfer: Everyday account → Rainy-day savings, 500.00 EUR`,
  );
  expect(text).toContain(
    `- ${LAST_MONTH}-01, income: ACME PAYROLL → Everyday account, 2,000.00 EUR (Salary)`,
  );
  expect(text).toContain("Lines to review: 1 booked in the month");
  expect(text).toContain(
    `- ${LAST_MONTH}-18, Everyday account: "CARD 4417 KIOSK", -15.00 EUR, in Other`,
  );

  expect(text).toContain(
    'List them with their proposals, to accept or correct each: review {"action":"list"} (every month\'s, newest first).',
  );

  // The call it writes lists the line to review, from #35's review queue.
  const listed = await callTool(client, "review", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain("CARD 4417 KIOSK");

  // A month to come is refused, with a valid call.
  const toCome = await callTool(client, "month", { action: "summary", month: monthFromNow(1) });

  expect(toCome.isError).toBe(true);
  expect(toCome.text).toContain("is a month to come");
});

test("month spending by category and merchant against the average and the previous month", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  await personWithMonth(page, app, user, "tristan");

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const byCategory = await callTool(client, "month", { action: "spending", month: LAST_MONTH });

  expect(byCategory.isError, byCategory.text).toBe(false);
  expect(byCategory.text).toContain(
    `Where the money went in ${LAST_MONTH}, by category, in EUR, each at its net cost: averages over 1 month(s) of ${monthFromNow(-7)} to ${TWO_MONTHS_AGO}; the previous month is ${TWO_MONTHS_AGO}.`,
  );
  expect(byCategory.text).toContain(
    "\n- Groceries: spent 80.00 EUR; average 120.00 EUR; previous month 120.00 EUR; benchmark 120.00 EUR (automatic)\n",
  );
  expect(byCategory.text).toContain(
    "\n- Other: spent 15.00 EUR; average 0.00 EUR; previous month 0.00 EUR",
  );

  const byMerchant = await callTool(client, "month", {
    action: "spending",
    by: "merchant",
    month: LAST_MONTH,
  });

  expect(byMerchant.isError, byMerchant.text).toBe(false);
  expect(byMerchant.text).toContain(
    "\n- Greenmarket: spent 80.00 EUR; average 120.00 EUR; previous month 120.00 EUR",
  );
  expect(byMerchant.text).toContain("\n- no merchant: spent 15.00 EUR");
});

test("month days follows a category day by day", async ({ page, app, user, mcpClientId }) => {
  await personWithMonth(page, app, user, "ulysse");

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const { text, isError } = await callTool(client, "month", {
    action: "days",
    month: LAST_MONTH,
    name: "groceries",
  });

  expect(isError, text).toBe(false);
  expect(text).toContain(`Groceries (category) in ${LAST_MONTH}, in EUR`);
  expect(text).toContain(`${LAST_MONTH}-09: 0.00 EUR; previous month 0.00 EUR`);
  expect(text).toContain(`${LAST_MONTH}-11: 0.00 EUR; previous month 120.00 EUR`);
  expect(text).toContain(`${LAST_MONTH}-12: 80.00 EUR; previous month 120.00 EUR`);

  const unknown = await callTool(client, "month", {
    action: "days",
    month: LAST_MONTH,
    name: "Gardening",
  });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('is named "Gardening"');
});

test("another user's month is never read", async ({ page, app, user, mcpClientId }) => {
  // Valentin's month is seeded; Wanda has nothing, and reads only her own.
  await personWithMonth(page, app, user, "valentin");
  await page.context().clearCookies();
  await personWithMonth(page, app, user, "wanda", true);

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const summary = await callTool(client, "month", { action: "summary", month: LAST_MONTH });

  expect(summary.isError, summary.text).toBe(false);
  expect(summary.text).toContain("Received 0.00 EUR.");
  expect(summary.text).toContain("Spent 0.00 EUR");
  expect(summary.text).toContain("Set aside 0.00 EUR");
  expect(summary.text).toContain("No line of the month waits to be reviewed.");

  for (const theirs of ["2,000.00", "ACME PAYROLL", "Everyday account", "Rainy-day", "KIOSK"]) {
    expect(summary.text).not.toContain(theirs);
  }

  const merchants = await callTool(client, "month", {
    action: "spending",
    by: "merchant",
    month: LAST_MONTH,
  });

  expect(merchants.text).not.toContain("Greenmarket");

  const days = await callTool(client, "month", {
    action: "days",
    month: LAST_MONTH,
    name: "Groceries",
  });

  expect(days.isError, days.text).toBe(false);
  expect(days.text).toContain(`${LAST_MONTH}-12: 0.00 EUR`);
  expect(days.text).not.toContain("80.00");
});
