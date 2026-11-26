import type { Page } from "@playwright/test";
import { createSubject, merchantKey } from "@gousset/core";
import {
  account,
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import type { Client } from "@modelcontextprotocol/client";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #37 through the MCP door: the `subjects` tool, with `month` by subject and `lines` by
// subject and split between subjects, called by the official MCP client over the real OAuth flow,
// against the built app and a real Postgres. Each test has a user of its own, their lines written
// as the app writes them. Every name and amount is invented.
//
// The MCP door reads today from the server's clock: the lines are written in the two months
// before the current one, so that they read the same whenever the test runs.

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

const ERROR_LIMIT = 2000;

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: Schema.Json };

const Written = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

async function callTool(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** A top-level expense category of the user's, of the defaults they were given. */
async function expenseCategory(transaction: UserTransaction, name: string) {
  const [found] = await transaction
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.kind, "expense"), eq(category.name, name), isNull(category.parentId)));

  if (found === undefined) {
    throw new Error(`No expense category named ${name}.`);
  }

  return found.id;
}

/**
 * The user's lines, each an expense of its own as the app writes it: fuel at Fuelstop in each of
 * the two months, a market run, a lodge and a cable car for a trip, a hardware run to split.
 */
function seed(owner: string) {
  return data.asUser(owner, async (transaction) => {
    const [everyday] = await transaction
      .insert(account)
      .values({ userId: owner, name: "Everyday account", kind: "current", currency: "EUR" })
      .returning({ id: account.id });

    await transaction
      .insert(account)
      .values({ userId: owner, name: "Van loan", kind: "loan", currency: "EUR" });

    if (everyday === undefined) {
      throw new Error("The account was not made.");
    }

    const groceries = await expenseCategory(transaction, "Groceries");
    const other = await expenseCategory(transaction, "Other");

    const [station] = await transaction
      .insert(merchant)
      .values({ userId: owner, name: "Fuelstop" })
      .returning({ id: merchant.id });

    if (station === undefined) {
      throw new Error("The merchant was not made.");
    }

    await transaction.insert(merchantAlias).values({
      userId: owner,
      merchantId: station.id,
      alias: merchantKey("FUELSTOP", null) ?? "FUELSTOP",
    });

    const expense = async (
      categoryId: string,
      bookedOn: string,
      amountMinor: number,
      label: string,
    ) => {
      const [line] = await transaction
        .insert(statementLine)
        .values({
          userId: owner,
          accountId: everyday.id,
          source: "manual",
          bookedOn,
          amountMinor,
          label,
        })
        .returning({ id: statementLine.id });

      const [made] = await transaction
        .insert(entry)
        .values({
          userId: owner,
          kind: "expense",
          happenedOn: bookedOn,
          categoryId,
          classifiedBy: "user",
        })
        .returning({ id: entry.id });

      if (line === undefined || made === undefined) {
        throw new Error("The expense was not made.");
      }

      await transaction.insert(entryPart).values({
        userId: owner,
        entryId: made.id,
        lineId: line.id,
        role: "payment",
        amountMinor: Math.abs(amountMinor),
      });
    };

    await expense(other, `${TWO_MONTHS_AGO}-10`, -5200, "FUELSTOP");
    await expense(other, `${LAST_MONTH}-04`, -4500, "FUELSTOP");
    await expense(groceries, `${LAST_MONTH}-12`, -8000, "GREENMARKET");
    await expense(other, `${LAST_MONTH}-20`, -3100, "ALPINE LODGE");
    await expense(other, `${LAST_MONTH}-22`, -1900, "CABLE CAR");
    await expense(other, `${LAST_MONTH}-26`, -7500, "HARDWARE DEPOT");
  });
}

/** A user of the test's own, their lines seeded, and their MCP client connected. */
async function subjectsUser(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  mcpClientId: string,
  local: string,
  consent = allowReadAndWrite,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  await seed(owner);
  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = (name: string, args: Arguments) => callTool(client, name, args);

  /** Calls `subjects` and expects it to answer. */
  const subjects = async (args: Arguments) => {
    const answered = await call("subjects", args);

    expect(answered.isError, answered.text).toBe(false);

    return answered.text;
  };

  /** A line's handle, from a search of every line. */
  const handleOf = async (label: string) => {
    const found = await call("lines", { action: "search", text: label });

    expect(found.isError, found.text).toBe(false);

    // A row, never the header, which names the text searched too.
    const row =
      found.text.split("\n").find((line) => line.startsWith("- ") && line.includes(`"${label}"`)) ??
      "";

    const [, handle = ""] = /; line: (\S+)$/.exec(row) ?? [];

    expect(handle, found.text).not.toBe("");

    return handle;
  };

  return { owner, call, subjects, handleOf };
}

/** The id a subject's page writes after an expense of `label`. */
function expenseIdOf(text: string, label: string): string {
  const row = text.split("\n").find((line) => line.includes(`"${label}"`)) ?? "";
  const [, id = ""] = /; expense: (\S+)$/.exec(row) ?? [];

  expect(id, `${label} in ${text}`).not.toBe("");

  return id;
}

/** The call a text writes after `lead`, read back. */
function callAfter(text: string, lead: string): Arguments {
  const at = text.indexOf(lead);

  expect(at, text).toBeGreaterThan(-1);

  return Schema.decodeUnknownSync(Written)(text.slice(at + lead.length).split(/[\n;]/)[0] ?? "");
}

test("create a subject inside another, with merchants and attach_past", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { subjects } = await subjectsUser(page, app, user, mcpClientId, "corentin");

  expect(await subjects({ action: "list" })).toContain("The user has no subject yet.");
  expect(await subjects({ action: "create", name: "Vehicles" })).toContain(
    "Created the subject Vehicles.",
  );

  // The merchant by name, any case; its two past expenses attached at once.
  const made = await subjects({
    action: "create",
    name: "Van",
    parent: "vehicles",
    merchants: ["fuelstop"],
    loan: "Van loan",
    value: "12000",
    attach_past: true,
  });

  expect(made).toContain(
    "Created the subject Vehicles > Van: worth 12,000.00 EUR; bought with the loan Van loan.",
  );
  expect(made).toContain(
    'A rule "merchant is" for each of Fuelstop attaches it to their expenses to come. 2 past expense(s) of theirs attached now.',
  );

  // Its figure in the list is this year's: the two months before may straddle January.
  const listed = await subjects({ action: "list" });

  expect(listed).toContain("2 subject(s), in EUR");
  expect(listed).toMatch(/\n- Vehicles: [\d.]+ EUR in \d{4}/);
  expect(listed).toMatch(
    /\n- Vehicles > Van: [\d.]+ EUR in \d{4}.*; worth 12,000\.00 EUR; bought with the loan Van loan\n/,
  );
  expect(await subjects({ action: "show", subject: "Vehicles", period: "all" })).toContain(
    "Cost: 97.00 EUR, its subjects within counted with it, each expense once.",
  );

  // Without attach_past, the merchants' past expenses are said, and left as they are.
  const without = await subjects({ action: "create", name: "Fuel log", merchants: ["Fuelstop"] });

  expect(without).toContain(
    "Their past expenses stay as they are: 2 of them, 97.00 EUR. To attach them too: subjects ",
  );
  expect(callAfter(without, "To attach them too: subjects ")).toEqual({
    action: "edit",
    subject: "Fuel log",
    merchants: ["Fuelstop"],
    attach_past: true,
  });
});

test("show its costs, where a parent counts an expense once", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { subjects, handleOf } = await subjectsUser(page, app, user, mcpClientId, "delphine");

  await subjects({ action: "create", name: "House" });
  await subjects({ action: "create", name: "Garden shed", parent: "House" });

  // The market run on the house and on its shed: it counts once in the house.
  const market = await handleOf("GREENMARKET");

  for (const subject of ["House", "house > garden shed"]) {
    expect(await subjects({ action: "attach", subject, lines: [market] })).toContain(
      "Attached 1 expense(s)",
    );
  }

  const house = await subjects({ action: "show", subject: "House", period: "all" });

  expect(house).toContain("Subject: House. Period: all time, to ");
  expect(house).toContain(
    "Cost: 80.00 EUR, its subjects within counted with it, each expense once.",
  );
  expect(house).toContain(`By month:\n- ${LAST_MONTH}: 80.00 EUR`);
  expect(house).toContain("By category, the largest first:\n- Groceries: 80.00 EUR");
  expect(house).toContain("\n- House > Garden shed: 80.00 EUR");
  expect(house).toContain(
    `\n- ${LAST_MONTH}-12, no merchant, "GREENMARKET", in Groceries: 80.00 EUR; expense: `,
  );
  expect(house).not.toContain("Proposals");

  // Attached again, it changes nothing; taken off the shed, the house still has it.
  expect(await subjects({ action: "attach", subject: "House", lines: [market] })).toContain(
    "Attached 0 expense(s) to House; 1 already were.",
  );
  expect(
    await subjects({ action: "attach", subject: "Garden shed", lines: [market], remove: true }),
  ).toContain("Took 1 expense(s) off House > Garden shed.");
  expect(await subjects({ action: "show", subject: "House", period: "all" })).toContain(
    "\n- House > Garden shed: 0.00 EUR",
  );
});

test("a dated subject's proposals: attach confirms, decline is remembered", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { subjects } = await subjectsUser(page, app, user, mcpClientId, "eugenie");

  expect(
    await subjects({
      action: "create",
      name: "Alps 2026",
      starts_on: `${LAST_MONTH}-15`,
      ends_on: `${LAST_MONTH}-24`,
    }),
  ).toContain(`Created the subject Alps 2026: dates from ${LAST_MONTH}-15 to ${LAST_MONTH}-24.`);

  const shown = await subjects({ action: "show", subject: "Alps 2026", period: "all" });

  // Proposed, never attached unasked: nothing counts yet.
  expect(shown).toContain("Cost: 0.00 EUR");
  expect(shown).toContain(
    "Proposals: 2 expense(s) of its period attached neither to it nor to a subject within it, the oldest first. They are the user's to confirm: never attach one without the user's yes.",
  );
  expect(shown).not.toContain("HARDWARE DEPOT");
  expect(shown).not.toContain("GREENMARKET");

  const lodge = expenseIdOf(shown, "ALPINE LODGE");
  const cableCar = expenseIdOf(shown, "CABLE CAR");

  expect(callAfter(shown, "Once the user says yes: subjects ")).toEqual({
    action: "attach",
    subject: "Alps 2026",
    expenses: [lodge],
  });

  expect(await subjects({ action: "attach", subject: "Alps 2026", expenses: [lodge] })).toContain(
    "Attached 1 expense(s) to Alps 2026.",
  );
  expect(
    await subjects({ action: "attach", subject: "Alps 2026", expenses: [cableCar], decline: true }),
  ).toContain(
    "Declined 1 proposal(s) for Alps 2026: never proposed for it again, unless the user attaches one by hand.",
  );

  const after = await subjects({ action: "show", subject: "Alps 2026", period: "all" });

  expect(after).toContain("Cost: 31.00 EUR");
  expect(after).toContain("Proposals: no expense of its period waits to be attached.");
  expect(after).toContain(`"ALPINE LODGE", in Other: 31.00 EUR; expense: ${lodge}`);
  expect(after).not.toContain("CABLE CAR");

  expect(await subjects({ action: "list" })).toContain(
    `\n- Alps 2026: from ${LAST_MONTH}-15 to ${LAST_MONTH}-24: 31.00 EUR in all`,
  );
});

test("edit and a cycle refused with its example", async ({ page, app, user, mcpClientId }) => {
  const { call, subjects } = await subjectsUser(page, app, user, mcpClientId, "fabrice");

  await subjects({ action: "create", name: "Vehicles" });
  await subjects({ action: "create", name: "Van", parent: "Vehicles" });

  // Under one of its own subjects: refused, with the call that moves it to the top instead.
  const cycle = await call("subjects", {
    action: "edit",
    subject: "Vehicles",
    parent: "Vehicles > Van",
  });

  expect(cycle.isError).toBe(true);
  expect(cycle.text).toContain(
    '"Vehicles" cannot go under itself nor under one of its own subjects within',
  );
  expect(cycle.text).toContain(
    'A valid call: subjects {"action":"edit","subject":"Vehicles","parent":null}',
  );
  expect(cycle.text.length).toBeLessThan(ERROR_LIMIT);

  const renamed = await subjects({
    action: "edit",
    subject: "van",
    name: "Camper van",
    parent: null,
    value: "8500.50",
  });

  expect(renamed).toContain("Changed the subject Camper van: worth 8,500.50 EUR.");

  expect(await subjects({ action: "edit", subject: "Camper van", archived: true })).toContain(
    "Changed the subject Camper van (archived): worth 8,500.50 EUR.",
  );

  // Archived: it gets no new expense, and says how to restore it.
  const archived = await call("subjects", {
    action: "attach",
    subject: "Camper van",
    expenses: ["00000000-0000-4000-8000-000000000000"],
  });

  expect(archived.isError).toBe(true);
  expect(archived.text).toContain(
    'A valid call: subjects {"action":"edit","subject":"Camper van","archived":false}',
  );

  const taken = await call("subjects", { action: "create", name: "vehicles" });

  expect(taken.isError).toBe(true);
  expect(taken.text).toMatch(/A subject under the same parent is named "vehicles" already/i);

  const unknown = await call("subjects", { action: "show", subject: "Van" });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('No subject of the user\'s is named "Van". Close: Camper van.');
  expect(unknown.text).toContain('A valid call: subjects {"action":"show","subject":"Camper van"}');
});

test("month spending by subject", async ({ page, app, user, mcpClientId }) => {
  const { call, subjects, handleOf } = await subjectsUser(page, app, user, mcpClientId, "gaspard");

  await subjects({ action: "create", name: "Vehicles" });
  await subjects({
    action: "create",
    name: "Van",
    parent: "Vehicles",
    merchants: ["Fuelstop"],
    attach_past: true,
  });
  await subjects({ action: "create", name: "Alps 2026" });

  // The month's fuel counts for the van and for the trip, whole in each.
  await subjects({
    action: "attach",
    subject: "Alps 2026",
    lines: [await handleOf("ALPINE LODGE"), await handleOf("FUELSTOP")],
  });

  const read = await call("month", { action: "spending", by: "subject", month: LAST_MONTH });

  expect(read.isError, read.text).toBe(false);
  expect(read.text).toContain(`Where the money went in ${LAST_MONTH}, by subject, in EUR`);
  expect(read.text).toContain("these rows never add up, nor make the month's spending.");
  expect(read.text).toContain("\n- Alps 2026: spent 76.00 EUR;");
  expect(read.text).toContain("\n- Vehicles: spent 45.00 EUR;");
  expect(read.text).toContain("\n- Vehicles > Van: spent 45.00 EUR;");
  expect(read.text).toContain(
    `month {"action":"days","by":"subject","name":"Alps 2026","month":"${LAST_MONTH}"}`,
  );

  const days = await call("month", {
    action: "days",
    by: "subject",
    name: "vehicles > van",
    month: LAST_MONTH,
  });

  expect(days.isError, days.text).toBe(false);
  expect(days.text).toContain(`${LAST_MONTH}-04: 45.00 EUR`);
});

test("lines filtered by subject", async ({ page, app, user, mcpClientId }) => {
  const { call, subjects } = await subjectsUser(page, app, user, mcpClientId, "hortense");

  await subjects({ action: "create", name: "Vehicles" });
  await subjects({
    action: "create",
    name: "Van",
    parent: "Vehicles",
    merchants: ["Fuelstop"],
    attach_past: true,
  });

  // The parent finds its subjects' lines; each line names its subjects.
  const found = await call("lines", { action: "search", subject: "vehicles" });

  expect(found.isError, found.text).toBe(false);
  expect(found.text).toContain(
    "2 line(s) match: lines counted (add to_review: true for the lines to review), of expenses attached to Vehicles or to a subject within it.",
  );
  expect(found.text).toContain(
    `- ${LAST_MONTH}-04, Everyday account: -45.00 EUR, "FUELSTOP", in Other; subjects: Van; line: `,
  );
  expect(found.text).toContain(
    `- ${TWO_MONTHS_AGO}-10, Everyday account: -52.00 EUR, "FUELSTOP", in Other; subjects: Van; line: `,
  );
  expect(found.text).not.toContain("GREENMARKET");

  const [, handle = ""] = /; line: (\S+)$/m.exec(found.text) ?? [];
  const shown = await call("lines", { action: "show", line: handle });

  expect(shown.text).toContain("Subjects: Van.");

  const unknown = await call("lines", { action: "search", subject: "Vans" });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('No subject of the user\'s is named "Vans".');
  expect(unknown.text).toContain('A valid call: subjects {"action":"list"}');
});

test("a split by subject", async ({ page, app, user, mcpClientId }) => {
  const { call, subjects, handleOf } = await subjectsUser(page, app, user, mcpClientId, "ines");

  await subjects({ action: "create", name: "Van" });
  await subjects({ action: "create", name: "House" });
  await subjects({ action: "create", name: "Garden shed", parent: "House" });

  // One hardware run, shared: its van part and its shed part, each counted in its own subject.
  const split = await call("lines", {
    action: "split",
    line: await handleOf("HARDWARE DEPOT"),
    shares: [
      { category: "Other", amount: "40", subjects: ["Van"] },
      { category: "Groceries", amount: "35", subjects: ["house > garden shed"] },
    ],
  });

  expect(split.isError, split.text).toBe(false);
  expect(split.text).toContain("across 2 categories, together the whole line.");
  expect(split.text).toContain("\n- Other: 40.00 EUR; subjects: Van");
  expect(split.text).toContain("\n- Groceries: 35.00 EUR; subjects: Garden shed");

  expect(await subjects({ action: "show", subject: "Van", period: "all" })).toContain(
    "Cost: 40.00 EUR",
  );
  expect(await subjects({ action: "show", subject: "House", period: "all" })).toContain(
    "Cost: 35.00 EUR",
  );

  const unknown = await call("lines", {
    action: "split",
    line: await handleOf("HARDWARE DEPOT"),
    shares: [{ category: "Other", amount: "75", subjects: ["Garden"] }],
  });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain(
    'No subject of the user\'s is named "Garden". Close: House > Garden shed.',
  );
  expect(unknown.text).toContain('"subjects":["House > Garden shed"]');
});

test("writes refused to a read-only token", async ({ page, app, user, mcpClientId }) => {
  const { owner, call } = await subjectsUser(
    page,
    app,
    user,
    mcpClientId,
    "jacinthe",
    allowReadOnly,
  );

  // A subject the user made in Gousset: read, never changed, through this connection.
  await Effect.runPromise(createSubject(owner, { name: "Van" }).pipe(Effect.provide(data.layer)));

  const listed = await call("subjects", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain("\n- Van: 0.00 EUR in ");

  const writes = [
    ["create", { action: "create", name: "House" }],
    ["edit", { action: "edit", subject: "Van", archived: true }],
    [
      "attach",
      { action: "attach", subject: "Van", expenses: ["00000000-0000-4000-8000-000000000000"] },
    ],
  ] as const;

  for (const [action, args] of writes) {
    const refused = await call("subjects", args);

    expect(refused.isError, action).toBe(true);
    expect(refused.text, action).toContain("choose Read and write on Gousset's consent page");
  }

  expect((await call("subjects", { action: "list" })).text).not.toContain("House");
});

test("results paged with the next call written, and errors under their sizes", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(120_000);

  const { owner, call } = await subjectsUser(page, app, user, mcpClientId, "kilian");

  const subject = (input: Parameters<typeof createSubject>[1]) =>
    Effect.runPromise(createSubject(owner, input).pipe(Effect.provide(data.layer)));

  // Many subjects with long paths: the list is longer than one result.
  const parent = await subject({
    name: `Renovation of the old farmhouse ${"by the river ".repeat(5)}`.trim(),
  });

  for (let index = 0; index < 120; index += 1) {
    await subject({
      name: `Room ${String(index).padStart(3, "0")} ${"with its walls and floors ".repeat(3)}`.trim(),
      parentId: parent.id,
    });
  }

  const first = await call("subjects", { action: "list" });

  expect(first.isError, first.text).toBe(false);
  expect(first.text.length).toBeLessThanOrEqual(20_000);
  expect(first.text).toMatch(
    /\(Part 1 of \d+\. Read on with: subjects \{"action":"list","cursor":"2"\}\)$/,
  );

  const next = await call("subjects", { action: "list", cursor: "2" });

  expect(next.isError, next.text).toBe(false);
  expect(next.text).toContain("Room 119");

  // Errors stay under their size, with a valid call, even for a long name.
  const refusals = [
    ["a long name", { action: "show", subject: "x".repeat(5000) }],
    ["an unknown parent", { action: "create", name: "Garden shed", parent: "Shed" }],
    ["a name close to many", { action: "attach", subject: "Room", expenses: ["not-an-id"] }],
    ["no subject", { action: "show" }],
  ] as const;

  for (const [why, args] of refusals) {
    const refused = await call("subjects", args);

    expect(refused.isError, why).toBe(true);

    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text.length, refused.text).toBeLessThan(ERROR_LIMIT);
    expect(refused.text).toContain("A valid call: ");
  }
});
