import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { hasLiveSession, signIn } from "../src/auth";
import { sessionsOf } from "../src/database";
import { authorizeByHand, clientWithToken, refreshStatus } from "../src/oauth-by-hand";
import { recoverAdministrator, temporaryPasswordIn } from "../src/recover-admin";
import { expect, signInStatus, test, visit } from "../src/test";

// The scenario of issue #79, "How to verify", and its refusal: whoever runs the installation gives
// the only administrator, who forgot their password, a temporary one from the server; they must
// change it at the next sign-in, and everything the old password allowed ends, MCP clients
// included.
//
// The worker's administrator (`user`) is shared by every test of its worker, and the recovery ends
// its session: this file runs in workers of its own (a variable no other spec gives the app, which
// ignores it), its tests one after the other, the recovery last.
test.use({ appEnvironment: { GOUSSET_E2E_WORKER: "admin-recovery" } });

test.describe.configure({ mode: "serial" });

const allow = (page: Page) => page.getByRole("button", { name: "Allow", exact: true }).click();

const SessionUser = Schema.Struct({ user: Schema.Struct({ mustChangePassword: Schema.Boolean }) });

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

test("the recovery refuses any account but the administrator's", async ({
  app,
  user,
  secondUser,
}) => {
  const another = await recoverAdministrator(app.database, secondUser.email);

  expect(another.code).toBe(1);
  expect(another.stdout).toBe("");
  // It names the administrator's e-mail, for whoever forgot which it is.
  expect(another.stderr).toContain(`${secondUser.email} is not the administrator`);
  expect(another.stderr).toContain(user.email);

  const nobody = await recoverAdministrator(app.database, "nobody.recovery@example.com");

  expect(nobody.code).toBe(1);
  expect(nobody.stdout).toBe("");
  expect(nobody.stderr).toContain("nobody.recovery@example.com is not the administrator");

  // Nothing changed for anyone.
  expect(await hasLiveSession(app.baseURL, secondUser)).toBe(true);
  expect(await signInStatus(app.baseURL, secondUser)).toBe(200);
  expect(await hasLiveSession(app.baseURL, user)).toBe(true);
  expect(await signInStatus(app.baseURL, user)).toBe(200);
});

test("recovered from the server, the old password refused, the temporary one leads to the forced change, the old sessions ended", async ({
  app,
  user,
  userPage,
  browser,
  mcpClientId,
}) => {
  // Two devices, an MCP authorization, the command and a sign-in: more than the default 30 s on CI.
  test.setTimeout(60_000);
  expect(mcpClientId).not.toBe("");

  // Signed in on a second device too, and an AI agent allowed.
  const secondDevice = await signIn(app.baseURL, user);

  const tokens = await authorizeByHand({
    baseURL: app.baseURL,
    page: userPage,
    scope: "read offline_access",
    consent: allow,
  });

  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(true);
  expect(tokens.refresh_token).toBeDefined();

  // The e-mail as the person types it: the account is found whatever its case.
  const recovery = await recoverAdministrator(app.database, user.email.toUpperCase());

  expect(recovery.code).toBe(0);
  expect(recovery.stderr).toBe("");

  const temporary = temporaryPasswordIn(recovery.stdout);

  // Printed once, and nothing else of a secret: the database's password stays out.
  expect(recovery.stdout.split(temporary)).toHaveLength(2);
  expect(temporary).not.toBe(user.password);

  // Everything the old password allowed has ended.
  expect(await hasLiveSession(app.baseURL, user)).toBe(false);
  expect(await hasLiveSession(app.baseURL, secondDevice)).toBe(false);
  expect((await sessionsOf(app.database, user.email)).all).toBe(0);
  expect(await agentGetsIn(app.baseURL, tokens.access_token)).toBe(false);
  expect(await refreshStatus(app.baseURL, tokens.refresh_token ?? "")).not.toBe(200);
  expect(await signInStatus(app.baseURL, user)).toBe(401);

  // The temporary password leads to the forced change, and stops working once changed.
  const context = await browser.newContext({ baseURL: app.baseURL });
  const page = await context.newPage();

  try {
    await visit(page, "/sign-in");
    await page.getByLabel("E-mail").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(temporary);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText("Your password is temporary")).toBeVisible();
    // Said as it happened: from the server, not by "the administrator", who is the one reading.
    await expect(
      page.getByText(/Your password was reset from the server on [A-Z][a-z]+ \d{1,2}, \d{4}\./),
    ).toBeVisible();
    await expect(page.getByText(/The administrator reset your password/)).toHaveCount(0);

    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/change-password$/);

    await page.getByLabel("Current password").fill(temporary);
    await page.getByLabel("New password").fill("alex-recovered-password-e2e");
    await page.getByRole("button", { name: "Change the password" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();

    const { user: changed } = Schema.decodeUnknownSync(SessionUser)(
      await (await page.request.get("/api/auth/get-session")).json(),
    );

    expect(changed.mustChangePassword).toBe(false);

    // Still the administrator: Settings, Users opens.
    await visit(page, "/settings/users");
    await expect(page).toHaveURL(/\/settings\/users$/);
  } finally {
    await context.close();
  }

  expect(await signInStatus(app.baseURL, { email: user.email, password: temporary })).toBe(401);
  expect(
    await signInStatus(app.baseURL, { email: user.email, password: "alex-recovered-password-e2e" }),
  ).toBe(200);
});
