import { request as apiRequest } from "@playwright/test";
import type { Browser, Locator, Page, Request } from "@playwright/test";
import { Schema } from "effect";

import { addUser, createUser, hasLiveSession, signIn, signInStatus } from "../src/auth";
import type { TestUser } from "../src/auth";
import { resetDuringNextChange, sessionsOf, setMustChangePassword } from "../src/database";
import { authorizeByHand, clientWithToken, refreshStatus } from "../src/oauth-by-hand";
import { onPhone } from "../src/frame";
import { TEST_CLIENT_ID, TEST_REDIRECT_URL } from "../src/oauth-client";
import { expect, fixDay, test, visit } from "../src/test";

// The scenario of issue #70, "How to verify", and its refusal: the administrator gives a user a
// new temporary password from Settings, Users; the user must change it at the next sign-in, and
// everything the old password allowed ends, MCP clients included.

// A client asking only to read gets a single "Allow" on the consent page.
const allow = (page: Page) => page.getByRole("button", { name: "Allow", exact: true }).click();

/**
 * Clicks a button of a page the browser loaded by itself (a redirect, `location.assign`): before
 * the page hydrates, a click does nothing and is lost (#97), so it waits for the button to work.
 */
async function clickOnceHydrated(button: Locator) {
  await expect(button).toHaveAttribute("data-hydrated");
  await button.click();
}

const SessionUser = Schema.Struct({ user: Schema.Struct({ mustChangePassword: Schema.Boolean }) });

/** An authorization the harness's MCP client starts, asking to read; its code is never exchanged. */
function authorizeUrl(baseURL: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: TEST_CLIENT_ID,
    redirect_uri: TEST_REDIRECT_URL,
    scope: "read",
    state: "e2e-state",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${baseURL}/mcp`,
  });

  return `${baseURL}/api/auth/oauth2/authorize?${query.toString()}`;
}

/** Read-only MCP tokens, a refresh token among them, `person` allowed from a page of their own. */
async function agentTokens(browser: Browser, baseURL: string, person: TestUser) {
  const context = await browser.newContext({ baseURL });

  try {
    await context.addCookies([...person.cookies]);

    return await authorizeByHand({
      baseURL,
      page: await context.newPage(),
      scope: "read offline_access",
      consent: allow,
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

/** The dialog of Settings, Users that gives `person` a new temporary password. */
async function openReset(page: Page, person: { name: string; email: string }) {
  await visit(page, "/settings/users");

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
    email: "jude.reset@example.com",
    password: "jude-password-e2e",
  });

  // Signed in on a second device too, and an AI agent allowed.
  const secondDevice = await signIn(app.baseURL, person);
  const tokens = await agentTokens(browser, app.baseURL, person);

  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(true);
  expect(tokens.refresh_token).toBeDefined();
  expect((await sessionsOf(app.database, person.email)).all).toBeGreaterThanOrEqual(2);

  const dialog = await openReset(userPage, person);

  // The shared dialog's motion: it fades and grows in 200 ms; on a phone it rises in 300 ms.
  await expect(dialog).toHaveCSS("transition-duration", onPhone(userPage) ? "0.3s" : "0.2s");

  await dialog.getByLabel("Temporary password").fill("jude-temporary-e2e");
  await dialog.getByRole("button", { name: "Reset the password", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Said in the users block, once the dialog has closed.
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
    // The user learns that, and when, the administrator reset it.
    await expect(
      page.getByText(/The administrator reset your password on [A-Z][a-z]+ \d{1,2}, \d{4}\./),
    ).toBeVisible();

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
    email: "ode.reset@example.com",
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
  await secondUserPage.goto("/settings/users");
  await expect(secondUserPage).toHaveURL(/\/$/);

  const person = await addUser(app.baseURL, user, {
    name: "Nico Example",
    email: "nico.reset@example.com",
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

/** A call a page made to a server function, kept to be sent again with other cookies. */
type Call = {
  url: string;
  method: string;
  headers: { [name: string]: string };
  body: string | null;
};

function keep(sent: Request): Call {
  const headers = Object.fromEntries(
    Object.entries(sent.headers()).filter(
      ([name]) => !["cookie", "host", "content-length"].includes(name.toLowerCase()),
    ),
  );

  return { url: sent.url(), method: sent.method(), headers, body: sent.postData() };
}

/** The status and text the app answers a request carrying these cookies. */
async function answerTo(
  baseURL: string,
  cookies: TestUser["cookies"],
  call: Pick<Call, "url" | "method"> & { headers?: Call["headers"]; body?: string | null },
) {
  const context = await apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState: { cookies: [...cookies], origins: [] },
  });

  // A call kept from a page carries its own content type; a body written here is JSON.
  const headers =
    call.body === undefined || call.body === null
      ? { ...call.headers }
      : { "content-type": "application/json", ...call.headers };

  try {
    const answer = await context.fetch(call.url, {
      method: call.method,
      headers,
      data: call.body ?? undefined,
      maxRedirects: 0,
    });

    return { status: answer.status(), text: await answer.text() };
  } finally {
    await context.dispose();
  }
}

const HELD = "PASSWORD_CHANGE_REQUIRED";

/** The operations' line search: a read of the user's data, the only call with a page size. */
const isLinesCall = (call: Call) =>
  call.method === "GET" && decodeURIComponent(call.url).includes("limit");

test("a temporary password opens nothing but its change, on the server too", async ({
  browser,
  userPage,
  app,
  user,
  secondUser,
}) => {
  test.setTimeout(90_000);

  const person = await addUser(app.baseURL, user, {
    name: "Ivy Example",
    email: "ivy.reset@example.com",
    password: "ivy-password-e2e",
  });

  // While the password is their own: the calls their pages make for their lines and a setting,
  // kept to be sent again.
  const calls: Array<Call> = [];
  const context = await browser.newContext({ baseURL: app.baseURL });

  try {
    await context.addCookies([...person.cookies]);

    const page = await context.newPage();

    page.on("request", (sent) => {
      if (sent.url().includes("/_serverFn/")) {
        calls.push(keep(sent));
      }
    });

    await fixDay(page, "2026-10-31");
    await visit(page, "/accounts");
    // The operations' lines load on hover, from the browser.
    await page.getByRole("link", { name: "Operations" }).hover();
    await expect.poll(() => calls.some(isLinesCall)).toBe(true);

    await visit(page, "/settings");

    const saved = page.waitForResponse(
      (answer) => answer.request().method() === "POST" && answer.url().includes("/_serverFn/"),
    );

    await page.getByRole("switch", { name: "Single-key shortcuts" }).click();
    expect((await saved).ok()).toBe(true);
  } finally {
    await context.close();
  }

  const linesCall = calls.find(isLinesCall);
  const settingCall = calls.find((call) => call.method === "POST");

  if (linesCall === undefined || settingCall === undefined) {
    throw new Error("The pages made no call to read the lines or to save the setting.");
  }

  for (const call of [linesCall, settingCall]) {
    const own = await answerTo(app.baseURL, person.cookies, call);

    expect(own.status, call.url).toBe(200);
    expect(own.text).not.toContain(HELD);
  }

  // The administrator resets the password; the temporary one signs in, on two devices.
  const dialog = await openReset(userPage, person);

  await dialog.getByLabel("Temporary password").fill("ivy-temporary-e2e");
  await dialog.getByRole("button", { name: "Reset the password", exact: true }).click();
  await expect(dialog).toBeHidden();

  const temporary = { ...person, password: "ivy-temporary-e2e" };
  const held = await signIn(app.baseURL, temporary);
  const otherDevice = await signIn(app.baseURL, temporary);

  // No data and no setting: the server functions refuse it, whatever the pages show.
  for (const call of [linesCall, settingCall]) {
    expect((await answerTo(app.baseURL, held.cookies, call)).text, call.url).toContain(HELD);
  }

  // No job: another user's session is told the job is not theirs, this one is refused outright.
  const job = { url: "/api/jobs/no-such-job/events", method: "GET" };

  expect((await answerTo(app.baseURL, held.cookies, job)).status).toBe(403);
  expect((await answerTo(app.baseURL, secondUser.cookies, job)).status).toBe(404);

  // No import: a statement file sent to the upload is refused before it is read.
  const upload = {
    url: "/api/imports?name=statement.bin",
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: "not a statement",
  };

  const uploaded = await answerTo(app.baseURL, held.cookies, upload);

  expect(uploaded.status).toBe(403);
  expect(uploaded.text).toContain(HELD);
  // Another user's session gets past the guard, to the file's own refusal, which writes nothing.
  expect((await answerTo(app.baseURL, secondUser.cookies, upload)).status).toBe(422);

  // None of better-auth's own routes on the account.
  const renamed = await answerTo(app.baseURL, held.cookies, {
    url: "/api/auth/update-user",
    method: "POST",
    body: JSON.stringify({ name: "Someone Else" }),
  });

  expect(renamed.status).toBe(403);
  expect(renamed.text).toContain(HELD);

  // Signing out and the change itself stay open.
  const signedOut = await answerTo(app.baseURL, otherDevice.cookies, {
    url: "/api/auth/sign-out",
    method: "POST",
    body: "{}",
  });

  expect(signedOut.status).toBe(200);

  const changed = await answerTo(app.baseURL, held.cookies, {
    url: "/api/auth/change-password",
    method: "POST",
    body: JSON.stringify({
      currentPassword: "ivy-temporary-e2e",
      newPassword: "ivy-own-password-e2e",
    }),
  });

  expect(changed.status).toBe(200);

  // Their own password again: the same session reaches the month.
  const after = await answerTo(app.baseURL, held.cookies, linesCall);

  expect(after.status).toBe(200);
  expect(after.text).not.toContain(HELD);
});

test("a temporary password authorizes no MCP client, and a held user's tokens reach nothing", async ({
  browser,
  app,
  user,
  secondUser,
  mcpClientId,
}) => {
  test.setTimeout(60_000);
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  // A user the administrator just created, still on the temporary password.
  const person = {
    name: "Pia Example",
    email: "pia.reset@example.com",
    password: "pia-temporary-e2e",
  };

  await createUser(app.baseURL, user, person);

  const held = await signIn(app.baseURL, { ...person, cookies: [] });
  const authorize = { url: authorizeUrl(app.baseURL), method: "GET" };
  const refused = await answerTo(app.baseURL, held.cookies, authorize);

  expect(refused.status).toBe(403);
  expect(refused.text).toContain(HELD);
  // Another user's session goes on to the consent.
  expect((await answerTo(app.baseURL, secondUser.cookies, authorize)).status).not.toBe(403);

  const consent = await answerTo(app.baseURL, held.cookies, {
    url: "/api/auth/oauth2/consent",
    method: "POST",
    body: JSON.stringify({ accept: true, scope: "read" }),
  });

  expect(consent.status).toBe(403);
  expect(consent.text).toContain(HELD);

  // A user whose tokens are live: while the flag is on, the MCP door lets none of them in.
  const member = await addUser(app.baseURL, user, {
    name: "Rui Example",
    email: "rui.reset@example.com",
    password: "rui-password-e2e",
  });

  const tokens = await agentTokens(browser, app.baseURL, member);

  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(true);

  await setMustChangePassword(app.database, member.email, true);
  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(false);

  // The flag alone held them: cleared, the same token works again.
  await setMustChangePassword(app.database, member.email, false);
  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(true);
});

test("signing in for an MCP client on a temporary password goes to the change, then the authorization resumes", async ({
  browser,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(60_000);
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  // A user on the administrator's temporary password, whose agent asks for access: what follows a
  // reset, which ends every client, and a new user's first connection.
  const person = {
    name: "Lia Example",
    email: "lia.reset@example.com",
    password: "lia-temporary-e2e",
  };

  await createUser(app.baseURL, user, person);

  const context = await browser.newContext({ baseURL: app.baseURL });
  const page = await context.newPage();

  try {
    const callback = new Promise<URL>((resolve) => {
      void page.route(`${TEST_REDIRECT_URL}**`, async (route) => {
        resolve(new URL(route.request().url()));
        await route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><title>Connected</title><main><h1>Connected</h1></main></html>',
        });
      });
    });

    // Signed out: the authorization sends the browser to sign in, for that client.
    await page.goto(authorizeUrl(app.baseURL));
    await expect(page).toHaveURL(/\/sign-in\?.*client_id=/);

    await page.getByLabel("E-mail").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(person.password);
    await clickOnceHydrated(page.getByRole("button", { name: "Sign in" }));

    // The change first, not an error on the sign-in page.
    await expect(page).toHaveURL(/\/change-password\?/);
    await expect(page.getByText("Your password is temporary")).toBeVisible();

    await page.getByLabel("Current password").fill(person.password);
    await page.getByLabel("New password").fill("lia-own-password-e2e");
    await clickOnceHydrated(page.getByRole("button", { name: "Change the password" }));

    // Then the authorization goes on, to the consent and back to the client with its code.
    await clickOnceHydrated(page.getByRole("button", { name: "Allow", exact: true }));

    const returned = (await callback).searchParams;

    await page.waitForURL(`${TEST_REDIRECT_URL}**`);
    expect(returned.get("code")).not.toBeNull();
    expect(returned.get("state")).toBe("e2e-state");
  } finally {
    await context.close();
  }
});

/** The app's own scripts, whatever bundle they come from. */
const APP_SCRIPTS = /\.m?js(\?.*)?$/;

/**
 * Holds back the scripts a page at `path` asks for, until the returned function is called: the page
 * stays as the server drew it, before hydration, as a slow phone shows it for a while.
 */
async function holdScriptsOf(page: Page, path: string) {
  const { promise: released, resolve: release } = Promise.withResolvers<void>();

  await page.route(APP_SCRIPTS, async (route) => {
    if (new URL(route.request().frame().url()).pathname === path) {
      await released;
    }

    await route.fallback();
  });

  return () => release();
}

test("the forced change and the consent say when their buttons work, and send nothing before, so the resumed authorization loses no tap", async ({
  browser,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(60_000);
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  // A user on the administrator's temporary password, signed in for their agent: the sign-in sent
  // them to the change, the authorization to resume in its address (#97).
  const person = {
    name: "Noa Example",
    email: "noa.reset@example.com",
    password: "noa-temporary-e2e",
  };

  await createUser(app.baseURL, user, person);

  const held = await signIn(app.baseURL, { ...person, cookies: [] });
  const resume = new URL(authorizeUrl(app.baseURL)).searchParams.toString();
  const context = await browser.newContext({ baseURL: app.baseURL });

  try {
    await context.addCookies([...held.cookies]);

    const page = await context.newPage();

    const callback = new Promise<URL>((resolve) => {
      void page.route(`${TEST_REDIRECT_URL}**`, async (route) => {
        resolve(new URL(route.request().url()));
        await route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><title>Connected</title><main><h1>Connected</h1></main></html>',
        });
      });
    });

    const sent: Array<string> = [];

    page.on("request", (request) => {
      if (new URL(request.url()).searchParams.has("currentPassword")) {
        sent.push(request.url());
      }
    });

    const releaseChange = await holdScriptsOf(page, "/change-password");
    const releaseConsent = await holdScriptsOf(page, "/consent");

    // Before its scripts run, the change is a plain button that says it does not work yet: a click
    // sends no form, which would carry the passwords in the address and lose the authorization.
    const address = `/change-password?${new URLSearchParams({ resume }).toString()}`;

    await page.goto(address, { waitUntil: "commit" });

    const change = page.getByRole("button", { name: "Change the password" });

    await page.getByLabel("Current password").fill(person.password);
    await page.getByLabel("New password").fill("noa-own-password-e2e");
    await expect(change).toHaveAttribute("type", "button");
    await expect(change).not.toHaveAttribute("data-hydrated");
    await change.click();
    expect(sent).toEqual([]);
    expect(new URL(page.url()).searchParams.get("resume")).toBe(resume);

    releaseChange();
    await clickOnceHydrated(change);

    // Before its scripts run, the consent says its answers do not work yet: the click waits.
    const allow = page.getByRole("button", { name: "Allow", exact: true });

    await expect(allow).toBeVisible();
    await expect(allow).not.toHaveAttribute("data-hydrated");
    releaseConsent();
    await clickOnceHydrated(allow);

    const returned = (await callback).searchParams;

    expect(returned.get("code")).not.toBeNull();
    expect(returned.get("state")).toBe("e2e-state");
  } finally {
    await context.close();
  }
});

test("a reset that lands during the user's own change keeps its flag", async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Kai Example",
    email: "kai.reset@example.com",
    password: "kai-password-e2e",
  });

  // The administrator's reset commits between the change's new password and the clearing of the
  // flag that follows it.
  const stopResetting = await resetDuringNextChange(app.database, person.email);

  try {
    const changed = await answerTo(app.baseURL, person.cookies, {
      url: "/api/auth/change-password",
      method: "POST",
      body: JSON.stringify({
        currentPassword: person.password,
        newPassword: "kai-own-password-e2e",
      }),
    });

    expect(changed.status).toBe(200);
  } finally {
    await stopResetting();
  }

  // The change did not clear the reset it never saw: the next page still asks for a change.
  const session = await answerTo(app.baseURL, person.cookies, {
    url: "/api/auth/get-session",
    method: "GET",
  });

  expect(
    Schema.decodeUnknownSync(SessionUser)(JSON.parse(session.text)).user.mustChangePassword,
  ).toBe(true);
});
