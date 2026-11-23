import { request } from "@playwright/test";
import { DatabaseCategoryStore, createCategory, defaultRows } from "@gousset/core";
import {
  category,
  entry,
  entryPart,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { CREATE_USER_PATH, addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #23, categories on two levels (docs/data-model.md, v0.3): every user has the default set,
// in their browser's language; every counted line with an amount has exactly one entry, with one
// category, and undoing its import takes it away; a category in use is kept, while its user can
// still be deleted. The users are this file's own, created by the worker's administrator as the
// users page does; imports run through `@gousset/core`, as the import job runs them.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Noa Example",
    email: `noa.categories.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

/** A user's categories as rows of the default set: kind, parent's name, name, position, fallback. */
async function categoriesOf(of: string) {
  const rows = await data.asUser(of, (transaction) =>
    transaction.select().from(category).orderBy(asc(category.id)),
  );

  const nameOf = new Map(rows.map((row) => [row.id, row.name]));

  return rows
    .map((row) => ({
      kind: row.kind,
      parent: row.parentId === null ? null : (nameOf.get(row.parentId) ?? "?"),
      name: row.name,
      position: row.position,
      fallback: row.isFallback,
    }))
    .toSorted(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        (a.parent ?? "").localeCompare(b.parent ?? "") ||
        a.position - b.position,
    );
}

const sameOrder = (rows: ReturnType<typeof defaultRows>) =>
  [...rows].toSorted(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      (a.parent ?? "").localeCompare(b.parent ?? "") ||
      a.position - b.position,
  );

/** Each line of an account with its parts, their entries and categories, in the account's order. */
function classificationOf(accountId: string) {
  return data.asUser(owner, (transaction) =>
    transaction
      .select({
        lineId: statementLine.id,
        amountMinor: statementLine.amountMinor,
        state: statementLine.state,
        entryId: entry.id,
        kind: entry.kind,
        happenedOn: entry.happenedOn,
        classifiedBy: entry.classifiedBy,
        category: category.name,
        fallback: category.isFallback,
        role: entryPart.role,
        partMinor: entryPart.amountMinor,
      })
      .from(statementLine)
      .leftJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .leftJoin(entry, eq(entry.id, entryPart.entryId))
      .leftJoin(category, eq(category.id, entry.categoryId))
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );
}

test("categories, entries and their parts are kept apart by row-level security", async () => {
  for (const table of ["category", "entry", "entry_part"]) {
    expect(await data.isolationOf(table), table).toEqual([
      { rowSecurity: true, forced: true, ownerPolicy: true, granted: true },
    ]);
  }

  // Granted to a user's transaction only, never to the app's own role.
  const reached = await data.reachableTables("gousset_app");

  expect(reached).not.toContain("public.category");
  expect(reached).not.toContain("public.entry");
  expect(reached).not.toContain("public.entry_part");
});

test("a signed-up user has the default set", async ({ app, user }) => {
  // The user of this file, created by the administrator: in English, the harness's browser
  // sending no preference.
  expect(await categoriesOf(owner)).toEqual(sameOrder(defaultRows("en")));

  // One created from a browser that prefers French gets it in French.
  const email = `lea.categories.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`;

  const asAdmin = await request.newContext({
    baseURL: app.baseURL,
    extraHTTPHeaders: { Origin: app.baseURL, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5" },
    storageState: { cookies: [...user.cookies], origins: [] },
  });

  try {
    const answer = await asAdmin.post(CREATE_USER_PATH, {
      data: {
        name: "Léa Exemple",
        email,
        password: `e2e-lea-temporary-${app.slot}`,
        data: { mustChangePassword: true },
      },
    });

    expect(answer.ok(), await answer.text()).toBe(true);
  } finally {
    await asAdmin.dispose();
  }

  expect(await categoriesOf(await data.ownerOf(email))).toEqual(sameOrder(defaultRows("fr")));
});

test("an invented import gives each counted line one entry with one category, and undo removes them", async () => {
  const accountId = await imports.createAccount(owner, "Classified by default");

  // A line of no amount has nothing to classify: it gets no entry.
  const statement: Statement = {
    ...exampleStatement,
    lines: [
      ...exampleStatement.lines,
      { bookedOn: "2026-10-22", amountMinor: 0, label: "FRAIS OFFERTS", reference: "EX2026102201" },
    ],
  };

  const imported = await imports.importFile(owner, accountId, statementFile("ofx", statement));

  expect(imported).toMatchObject({ status: "done", linesAdded: statement.lines.length });

  const rows = await classificationOf(accountId);

  expect(rows).toHaveLength(statement.lines.length);

  for (const row of rows) {
    if (row.amountMinor === 0) {
      expect(row.entryId, "a line of no amount").toBeNull();
      continue;
    }

    expect(row).toMatchObject({
      state: "counted",
      kind: row.amountMinor < 0 ? "expense" : "income",
      classifiedBy: "default",
      category: "Other",
      fallback: true,
      role: "payment",
      partMinor: Math.abs(row.amountMinor),
    });
  }

  // One entry per line: no entry is shared, none left over.
  const entryIds = rows.flatMap((row) => (row.entryId === null ? [] : [row.entryId]));

  expect(new Set(entryIds).size).toBe(statement.lines.length - 1);

  // A job run again adds no entry.
  await data.asUser(owner, (transaction) =>
    transaction
      .update(statementImport)
      .set({ status: "saving" })
      .where(eq(statementImport.id, imported.id)),
  );
  await imports.run(owner, imported.id);
  expect(await classificationOf(accountId)).toEqual(rows);

  // Undone, the lines go with their parts and their entries.
  await imports.undo(owner, imported.id);

  expect(await classificationOf(accountId)).toEqual([]);

  const left = await data.asUser(owner, (transaction) =>
    transaction.select({ id: entry.id }).from(entry),
  );

  expect(left.filter((each) => entryIds.includes(each.id))).toEqual([]);
});

test("a line counted again by an undo gets its entry", async () => {
  const accountId = await imports.createAccount(owner, "Counted again");
  const payment = exampleStatement.lines[4];

  if (payment === undefined) {
    throw new Error("The example statement has no fifth line.");
  }

  const fromOfx = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", { ...exampleStatement, lines: [payment] }),
  );

  // The same payment read from a CSV, held as a near duplicate: no entry while held.
  const fromCsv = await imports.importFile(
    owner,
    accountId,
    statementFile("csv", {
      ...exampleStatement,
      lines: [{ ...payment, bookedOn: "2026-10-16", label: "STREAMFLIX ABONNEMENT" }],
    }),
  );

  expect(fromCsv.linesHeld).toBe(1);

  const held = (await classificationOf(accountId)).find((row) => row.state === "held");

  expect(held?.entryId).toBeNull();

  await imports.undo(owner, fromOfx.id);

  expect(await classificationOf(accountId)).toEqual([
    expect.objectContaining({
      state: "counted",
      kind: "expense",
      category: "Other",
      role: "payment",
      partMinor: Math.abs(payment.amountMinor),
    }),
  ]);
});

test("two categories created at once under one name: one is made, the other refused", async ({
  app,
  user,
}) => {
  // A user of its own: the tests of this file run in any order.
  const person = await addUser(app.baseURL, user, {
    name: "Ivo Example",
    email: `ivo.categories.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-ivo-password-${app.slot}`,
  });

  const ivo = await data.ownerOf(person.email);

  // Each on a connection of its own, as two requests of the app would be.
  const second = openUserData(app.database);

  const create = (handle: ReturnType<typeof openUserData>, name: string) =>
    Effect.runPromise(
      createCategory(ivo, { kind: "expense", name }).pipe(
        Effect.match({ onSuccess: () => "created", onFailure: (error) => error._tag }),
        Effect.provide(DatabaseCategoryStore.pipe(Layer.provide(handle.layer))),
      ),
    );

  try {
    const outcomes = await Promise.all([create(data, "Pets"), create(second, "pets")]);

    expect(outcomes.toSorted()).toEqual(["CategoryNameTaken", "created"]);
  } finally {
    await second.close();
  }

  const names = await data.asUser(ivo, (transaction) =>
    transaction.select({ name: category.name }).from(category),
  );

  expect(names.filter((each) => each.name.toLowerCase() === "pets")).toHaveLength(1);
});

test("a category in use can't be deleted while a user with data still can be", async ({
  app,
  user,
}) => {
  const person = await addUser(app.baseURL, user, {
    name: "Rui Example",
    email: `rui.categories.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-rui-password-${app.slot}`,
  });

  const rui = await data.ownerOf(person.email);

  expect((await data.seed(rui)).lines).toBeGreaterThan(0);

  const [used] = await data.asUser(rui, (transaction) =>
    transaction
      .selectDistinct({ id: category.id, parentId: category.parentId })
      .from(category)
      .innerJoin(entry, eq(entry.categoryId, category.id))
      .limit(1),
  );

  expect(used).toBeDefined();

  // Checked at commit: the entries still point to it.
  expect(
    await data.refusal(rui, (transaction) =>
      transaction.delete(category).where(eq(category.id, used?.id ?? "")),
    ),
  ).toBe("23503");

  // A parent with children is kept too.
  const [parent] = await data.asUser(rui, (transaction) =>
    transaction
      .select({ id: category.parentId })
      .from(category)
      .where(eq(category.name, "Rent"))
      .limit(1),
  );

  expect(
    await data.refusal(rui, (transaction) =>
      transaction.delete(category).where(eq(category.id, parent?.id ?? "")),
    ),
  ).toBe("23503");

  // The user goes, with every category, entry and part of theirs.
  await data.deleteUser(rui);

  for (const table of [category, entry, entryPart]) {
    expect(await data.asUser(rui, (transaction) => transaction.select().from(table))).toEqual([]);
  }
});
