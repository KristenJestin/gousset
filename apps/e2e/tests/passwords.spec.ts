import type { Page } from "@playwright/test";

import { startWorkerEnvironment } from "../src/app-server";
import { hasUser } from "../src/database";
import {
  addUser,
  createUser,
  expect,
  expectAccessible,
  personOfItsOwn,
  signInStatus,
  test,
  visit,
} from "../src/test";

// The scenario of issue #80, "How to verify", then the same refusals on the other forms that
// choose a password: each says what is expected under the field at fault, and the form keeps
// everything but the password. The rules show under the field before anything is submitted.

const RULES = "8 to 128 characters.";
const TOO_SHORT = "The password needs at least 8 characters.";
const TOO_LONG = "The password can have at most 128 characters.";

/** A message as part of an accessible description, which also holds the field's rules. */
const within = (message: string) => new RegExp(message.replaceAll(".", String.raw`\.`));

/**
 * A message as the page shows it: in `<main>`, since ui-sdk also hands a field's error to a shared
 * screen-reader announcer beside it, which keeps the last one said.
 */
const shown = (page: Page, message: string) =>
  page.getByRole("main").getByText(message, { exact: true });

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
  const error = shown(page, message);
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
    await expect(shown(page, TOO_SHORT)).toHaveCount(0);

    // Typing again takes the message away: the field holds its rules alone.
    await password.fill("ada-pass");
    await expect(shown(page, TOO_LONG)).toHaveCount(0);
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAccessibleDescription(RULES);
    expect(await hasUser(fresh.database, "ada@example.com")).toBe(false);
  } finally {
    await fresh.stop();
  }
});

test("a temporary password too short says so on the users page, and keeps the name and e-mail", async ({
  userPage,
  app,
}) => {
  await visit(userPage, "/settings/users");
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

test("a new password too long says so when changing the password, a current one under its own field", async ({
  page,
  app,
  user,
}) => {
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

  // A current password that long is a wrong one: said under Current password, not New password.
  const currentPassword = page.getByLabel("Current password", { exact: true });

  await currentPassword.fill("c".repeat(129));
  await newPassword.fill("tarn-own-password");
  await page.getByRole("button", { name: "Change the password" }).click();
  await expect(currentPassword).toHaveAttribute("aria-invalid", "true");
  await expect(newPassword).not.toHaveAttribute("aria-invalid", "true");
  await expect(shown(page, TOO_LONG)).toHaveCount(0);

  // Still temporary: nothing else opens.
  await page.goto("/");
  await expect(page).toHaveURL(/\/change-password$/);
});

// Issue #105: changing one's own password moved from the user's menu to the settings, in a dialog.
test("the password is changed from the settings, in a dialog that keeps a refusal under its field", async ({
  page,
  app,
  user,
}) => {
  // The password is the account's: a user of the test's own.
  const piper = await addUser(app.baseURL, user, personOfItsOwn("piper"));
  const chosen = "piper-own-new-password";

  await page.context().addCookies([...piper.cookies]);
  await visit(page, "/settings/account");
  await expect(
    page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" }),
  ).toHaveAttribute("aria-current", "page");

  const trigger = page.getByRole("button", { name: "Change password" });
  const dialog = page.getByRole("dialog", { name: "Change your password" });
  const currentPassword = dialog.getByLabel("Current password", { exact: true });
  const newPassword = dialog.getByLabel("New password", { exact: true });
  const submit = dialog.getByRole("button", { name: "Change the password" });

  const transition = () => dialog.evaluate((node) => getComputedStyle(node).transitionDuration);

  // It grows in 200 ms (the dialog's motion), at once under reduced motion. Cancel closes it,
  // nothing changed, and focus is back on the button that opened it.
  await trigger.click();
  await expect(dialog).toBeVisible();
  expect(await transition()).toContain("0.2s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await transition()).not.toMatch(/[1-9]/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(newPassword).toHaveAccessibleDescription(RULES);

  // A wrong current password, sent with Enter: said under its field, the dialog still open.
  await currentPassword.fill("not-the-password");
  await newPassword.fill(chosen);
  await newPassword.press("Enter");
  await expect(currentPassword).toHaveAttribute("aria-invalid", "true");
  await expect(newPassword).not.toHaveAttribute("aria-invalid", "true");
  await expect(currentPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(dialog).toBeVisible();

  // A new password too short: said under it, the rules beside the message.
  await currentPassword.fill(piper.password);
  await newPassword.fill("short");
  await submit.click();
  await expect(dialog.getByText(TOO_SHORT, { exact: true })).toBeVisible();
  await expect(newPassword).toHaveAttribute("aria-invalid", "true");
  await expect(newPassword).toHaveAccessibleDescription(within(TOO_SHORT));
  await expect(currentPassword).not.toHaveAttribute("aria-invalid", "true");

  // Accepted: the dialog closes and the page says so; the user stays signed in.
  await currentPassword.fill(piper.password);
  await newPassword.fill(chosen);
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("main").locator('[role="status"]')).toHaveText(
    "Your password was changed.",
  );
  expect(await signInStatus(app.baseURL, { email: piper.email, password: chosen })).toBe(200);
  expect(await signInStatus(app.baseURL, piper)).toBe(401);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/account$/);
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
    const sent: Array<string> = [];

    page.on("request", (request) => {
      // The query alone: preloaded scripts carry the word in their names.
      if (new URL(request.url()).searchParams.has("password")) {
        sent.push(request.url());
      }
    });

    await page.goto("/sign-in");

    const password = page.getByLabel("Password", { exact: true });

    await page.getByLabel("E-mail").fill(user.email);
    await password.fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await password.press("Enter");
    await page.waitForLoadState("load");

    // Nothing sent, nothing drawn again: the page and what was typed are still there.
    expect(sent).toEqual([]);
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel("E-mail")).toHaveValue(user.email);
    await expect(password).toHaveValue(user.password);
  } finally {
    await context.close();
  }
});
