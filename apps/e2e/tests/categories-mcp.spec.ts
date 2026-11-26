import type { Page } from "@playwright/test";
import { authUser } from "@gousset/db/schema/auth";
import type { Client } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";

import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #23's MCP scenarios: the `categories` tool and `lines classify`, through the official MCP
// client and the real OAuth flow, on the worker's user, who has the default set from sign-up and
// the made-up lines, each in its kind's fallback ("Other"). Every category a test makes has a name
// of its own, and every line it classifies is one still in "Other", read from the result: other
// tests of the worker use the same user.

let data: ReturnType<typeof openUserData>;

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  await data.seed(await data.ownerOf(user.email));
});

test.afterAll(async () => {
  await data.close();
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: string | number | boolean };

/** The text of a tool's answer, and whether it is an error. */
async function callTool(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** A name no other test gives. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 6)}`;

/** The handles of `count` expenses still in the fallback, as a search gives them. */
async function expensesInOther(client: Client, count: number): Promise<Array<string>> {
  const { text, isError } = await callTool(client, "lines", { action: "search", limit: 100 });

  expect(isError, text).toBe(false);

  const handles = [
    ...text.matchAll(/: -[\d,]+\.\d\d [A-Z]{3}, ".*", in Other; line: (\S+)$/gm),
  ].map(([, handle]) => handle ?? "");

  expect(handles.length, text).toBeGreaterThanOrEqual(count);

  return handles.slice(0, count);
}

async function categoryOf(client: Client, line: string): Promise<string> {
  const { text, isError } = await callTool(client, "lines", { action: "show", line });

  expect(isError, text).toBe(false);

  return /^Category: (.+)$/m.exec(text)?.[1] ?? "";
}

async function writer({
  userPage,
  baseURL,
  mcpClientId,
}: {
  userPage: Page;
  baseURL: string | undefined;
  mcpClientId: string;
}): Promise<Client> {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  return session.client;
}

test("an MCP client lists the default categories, two levels per kind, with the fallback", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  expect(session.client.getInstructions()).toContain("`categories`");

  const { text, isError } = await callTool(session.client, "categories", { action: "list" });

  expect(isError, text).toBe(false);
  expect(text).toMatch(
    /\nExpense categories:\n- Housing: \d+ entr(y|ies); benchmark: the six-month average;/,
  );
  expect(text).toMatch(/\n {2}- Rent: \d+ entr/);
  expect(text).toMatch(/\n {2}- Supermarket: \d+ entr/);
  expect(text).toMatch(/\n- Other \(fallback: unclassified lines go here\): \d+ entr/);
  expect(text).toMatch(/\nIncome categories:\n- Salary: \d+ entr/);
  expect(text).toMatch(/monthly average from \d{4}-\d\d-01 to \d{4}-\d\d-\d\d/);
});

test("creating a category under a child is refused: a third level", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const name = unique("Deposit");

  const refused = await callTool(client, "categories", {
    action: "create",
    name,
    parent: "Housing > Rent",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("Categories have two levels");
  expect(refused.text).toContain('"Housing > Rent" is a child, under "Housing"');
  expect(refused.text).toMatch(
    /\nA valid call: categories \{"action":"create",.*"parent":"Housing"\}$/,
  );
  expect(refused.text.length).toBeLessThan(2000);

  const { text } = await callTool(client, "categories", { action: "list" });

  expect(text).not.toContain(name);

  // Under the top-level category, as the refusal says, it is made.
  const made = await callTool(client, "categories", { action: "create", name, parent: "Housing" });

  expect(made.isError, made.text).toBe(false);
  expect(made.text).toContain(`Created the expense category "Housing > ${name}"`);
});

test("merging a category moves every expense into the other", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const merged = unique("Coffee");
  const into = unique("Drinks");

  for (const name of [merged, into]) {
    const made = await callTool(client, "categories", { action: "create", name });

    expect(made.isError, made.text).toBe(false);
  }

  const lines = await expensesInOther(client, 2);

  for (const line of lines) {
    const placed = await callTool(client, "lines", { action: "classify", line, category: merged });

    expect(placed.isError, placed.text).toBe(false);
  }

  const done = await callTool(client, "categories", { action: "merge", category: merged, into });

  expect(done.isError, done.text).toBe(false);
  expect(done.text).toContain(`Merged "${merged}" into "${into}"`);

  for (const line of lines) {
    expect(await categoryOf(client, line)).toBe(`${into} (expense)`);
  }

  const { text } = await callTool(client, "categories", { action: "list" });

  expect(text).not.toContain(merged);
  expect(text).toContain(`\n- ${into}: 2 entries;`);
});

test("archiving a category keeps its history", async ({ userPage, baseURL, mcpClientId }) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const name = unique("Hobby");

  expect((await callTool(client, "categories", { action: "create", name })).isError).toBe(false);

  const [line = "", other = ""] = await expensesInOther(client, 2);

  expect(
    (await callTool(client, "lines", { action: "classify", line, category: name })).isError,
  ).toBe(false);

  const archived = await callTool(client, "categories", { action: "archive", category: name });

  expect(archived.isError, archived.text).toBe(false);
  expect(archived.text).toContain(`Archived "${name}"`);

  // The line keeps its category; the list shows it only when asked, marked.
  expect(await categoryOf(client, line)).toBe(`${name} (expense)`);
  expect((await callTool(client, "categories", { action: "list" })).text).not.toContain(name);

  const withArchived = await callTool(client, "categories", { action: "list", archived: true });

  expect(withArchived.text).toMatch(
    new RegExp(String.raw`\n- ${name} \(archived on \d{4}-\d\d-\d\d\): 1 entry;`),
  );

  // It can no longer be chosen.
  const refused = await callTool(client, "lines", {
    action: "classify",
    line: other,
    category: name,
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain(`"${name}" is archived`);

  const restored = await callTool(client, "categories", {
    action: "archive",
    category: name,
    restore: true,
  });

  expect(restored.text).toContain(`Restored "${name}"`);
});

test("a line is classified by its category's name", async ({ userPage, baseURL, mcpClientId }) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const [line = ""] = await expensesInOther(client, 1);

  const placed = await callTool(client, "lines", {
    action: "classify",
    line,
    category: "groceries > supermarket",
  });

  expect(placed.isError, placed.text).toBe(false);
  expect(placed.text).toContain("is now in Groceries > Supermarket (expense)");
  expect(await categoryOf(client, line)).toBe("Groceries > Supermarket (expense)");

  const { text } = await callTool(client, "lines", { action: "search", limit: 100 });

  expect(text).toContain(`, in Groceries > Supermarket; line: ${line}`);

  // An income category is no expense's.
  const wrong = await callTool(client, "lines", { action: "classify", line, category: "Salary" });

  expect(wrong.isError).toBe(true);
  expect(wrong.text).toContain('A valid call: categories {"action":"list"}');
});

test("lines classify by MCP as an expense with a category", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const [line = "", other = ""] = await expensesInOther(client, 2);

  const placed = await callTool(client, "lines", {
    action: "classify",
    line,
    kind: "expense",
    category: "Groceries > Bakery",
  });

  expect(placed.isError, placed.text).toBe(false);
  expect(placed.text).toContain("is now in Groceries > Bakery (expense)");
  expect(await categoryOf(client, line)).toBe("Groceries > Bakery (expense)");

  // A kind alone: the line stays in its fallback, now the user's choice, no longer to review.
  const kept = await callTool(client, "lines", {
    action: "classify",
    line: other,
    kind: "expense",
  });

  expect(kept.isError, kept.text).toBe(false);
  expect(kept.text).toContain("is now in Other (expense)");

  const { text } = await callTool(client, "lines", {
    action: "search",
    to_review: true,
    limit: 100,
  });

  expect(text).not.toContain(`line: ${other}`);

  // A side of a transfer is the transfer: it is no expense to classify.
  const transfers = await callTool(client, "lines", {
    action: "search",
    text: "sepa trf to livret a",
  });

  const side = /; line: (\S+)$/m.exec(transfers.text)?.[1] ?? "";

  const refused = await callTool(client, "lines", {
    action: "classify",
    line: side,
    kind: "expense",
    category: "Groceries",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("is a side of a transfer");
  expect(refused.text).toContain('A valid call: lines {"action":"unpair"');
});

test("a user whose currency is USD reads and sets a fixed benchmark in dollars", async ({
  page,
  app,
  user,
  baseURL,
  mcpClientId,
}) => {
  // A user of its own: the worker's user keeps euros for every other test.
  const ottilie = await addUser(app.baseURL, user, personOfItsOwn("ottilie"));
  const owner = await data.ownerOf(ottilie.email);

  // What Settings › General keeps, written as the app's role writes it.
  expect(
    await data.outside((database) =>
      database.update(authUser).set({ currency: "USD" }).where(eq(authUser.id, owner)),
    ),
  ).toBe("accepted");

  await page.context().addCookies([...ottilie.cookies]);

  const client = await writer({ userPage: page, baseURL, mcpClientId });

  const set = await callTool(client, "categories", {
    action: "edit",
    category: "Groceries",
    benchmark: "130",
  });

  expect(set.isError, set.text).toBe(false);
  expect(set.text).toContain("benchmark: 130.00 USD a month.");

  const { text } = await callTool(client, "categories", { action: "list" });

  expect(text).toMatch(/\n- Groceries: \d+ entr(y|ies); benchmark: 130\.00 USD a month;/);
});

/** The line `categories list` writes for a category, by how it starts ("- Name:", "  - Name:"). */
function listedLine(text: string, start: string): string {
  return text.split("\n").find((line) => line.startsWith(start)) ?? "";
}

test("an MCP client sets a category's colour and icon; a child is shown in its parent's colour", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const top = unique("Pets");
  const child = unique("Vet");

  const made = await callTool(client, "categories", {
    action: "create",
    name: top,
    icon: "pets",
    color: "green",
  });

  expect(made.isError, made.text).toBe(false);
  expect(made.text).toContain(`Created the expense category "${top}"`);
  expect(made.text).toContain("Shown with icon pets, colour green.");

  const under = await callTool(client, "categories", {
    action: "create",
    name: child,
    parent: top,
    icon: "doctor",
  });

  expect(under.isError, under.text).toBe(false);
  expect(under.text).toContain("Shown with icon doctor, colour green (its parent's).");

  const listed = (await callTool(client, "categories", { action: "list" })).text;

  expect(listedLine(listed, `- ${top}:`)).toMatch(/; icon pets, colour green$/);
  expect(listedLine(listed, `  - ${child}:`)).toMatch(
    /; icon doctor, colour green \(its parent's\)$/,
  );

  // The parent's new colour is the child's; the child's own one wins until cleared.
  const recoloured = await callTool(client, "categories", {
    action: "edit",
    category: top,
    color: "violet",
  });

  expect(recoloured.isError, recoloured.text).toBe(false);
  expect(recoloured.text).toContain("Shown with icon pets, colour violet.");

  const own = await callTool(client, "categories", {
    action: "edit",
    category: `${top} > ${child}`,
    color: "blue",
    icon: "pharmacy",
  });

  expect(own.isError, own.text).toBe(false);
  expect(own.text).toContain("Shown with icon pharmacy, colour blue.");

  const relisted = (await callTool(client, "categories", { action: "list" })).text;

  expect(listedLine(relisted, `- ${top}:`)).toMatch(/; icon pets, colour violet$/);
  expect(listedLine(relisted, `  - ${child}:`)).toMatch(/; icon pharmacy, colour blue$/);

  const cleared = await callTool(client, "categories", {
    action: "edit",
    category: `${top} > ${child}`,
    color: "none",
    icon: "none",
  });

  expect(cleared.isError, cleared.text).toBe(false);
  expect(cleared.text).toContain("Shown with no icon, colour violet (its parent's).");

  const last = (await callTool(client, "categories", { action: "list" })).text;

  expect(listedLine(last, `  - ${child}:`)).toMatch(/; no icon, colour violet \(its parent's\)$/);
});

test("a colour off the palette is refused, with the palette and a valid call", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const client = await writer({ userPage, baseURL, mcpClientId });
  const name = unique("Plants");

  const refused = await callTool(client, "categories", {
    action: "create",
    name,
    icon: "garden",
    color: "gray",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('"gray" is no colour of Gousset\'s palette');
  expect(refused.text).toContain(
    "red, orange, amber, olive, green, teal, cyan, blue, indigo, violet, pink, grey",
  );
  expect(refused.text).toMatch(
    /\nA valid call: categories \{"action":"create",.*"color":"blue"\}$/,
  );
  expect(refused.text.length).toBeLessThan(2000);
  expect((await callTool(client, "categories", { action: "list" })).text).not.toContain(name);

  // With a colour of the palette, as the refusal says, it is made.
  const made = await callTool(client, "categories", {
    action: "create",
    name,
    icon: "garden",
    color: "grey",
  });

  expect(made.isError, made.text).toBe(false);
  expect(made.text).toContain("Shown with icon garden, colour grey.");
});

test("a read-only token's write is refused, saying how to get write", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const name = unique("Read only");

  const create = await callTool(session.client, "categories", { action: "create", name });

  expect(create.isError).toBe(true);
  expect(create.text).toContain("choose Read and write on Gousset's consent page");

  const [line = ""] = await expensesInOther(session.client, 1);

  const classify = await callTool(session.client, "lines", {
    action: "classify",
    line,
    category: "Groceries",
  });

  expect(classify.isError).toBe(true);
  expect(classify.text).toContain("choose Read and write on Gousset's consent page");
  expect(await categoryOf(session.client, line)).toBe("Other (expense)");

  // Reading still answers, and nothing was made.
  const { text, isError } = await callTool(session.client, "categories", { action: "list" });

  expect(isError).toBe(false);
  expect(text).not.toContain(name);
});
