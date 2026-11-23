import { request as apiRequest } from "@playwright/test";
import type { Browser, Page, Request } from "@playwright/test";
import { Schema } from "effect";

import { addUser, hasLiveSession, signIn, signInStatus } from "../src/auth";
import type { TestUser } from "../src/auth";
import { sessionsOf } from "../src/database";
import { authorizeByHand, clientWithToken, refreshStatus } from "../src/oauth-by-hand";
import { expect, test, visit } from "../src/test";

// The scenario of issue #70, "How to verify", and its refusal: the administrator gives a user a
// new temporary password from the users page; the user must change it at the next sign-in, and
// everything the old password allowed ends, MCP clients included.

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

const SessionUser = Schema.Struct({ user: Schema.Struct({ mustChangePassword: Schema.Boolean }) });

/** Read-only MCP tokens `person` allowed from a page of their own. */
async function agentTokens(browser: Browser, baseURL: string, person: TestUser) {
  const context = await browser.newContext({ baseURL });

  try {
    await context.addCookies([...person.cookies]);

    return await authorizeByHand({
      baseURL,
      page: await context.newPage(),
      scope: "read",
      consent: allowReadOnly,
    });
  } finally {
    await context.close();
  }
}

/** Whether the official MCP client still gets in with this access token. */
async function agentGetsIn(baseURL: string, accessToken: string): Promise<boolean> {
  try {
    const client = await clientWithToken(baseURL, accessToken);

    await client.close();

    return true;
  } catch {
    return false;
  }
}

/** The users page's dialog that gives `person` a new temporary password. */
async function openReset(page: Page, person: { name: string; email: string }) {
  await visit(page, "/users");

  await page
    .getByRole("listitem")
    .filter({ hasText: person.email })
    .getByRole("button", { name: `Reset the password of ${person.name}` })
    .click();

  const dialog = page.getByRole("dialog", { name: `New temporary password for ${person.name}` });

  await expect(dialog).toBeVisible();

  return dialog;
}

test("reset by the administrator, the old password refused, the temporary one leads to the forced change, the old sessions ended", async ({
  userPage,
  browser,
  app,
  user,
  mcpClientId,
}) => {
  // Two devices, an MCP authorization and two sign-ins: more than the default 30 s on CI.
  test.setTimeout(60_000);
  // The harness's MCP client, registered for this test.
  expect(mcpClientId).not.toBe("");

  const person = await addUser(app.baseURL, user, {
    name: "Jude Example",
    email: "jude@example.com",
    password: "jude-password-e2e",
  });

  // Signed in on a second device too, and an AI agent allowed.
  const secondDevice = await signIn(app.baseURL, person);
  const tokens = await agentTokens(browser, app.baseURL, person);

  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(true);
  expect((await sessionsOf(app.database, person.email)).all).toBeGreaterThanOrEqual(2);

  const dialog = await openReset(userPage, person);

  // The shared dialog's motion: it fades and grows in 200 ms.
  await expect(dialog).toHaveCSS("transition-duration", "0.2s");

  await dialog.getByLabel("Temporary password").fill("jude-temporary-e2e");
  await dialog.getByRole("button", { name: "Reset the password", exact: true }).click();
  await expect(dialog).toBeHidden();

  // In the users block, beside the creation form's own live region.
  await expect(
    userPage
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: "Jude Example must now sign in with the temporary password." }),
  ).toHaveCount(1);
  await expect(userPage.getByRole("listitem").filter({ hasText: person.email })).toContainText(
    "Temporary password",
  );

  // The administrator's own row offers no reset: they change their own password themselves.
  await expect(
    userPage
      .getByRole("listitem")
      .filter({ hasText: user.email })
      .getByRole("button", { name: /Reset the password/ }),
  ).toHaveCount(0);

  // Everything the old password allowed has ended.
  expect(await hasLiveSession(app.baseURL, person)).toBe(false);
  expect(await hasLiveSession(app.baseURL, secondDevice)).toBe(false);
  expect((await sessionsOf(app.database, person.email)).all).toBe(0);
  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(false);
  expect(await refreshStatus(app.baseURL, tokens.refresh_token ?? "")).not.toBe(200);
  expect(await signInStatus(app.baseURL, person)).toBe(401);

  // The temporary password leads to the forced change, and stops working once changed.
  const context = await browser.newContext({ baseURL: app.baseURL });
  const page = await context.newPage();

  try {
    await visit(page, "/sign-in");
    await page.getByLabel("E-mail").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill("jude-temporary-e2e");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText("Your password is temporary")).toBeVisible();

    await page.goto("/");
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel("Current password").fill("jude-temporary-e2e");
    await page.getByLabel("New password").fill("jude-own-password-e2e");
    await page.getByRole("button", { name: "Change the password" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();

    const { user: changed } = Schema.decodeUnknownSync(SessionUser)(
      await (await page.request.get("/api/auth/get-session")).json(),
    );

    expect(changed.mustChangePassword).toBe(false);
  } finally {
    await context.close();
  }

  const temporary = { email: person.email, password: "jude-temporary-e2e" };

  expect(await signInStatus(app.baseURL, temporary)).toBe(401);
  expect(
    await signInStatus(app.baseURL, { email: person.email, password: "jude-own-password-e2e" }),
  ).toBe(200);
});

test("the reset dialog does not move under reduced motion", async ({ userPage, app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Ode Example",
    email: "ode@example.com",
    password: "ode-password-e2e",
  });

  await userPage.emulateMedia({ reducedMotion: "reduce" });

  const dialog = await openReset(userPage, person);

  await expect(dialog).toHaveCSS("transition-duration", "0s");

  // Cancelled: nothing changes for the user.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(await hasLiveSession(app.baseURL, person)).toBe(true);
  expect(await signInStatus(app.baseURL, person)).toBe(200);
});

/** The headers a page's own call carried, but its cookies and what the new request sets itself. */
async function replayableHeaders(call: Request) {
  const headers = await call.allHeaders();

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !["cookie", "host", "content-length"].includes(name.toLowerCase()),
    ),
  );
}

test("a non-administrator cannot reset a password", async ({
  userPage,
  secondUserPage,
  secondUser,
  app,
  user,
}) => {
  // The page is the administrator's alone.
  await secondUserPage.goto("/users");
  await expect(secondUserPage).toHaveURL(/\/$/);

  const person = await addUser(app.baseURL, user, {
    name: "Nico Example",
    email: "nico@example.com",
    password: "nico-password-e2e",
  });

  // The administrator's own call, caught on its way to the server function...
  const dialog = await openReset(userPage, person);

  const call = userPage.waitForRequest(
    (sent) => sent.method() === "POST" && sent.url().includes("/_serverFn/"),
  );

  await dialog.getByLabel("Temporary password").fill("nico-temporary-e2e");
  await dialog.getByRole("button", { name: "Reset the password", exact: true }).click();

  const sent = await call;

  await expect(dialog).toBeHidden();

  // ...then sent again, each time with a password of its own: as the other user, as nobody, and
  // last as the administrator, which proves the replay itself reaches the server function.
  const original = sent.postData() ?? "";
  const headers = await replayableHeaders(sent);

  const replay = async (cookies: TestUser["cookies"], password: string) => {
    const body = original.replace("nico-temporary-e2e", password);

    expect(body).toContain(password);

    const context = await apiRequest.newContext({
      baseURL: app.baseURL,
      extraHTTPHeaders: { Origin: app.baseURL },
      storageState: { cookies: [...cookies], origins: [] },
    });

    try {
      await context.fetch(sent.url(), { method: "POST", headers, data: body });
    } finally {
      await context.dispose();
    }
  };

  await replay(secondUser.cookies, "nico-second-user-e2e");
  await replay([], "nico-nobody-e2e");
  await replay(user.cookies, "nico-replayed-e2e");

  const works = (password: string) => signInStatus(app.baseURL, { email: person.email, password });

  expect(await works("nico-second-user-e2e")).toBe(401);
  expect(await works("nico-nobody-e2e")).toBe(401);
  expect(await works("nico-replayed-e2e")).toBe(200);
  // The other user is still themselves.
  expect(await hasLiveSession(app.baseURL, secondUser)).toBe(true);

  // The admin plugin's own route stays closed, to everyone.
  const asSecond = await apiRequest.newContext({
    baseURL: app.baseURL,
    extraHTTPHeaders: { Origin: app.baseURL },
    storageState: { cookies: [...secondUser.cookies], origins: [] },
  });

  try {
    const route = await asSecond.post("/api/auth/admin/set-user-password", {
      data: { userId: "any", newPassword: "nico-taken-over-e2e" },
    });

    expect(route.status()).toBe(403);
  } finally {
    await asSecond.dispose();
  }
});
