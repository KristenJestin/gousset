import type { Page } from "@playwright/test";

import { startWorkerEnvironment } from "../src/app-server";
import { hasUser } from "../src/database";
import { createUser, expect, expectAccessible, personOfItsOwn, test, visit } from "../src/test";

// The scenario of issue #80, "How to verify", then the same refusals on the other forms that
// choose a password: each says what is expected under the field at fault, and the form keeps
// everything but the password. The rules show under the field before anything is submitted.

const RULES = "8 to 128 characters.";
const TOO_SHORT = "The password needs at least 8 characters.";
const TOO_LONG = "The password can have at most 128 characters.";

/** A message as part of an accessible description, which also holds the field's rules. */
const within = (message: string) => new RegExp(message.replaceAll(".", String.raw`\.`));

/** Marks the page: the mark survives only if the page is never reloaded. */
async function markPage(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "yes";
  });
}

type Refused = {
  /** The label of the field at fault. */
  field: string;
  message: string;
  /** The other fields, by label, and what they must still hold. */
  kept: ReadonlyArray<{ label: string; value: string }>;
  /** Every password field of the form, emptied by the refusal. */
  emptied: ReadonlyArray<string>;
};

/**
 * A refused password: its message under the field at fault and linked to it, there at once
 * (nothing fades or slides in), the passwords emptied, every other field as typed, no reload.
 */
async function expectRefused(page: Page, { field, message, kept, emptied }: Refused) {
  const error = page.getByText(message, { exact: true });
  const input = page.getByLabel(field, { exact: true });

  await expect(error).toBeVisible();
  await expect(error).toHaveCSS("transition-duration", "0s");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(within(message));

  for (const label of emptied) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  }

  for (const { label, value } of kept) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  }

  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoReload)).toBe("yes");
}

test("a password too short and one too long on setup each show their own message; nothing is lost but the password", async ({
  page,
  app,
}, testInfo) => {
  test.setTimeout(120_000);

  const fresh = await startWorkerEnvironment(
    app.slot + 500,
    testInfo.outputPath("fresh-install-passwords.log"),
  );

  try {
    await visit(page, `${fresh.baseURL}/setup`);
    await markPage(page);

    const password = page.getByLabel("Password", { exact: true });
    const submit = page.getByRole("button", { name: "Create the administrator" });

    const kept = [
      { label: "Name", value: "Ada Example" },
      { label: "E-mail", value: "ada@example.com" },
    ];

    // The rules, before anything is submitted.
    await expect(password).toHaveAccessibleDescription(RULES);

    for (const { label, value } of kept) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }

    await password.fill("short");
    await submit.click();
    await expectRefused(page, {
      field: "Password",
      message: TOO_SHORT,
      kept,
      emptied: ["Password"],
    });
    await expectAccessible(page);

    await password.fill("x".repeat(129));
    await submit.click();
    await expectRefused(page, {
      field: "Password",
      message: TOO_LONG,
      kept,
      emptied: ["Password"],
    });
    // Its own message: the other one is gone.
    await expect(page.getByText(TOO_SHORT, { exact: true })).toHaveCount(0);

    // Typing again takes the message away.
    await password.fill("ada-pass");
    await expect(page.getByText(TOO_LONG, { exact: true })).toHaveCount(0);
    expect(await hasUser(fresh.database, "ada@example.com")).toBe(false);
  } finally {
    await fresh.stop();
  }
});

test("a temporary password too short says so on the users page, and keeps the name and e-mail", async ({
  userPage,
  app,
}) => {
  await visit(userPage, "/users");
  await markPage(userPage);

  const password = userPage.getByLabel("Temporary password", { exact: true });

  const kept = [
    { label: "Name", value: "Wren Example" },
    { label: "E-mail", value: "wren@example.com" },
  ];

  await expect(password).toHaveAccessibleDescription(RULES);

  for (const { label, value } of kept) {
    await userPage.getByLabel(label, { exact: true }).fill(value);
  }

  await password.fill("wren");
  await userPage.getByRole("button", { name: "Create the user" }).click();

  await expectRefused(userPage, {
    field: "Temporary password",
    message: TOO_SHORT,
    kept,
    emptied: ["Temporary password"],
  });
  expect(await hasUser(app.database, "wren@example.com")).toBe(false);
});

test("a new password too long says so when changing the password", async ({ page, app, user }) => {
  const person = personOfItsOwn("tarn");

  await createUser(app.baseURL, user, person);

  await visit(page, "/sign-in");
  await page.getByLabel("E-mail").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await markPage(page);

  const newPassword = page.getByLabel("New password", { exact: true });

  await expect(newPassword).toHaveAccessibleDescription(RULES);

  await page.getByLabel("Current password", { exact: true }).fill(person.password);
  await newPassword.fill("t".repeat(129));
  await page.getByRole("button", { name: "Change the password" }).click();

  await expectRefused(page, {
    field: "New password",
    message: TOO_LONG,
    kept: [],
    emptied: ["Current password", "New password"],
  });

  // Still temporary: nothing else opens.
  await page.goto("/");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("a form sends nothing before the page is ready, so no password lands in an address", async ({
  browser,
  app,
  user,
}) => {
  // Without the page's scripts, as in the moment before they run: the browser alone would send
  // the form to the page's own address, its fields in the query, and show it again empty.
  const context = await browser.newContext({ baseURL: app.baseURL, javaScriptEnabled: false });

  try {
    const page = await context.newPage();

    await page.goto("/sign-in");
    await page.getByLabel("E-mail").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);

    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
  } finally {
    await context.close();
  }
});
