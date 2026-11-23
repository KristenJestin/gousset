import type { Browser, Page } from "@playwright/test";

import type { TestUser } from "../src/auth";
import { colorSchemeOf } from "../src/database";
import { onPhone, openAccountMenu } from "../src/frame";
import { addUser, animationsDone, expect, personOfItsOwn, signIn, test, visit } from "../src/test";

// The scenarios of issue #50 (the colour scheme kept on the user's account), "How to verify", one
// test each. Every user here is the test's own: the worker's shared users keep the system's
// scheme, as the other tests expect.

/** The app's own scripts, whatever bundle they come from: kept from running, no hydration. */
const APP_SCRIPTS = /\.m?js(\?.*)?$/;

/**
 * Picks a colour scheme as the user would, and waits until their account keeps it: the user's
 * menu on a desktop, the settings on a phone, whose menu holds only the account's actions.
 */
async function pickScheme(
  page: Page,
  database: string,
  person: TestUser,
  scheme: { name: "Light" | "Dark"; value: "light" | "dark" },
) {
  if (onPhone(page)) {
    await visit(page, "/settings");
    await page.getByRole("radio", { name: scheme.name }).click();
  } else {
    const menu = await openAccountMenu(page, person.name);

    await menu.getByRole("menuitemradio", { name: scheme.name }).click();
    await page.keyboard.press("Escape");
    // The menu fades out: axe, at the end, would measure its items' contrast halfway.
    await animationsDone(page);
  }

  // Applied at once, without a reload, then kept on the account.
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme.value);
  await expect.poll(() => colorSchemeOf(database, person.email)).toBe(scheme.value);
}

/** Signs in through the sign-in page, as a person does: the app opens without a reload. */
async function signInThroughThePage(page: Page, person: TestUser) {
  await visit(page, "/sign-in");
  await page.getByLabel("E-mail").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
}

/** A browser of the person's own, signed in with a session of its own: another device. */
async function anotherBrowser(browser: Browser, baseURL: string, person: TestUser) {
  const context = await browser.newContext({ baseURL });
  const session = await signIn(baseURL, person);

  await context.addCookies([...session.cookies]);

  return context;
}

test("a user picks dark, signs out; another user signs in on the same browser and sees their own choice", async ({
  page,
  browser,
  app,
  user,
}) => {
  const jules = await addUser(app.baseURL, user, personOfItsOwn("jules"));
  const nico = await addUser(app.baseURL, user, personOfItsOwn("nico"));

  // Nico chose light, on a browser of their own.
  const nicoElsewhere = await anotherBrowser(browser, app.baseURL, nico);

  try {
    const elsewhere = await nicoElsewhere.newPage();

    await visit(elsewhere, "/");
    await pickScheme(elsewhere, app.database, nico, { name: "Light", value: "light" });
  } finally {
    await nicoElsewhere.close();
  }

  // On this browser, Jules picks dark, then signs out.
  await signInThroughThePage(page, jules);
  await pickScheme(page, app.database, jules, { name: "Dark", value: "dark" });

  const menu = await openAccountMenu(page, jules.name);

  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // Survives only if the page is never reloaded: Nico's choice comes at once, with the sign-in.
  await page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "yes";
  });
  await signInThroughThePage(page, nico);
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoReload)).toBe("yes");

  // And again on the next visit, from the server: Jules's dark, left in this browser, never comes back.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  // The review's blocks fade in: axe, at the end, would measure their contrast halfway.
  await animationsDone(page);
});

test("the same user signs in on another browser and gets dark on the first paint", async ({
  page,
  browser,
  app,
  user,
}) => {
  const remy = await addUser(app.baseURL, user, personOfItsOwn("remy"));

  await page.context().addCookies([...remy.cookies]);
  await visit(page, "/");
  await pickScheme(page, app.database, remy, { name: "Dark", value: "dark" });

  // A browser that never saw Remy's choice, and whose system is light.
  const other = await anotherBrowser(browser, app.baseURL, remy);

  try {
    const firstPaint = await other.newPage();

    // No script of the app runs: what shows is the server's page alone, as on the first paint.
    await firstPaint.route(APP_SCRIPTS, (route) => route.abort());
    await firstPaint.goto("/");
    await expect(firstPaint.locator("html")).toHaveAttribute("data-color-scheme", "dark");
    await expect(firstPaint.locator("html")).toHaveCSS("color-scheme", "dark");
  } finally {
    await other.close();
  }

  // The review's blocks fade in: axe, at the end, would measure their contrast halfway.
  await animationsDone(page);
});
