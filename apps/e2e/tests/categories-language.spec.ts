import { request } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { LANGUAGE_COOKIE, defaultRows } from "@gousset/core";
import { category } from "@gousset/db/schema/ledger";
import { and, asc, eq, isNull } from "drizzle-orm";

import { startWorkerEnvironment } from "../src/app-server";
import {
  CHANGE_PASSWORD_PATH,
  CREATE_USER_PATH,
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  personOfItsOwn,
} from "../src/auth";
import type { TestUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #195: the default categories are in the user's language. A user signing up gets them in
// the language of their interface; one the administrator creates gets them in the administrator's,
// and their own first signed-in page renames the defaults they never touched into theirs, once.
// The same holds for a user made before the fix, whose defaults the update left in English.

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/**
 * A user of the test's own, created by the administrator from a browser in `adminLanguage`, who
 * changed the temporary password through the API: no page of the app opened yet.
 */
async function created(
  baseURL: string,
  admin: TestUser,
  local: string,
  adminLanguage: string,
): Promise<TestUser & { id: string }> {
  const person = personOfItsOwn(local);
  const temporary = `${person.password}-temporary`;

  const asAdmin = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, "Accept-Language": adminLanguage },
    storageState: { cookies: [...admin.cookies], origins: [] },
  });

  try {
    const answer = await asAdmin.post(CREATE_USER_PATH, {
      data: { ...person, password: temporary, data: { mustChangePassword: true } },
    });

    expect(answer.ok(), await answer.text()).toBe(true);
  } finally {
    await asAdmin.dispose();
  }

  const asUser = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });

  try {
    const signedIn = await asUser.post(SIGN_IN_PATH, {
      data: { email: person.email, password: temporary },
    });

    expect(signedIn.ok(), await signedIn.text()).toBe(true);

    const changed = await asUser.post(CHANGE_PASSWORD_PATH, {
      data: { currentPassword: temporary, newPassword: person.password, revokeOtherSessions: true },
    });

    expect(changed.ok(), await changed.text()).toBe(true);

    const { cookies } = await asUser.storageState();

    return { ...person, cookies, id: await data.ownerOf(person.email) };
  } finally {
    await asUser.dispose();
  }
}

/** A browser of the user's, speaking `locale`, with the language cookie when one is chosen. */
async function browserOf(
  browser: Browser,
  baseURL: string,
  person: TestUser,
  locale: string,
  chosen?: "en" | "fr",
) {
  const context = await browser.newContext({ baseURL, locale });

  await context.addCookies([...person.cookies]);

  if (chosen !== undefined) {
    await context.addCookies([{ name: LANGUAGE_COOKIE, value: chosen, url: baseURL }]);
  }

  return context;
}

/**
 * A user's categories as rows of the default set: kind, parent's name, name, position, fallback;
 * from the worker's database, or from `from`.
 */
async function categoriesOf(owner: string, from = data) {
  const rows = await from.asUser(owner, (transaction) =>
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

const settled = (email: string) => data.defaultsSettled(email);

test("the administrator signing up gets the set of the language chosen, settled", async ({
  app,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);

  // Sign-up opens only on a fresh install: an app of the test's own.
  const fresh = await startWorkerEnvironment(
    app.slot + 600,
    testInfo.outputPath("categories-sign-up.log"),
  );

  const freshData = openUserData(fresh.database);

  try {
    const person = personOfItsOwn("anouk");

    // The language chosen in the interface, French, over a browser that speaks English.
    const asNew = await request.newContext({
      baseURL: fresh.baseURL,
      extraHTTPHeaders: { Origin: fresh.baseURL, "Accept-Language": "en-US,en;q=0.9" },
      storageState: {
        cookies: [
          {
            name: LANGUAGE_COOKIE,
            value: "fr",
            domain: new URL(fresh.baseURL).hostname,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
    });

    let administrator: TestUser;

    try {
      const answer = await asNew.post(SIGN_UP_PATH, { data: person });

      expect(answer.ok(), await answer.text()).toBe(true);

      const { cookies } = await asNew.storageState();

      administrator = { ...person, cookies };
    } finally {
      await asNew.dispose();
    }

    const owner = await freshData.ownerOf(person.email);

    // The French set, and nothing left to rename: no page of theirs opened yet.
    expect(await categoriesOf(owner, freshData)).toEqual(sameOrder(defaultRows("fr")));
    expect(await freshData.defaultsSettled(person.email)).toBe(true);

    // A page in English translates nothing: the names are theirs from sign-up.
    const english = await browserOf(browser, fresh.baseURL, administrator, "en-US", "en");

    try {
      const page = await english.newPage();

      await page.goto("/settings/categories");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByText("Logement", { exact: true }).first()).toBeVisible();
    } finally {
      await english.close();
    }

    expect(await categoriesOf(owner, freshData)).toEqual(sameOrder(defaultRows("fr")));
  } finally {
    await freshData.close();
    await fresh.stop();
  }
});

test("a user signing up in French sees the French default set", async ({ app, user, browser }) => {
  // Created by an administrator whose browser speaks English: the English set, not settled.
  const person = await created(app.baseURL, user, "louise", "en-US,en;q=0.9");

  expect(await categoriesOf(person.id)).toEqual(sameOrder(defaultRows("en")));
  expect(await settled(person.email)).toBe(false);

  const context = await browserOf(browser, app.baseURL, person, "fr-FR");

  try {
    const page = await context.newPage();

    await page.goto("/settings/categories");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByText("Logement", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Autre", { exact: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }

  expect(await categoriesOf(person.id)).toEqual(sameOrder(defaultRows("fr")));
  expect(await settled(person.email)).toBe(true);

  // From then on the names are the user's: an English page translates nothing back.
  const english = await browserOf(browser, app.baseURL, person, "en-US", "en");

  try {
    const page = await english.newPage();

    await page.goto("/settings/categories");
    await expect(page.getByText("Logement", { exact: true }).first()).toBeVisible();
  } finally {
    await english.close();
  }

  expect(await categoriesOf(person.id)).toEqual(sameOrder(defaultRows("fr")));
});

test("a user signing up in English sees the English default set", async ({
  app,
  user,
  browser,
}) => {
  // Created by an administrator whose browser speaks French: the French set, until the user's own
  // first page, in English.
  const person = await created(app.baseURL, user, "oscar", "fr-FR,fr;q=0.9,en;q=0.5");

  expect(await categoriesOf(person.id)).toEqual(sameOrder(defaultRows("fr")));

  const context = await browserOf(browser, app.baseURL, person, "en-US");

  try {
    const page = await context.newPage();

    await page.goto("/settings/categories");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("Housing", { exact: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }

  expect(await categoriesOf(person.id)).toEqual(sameOrder(defaultRows("en")));
  expect(await settled(person.email)).toBe(true);
});

test("an untouched default is renamed into the user's language, a renamed one kept", async ({
  app,
  user,
  browser,
}) => {
  // A user whose set is the English one, as the update left those made before it.
  const person = await created(app.baseURL, user, "maelle", "en-US,en;q=0.9");

  // What the user touched before their first page in French: a top-level category renamed, a
  // child moved under another, a child archived.
  await data.asUser(person.id, async (transaction) => {
    const top = (name: string) =>
      transaction
        .select({ id: category.id })
        .from(category)
        .where(
          and(eq(category.kind, "expense"), eq(category.name, name), isNull(category.parentId)),
        );

    const [housing] = await top("Housing");
    const [eatingOut] = await top("Eating out");

    await transaction
      .update(category)
      .set({ name: "Home" })
      .where(eq(category.id, housing?.id ?? ""));
    await transaction
      .update(category)
      .set({ parentId: eatingOut?.id ?? "" })
      .where(eq(category.name, "Bakery"));
    await transaction
      .update(category)
      .set({ archivedAt: new Date() })
      .where(eq(category.name, "Travel"));
  });

  // The language chosen in the interface, over a browser that speaks English; two pages at once,
  // as two tabs opened together: the defaults are renamed once.
  const context = await browserOf(browser, app.baseURL, person, "en-US", "fr");

  try {
    const [first, second] = await Promise.all([context.newPage(), context.newPage()]);

    await Promise.all([first.goto("/settings/categories"), second.goto("/")]);
    await expect(first.getByText("Courses", { exact: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }

  const after = await categoriesOf(person.id);

  const named = (parent: string | null, name: string) =>
    after.some((row) => row.parent === parent && row.name === name);

  // Renamed: the untouched ones, the fallbacks among them.
  expect(named(null, "Courses")).toBe(true);
  expect(named("Courses", "Supermarché")).toBe(true);
  expect(after.filter((row) => row.fallback).map((row) => row.name)).toEqual(["Autre", "Autre"]);
  expect(named("Loisirs", "Passe-temps")).toBe(true);

  // Kept: what the user renamed, with its children; what they moved or archived.
  expect(named(null, "Home")).toBe(true);
  expect(named("Home", "Rent")).toBe(true);
  expect(named("Sorties au restaurant", "Bakery")).toBe(true);
  expect(named("Loisirs", "Travel")).toBe(true);
  expect(after).toHaveLength(defaultRows("fr").length);
  expect(await settled(person.email)).toBe(true);
});

test("a default renamed by hand to the other language's name is kept", async ({
  app,
  user,
  browser,
}) => {
  // Issue #218: created by an administrator whose browser speaks French, the French set.
  const person = await created(app.baseURL, user, "ines", "fr-FR,fr;q=0.9");

  // Before their first page, the user named two defaults in English: a top-level category, and a
  // child under one they left as it was.
  await data.asUser(person.id, async (transaction) => {
    const [health] = await transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.name, "Santé"), isNull(category.parentId)));

    await transaction
      .update(category)
      .set({ name: "Groceries" })
      .where(and(eq(category.name, "Courses"), isNull(category.parentId)));
    await transaction
      .update(category)
      .set({ name: "Pharmacy" })
      .where(and(eq(category.name, "Pharmacie"), eq(category.parentId, health?.id ?? "")));
  });

  // Their first page, in French, the set's own language.
  const context = await browserOf(browser, app.baseURL, person, "fr-FR");

  try {
    const page = await context.newPage();

    await page.goto("/settings/categories");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }

  // Their names stay theirs; everything else is the French set, as it was.
  const expected = sameOrder(defaultRows("fr")).map((row) => {
    if (row.parent === null && row.name === "Courses") {
      return { ...row, name: "Groceries" };
    }

    if (row.parent === "Courses") {
      return { ...row, parent: "Groceries" };
    }

    return row.parent === "Santé" && row.name === "Pharmacie" ? { ...row, name: "Pharmacy" } : row;
  });

  expect(await categoriesOf(person.id)).toEqual(sameOrder(expected));
  expect(await settled(person.email)).toBe(true);
});
