import { startWorkerEnvironment } from "../src/app-server";
import { hasUniqueIndex, hasUser } from "../src/database";
import { openAccountMenu } from "../src/frame";
import {
  SIGN_UP_PATH,
  animationsDone,
  createUser,
  expect,
  expectAccessible,
  signInStatus,
  test,
  visit,
} from "../src/test";

// The scenarios of issue #5, "How to verify", one test each, plus the issue's motion and session
// rules. The worker's app already has its administrator (`user`) whenever a test asks for it; a
// fresh install gets an app of its own.

test("the first visit creates the administrator", async ({ page, app }, testInfo) => {
  test.setTimeout(120_000);

  const fresh = await startWorkerEnvironment(
    app.slot + 200,
    testInfo.outputPath("fresh-install.log"),
  );

  try {
    await visit(page, `${fresh.baseURL}/`);

    await expect(page).toHaveURL(`${fresh.baseURL}/setup`);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to Gousset" })).toBeVisible();

    await page.getByLabel("Name").fill("Ada Example");
    await page.getByLabel("E-mail").fill("ada@example.com");
    await page.getByLabel("Password").fill("ada-password-e2e");
    await page.getByRole("button", { name: "Create the administrator" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
    // Only the administrator manages users.
    const menu = await openAccountMenu(page, "Ada Example");

    await expect(menu.getByRole("menuitem", { name: "Users" })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await hasUser(fresh.database, "ada@example.com")).toBe(true);

    // The menu fades out: axe would measure its items' contrast halfway.
    await animationsDone(page);
    await expectAccessible(page);

    // The first setup is gone once the administrator exists.
    await page.goto(`${fresh.baseURL}/setup`);
    await expect(page).toHaveURL(`${fresh.baseURL}/`);
  } finally {
    await fresh.stop();
  }
});

test("two sign-ups at once on a fresh install create a single administrator", async ({
  app,
}, testInfo) => {
  test.setTimeout(120_000);

  const fresh = await startWorkerEnvironment(
    app.slot + 300,
    testInfo.outputPath("fresh-install-race.log"),
  );

  try {
    const signUpAs = async (email: string) => {
      const response = await fetch(`${fresh.baseURL}${SIGN_UP_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: fresh.baseURL },
        body: JSON.stringify({ name: "Racing Example", email, password: "racing-password-e2e" }),
      });

      return response.ok;
    };

    const answers = await Promise.all([
      signUpAs("first.racer@example.com"),
      signUpAs("second.racer@example.com"),
    ]);

    expect(answers.filter(Boolean)).toHaveLength(1);

    const written = await Promise.all([
      hasUser(fresh.database, "first.racer@example.com"),
      hasUser(fresh.database, "second.racer@example.com"),
    ]);

    expect(written.filter(Boolean)).toHaveLength(1);
  } finally {
    await fresh.stop();
  }
});

test("the migrations allow a single user created by sign-up", async ({ app }) => {
  // The index lives in a migration of its own, out of the generated schema: regenerating
  // better-auth's schema must not lose it.
  expect(await hasUniqueIndex(app.database, "auth_user_one_first_user")).toBe(true);
});

test("too many wrong current passwords are refused for a while", async ({
  playwright,
  app,
  user,
}) => {
  const person = { name: "Max Example", email: "max@example.com", password: "max-temporary-e2e" };

  await createUser(app.baseURL, user, person);

  const asMax = await playwright.request.newContext({
    baseURL: app.baseURL,
    extraHTTPHeaders: { Origin: app.baseURL },
  });

  try {
    const signedIn = await asMax.post("/api/auth/sign-in/email", {
      data: { email: person.email, password: person.password },
    });

    expect(signedIn.status()).toBe(200);

    const change = (currentPassword: string) =>
      asMax.post("/api/auth/change-password", {
        data: { currentPassword, newPassword: "max-own-password-e2e" },
      });

    for (let i = 0; i < 5; i++) {
      expect((await change(`wrong-guess-${i}`)).status()).toBe(400);
    }

    // Refused, even with the right current password.
    const refused = await change(person.password);

    expect(refused.status()).toBe(429);
    expect(await refused.text()).toContain("TOO_MANY_ATTEMPTS");
  } finally {
    await asMax.dispose();
  }
});

test("sign-up is refused once a user exists", async ({ page, app, user }) => {
  expect(await hasUser(app.database, user.email)).toBe(true);

  const response = await page.request.post(SIGN_UP_PATH, {
    headers: { Origin: app.baseURL },
    data: { name: "Eve Example", email: "eve@example.com", password: "eve-password-e2e" },
  });

  expect(response.status()).toBe(403);
  expect(await response.text()).toContain("SIGN_UP_CLOSED");
  expect(await hasUser(app.database, "eve@example.com")).toBe(false);

  // The first setup sends to sign-in.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a created user must change their password", async ({ userPage, browser, app }) => {
  await visit(userPage, "/settings/users");

  // The confirmation's live region is there, empty, before the confirmation comes, so that a
  // screen reader announces it.
  // In the creation form itself: the toaster and the users list keep live regions of their own.
  const status = userPage.getByRole("main").locator("form").locator('[role="status"]');

  await expect(status).toHaveCount(1);
  await expect(status).toBeEmpty();

  // Issue #103: the form is in a dialog, opened from the button beside the list's title.
  await userPage.getByRole("button", { name: "Create a user" }).click();

  const dialog = userPage.getByRole("dialog", { name: "Create a user" });

  await dialog.getByLabel("Name").fill("Robin Example");
  await dialog.getByLabel("E-mail").fill("robin@example.com");
  await dialog.getByLabel("Temporary password").fill("robin-temporary-e2e");
  await dialog.getByRole("button", { name: "Create the user" }).click();
  await expect(dialog).toBeHidden();

  await expect(status).toHaveText("Robin Example can now sign in with the temporary password.");
  await expect(
    userPage.getByRole("listitem").filter({ hasText: "robin@example.com" }),
  ).toContainText("Temporary password");

  const context = await browser.newContext({ baseURL: app.baseURL });
  const page = await context.newPage();

  try {
    await visit(page, "/sign-in");
    await page.getByLabel("E-mail").fill("robin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("robin-temporary-e2e");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText("Your password is temporary")).toBeVisible();
    // Created, not reset: nothing to say about a reset.
    await expect(page.getByText(/reset your password/)).toHaveCount(0);
    await expectAccessible(page);

    // Nothing else opens before the password is changed.
    await page.goto("/");
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel("Current password").fill("robin-temporary-e2e");
    await page.getByLabel("New password").fill("robin-own-password-e2e");
    await page.getByRole("button", { name: "Change the password" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
    // Not an administrator.
    const menu = await openAccountMenu(page, "Robin Example");

    await expect(menu.getByRole("menuitem", { name: "Users" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(
      await signInStatus(app.baseURL, {
        email: "robin@example.com",
        password: "robin-own-password-e2e",
      }),
    ).toBe(200);
  } finally {
    await context.close();
  }
});

test("the users page is a section of the settings, reached from the user's menu and from the settings", async ({
  userPage,
  user,
  secondUserPage,
}) => {
  // Issue #82: in the app's frame, laid out as the settings are, never a card alone on the page.
  await visit(userPage, "/");

  const menu = await openAccountMenu(userPage, user.name);

  await menu.getByRole("menuitem", { name: "Users" }).click();
  await expect(userPage).toHaveURL(/\/settings\/users$/);
  await expect(userPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  const sections = userPage.getByRole("navigation", { name: "Settings" });

  await expect(sections.getByRole("link", { name: "Users" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(userPage.getByRole("heading", { level: 2, name: "Users" })).toBeVisible();
  // Issue #103: creating a user is a button beside the list's title, its form in a dialog.
  await expect(userPage.getByRole("button", { name: "Create a user" })).toBeVisible();
  await expect(userPage.getByRole("heading", { level: 2, name: "Create a user" })).toHaveCount(0);
  await expect(userPage.getByLabel("Temporary password")).toHaveCount(0);
  // The frame is the way back: the page has no link of its own for it.
  await expect(userPage.getByRole("main").getByRole("link", { name: "Back" })).toHaveCount(0);

  // From the settings too.
  await sections.getByRole("link", { name: "General" }).click();
  await expect(userPage).toHaveURL(/\/settings$/);
  await sections.getByRole("link", { name: "Users" }).click();
  await expect(userPage).toHaveURL(/\/settings\/users$/);
  await expect(userPage.getByRole("button", { name: "Create a user" })).toBeVisible();
  // The screen reached fades in: axe checks it once drawn.
  await animationsDone(userPage);

  // Another user's settings have no users section.
  await visit(secondUserPage, "/settings");
  await expect(
    secondUserPage.getByRole("navigation", { name: "Settings" }).getByRole("link"),
  ).toHaveText(["General", "Categories", "Rules"]);
});

test("a new password equal to the current one is refused", async ({ page, app, user }) => {
  const person = { name: "Lou Example", email: "lou@example.com", password: "lou-temporary-e2e" };

  await createUser(app.baseURL, user, person);

  await visit(page, "/sign-in");
  await page.getByLabel("E-mail").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("Current password").fill(person.password);
  await page.getByLabel("New password").fill(person.password);
  await page.getByRole("button", { name: "Change the password" }).click();

  // Under the field at fault (#80), the passwords emptied to be typed again.
  const message = "The new password must differ from the current one.";
  const newPassword = page.getByLabel("New password", { exact: true });

  // In the page: ui-sdk's screen-reader announcer beside it says the same words.
  await expect(page.getByRole("main").getByText(message, { exact: true })).toBeVisible();
  await expect(newPassword).toHaveAccessibleDescription(
    new RegExp(message.replaceAll(".", String.raw`\.`)),
  );
  await expect(newPassword).toHaveValue("");

  // Still temporary: nothing else opens.
  await page.goto("/");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("a page without a session redirects to sign-in", async ({ page, app, user }) => {
  expect(await hasUser(app.database, user.email)).toBe(true);

  for (const path of ["/", "/settings/users", "/change-password"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expectAccessible(page);
});

test("too many failed attempts are refused for a while", async ({ page, app, user }) => {
  const person = { name: "Kim Example", email: "kim@example.com", password: "kim-password-e2e" };

  await createUser(app.baseURL, user, person);

  // Five failures, each claiming another address: the app does not trust X-Forwarded-For from a
  // client, so rotating it buys no fresh attempts.
  for (const last of [1, 2, 3, 4, 5]) {
    expect(
      await signInStatus(
        app.baseURL,
        { email: person.email, password: "not-the-password" },
        `198.51.100.${last}`,
      ),
    ).toBe(401);
  }

  // Refused, even with the right password.
  expect(await signInStatus(app.baseURL, person, "198.51.100.6")).toBe(429);

  await visit(page, "/sign-in");
  await page.getByLabel("E-mail").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const error = page.getByRole("main").getByRole("alert");

  await expect(error).toHaveText("Too many failed attempts. Try again in a few minutes.");
  // Faded in: axe measures its contrast at the end of the test.
  await expect(error).toHaveCSS("opacity", "1");
  await expect(page).toHaveURL(/\/sign-in$/);

  // Only that e-mail is refused: everyone else still signs in.
  expect(await signInStatus(app.baseURL, user)).toBe(200);
});

test("signing in goes to the app in one transition, with a session of 30 days", async ({
  page,
  secondUser,
}) => {
  await visit(page, "/sign-in");

  // Survives only if the page is never reloaded.
  await page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "yes";
  });

  await page.getByLabel("E-mail").fill(secondUser.email);
  await page.getByLabel("Password", { exact: true }).fill(secondUser.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoReload)).toBe("yes");

  const session = (await page.context().cookies()).find((cookie) =>
    cookie.name.endsWith("better-auth.session_token"),
  );

  const days = ((session?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;

  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);
  // The review's blocks fade in: axe, at the end, would measure their contrast halfway.
  await animationsDone(page);
});

test("form errors fade in and out, and do not move under reduced motion", async ({
  page,
  user,
}) => {
  await visit(page, "/sign-in");

  // Found by its role attribute: once it fades out, it leaves the accessibility tree. In the page
  // itself: the toaster keeps live regions of its own beside it.
  const error = page.getByRole("main").locator('[role="alert"]');

  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(error).toHaveText("Wrong e-mail or password.");
  await expect(error).toHaveCSS("transition-duration", "0.2s");
  await expect(error).toHaveCSS("opacity", "1");

  // Editing the form takes the error away, with the same fade.
  await page.getByLabel("Password", { exact: true }).fill(user.password.slice(0, 3));
  await expect(error).toHaveCSS("opacity", "0");

  await page.emulateMedia({ reducedMotion: "reduce" });
  // Nothing transitions any more.
  await expect(error).toHaveCSS("transition-property", "none");
});

test("the health check answers without a session", async ({ page, app, user }) => {
  // A user exists, so every page without a session would send to sign-in: the check must not.
  expect(await hasUser(app.database, user.email)).toBe(true);

  const response = await page.request.get("/health", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
});
