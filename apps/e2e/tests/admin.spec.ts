import { request as apiRequest } from "@playwright/test";
import { Schema } from "effect";

import { addUser, hasLiveSession, signInStatus } from "../src/auth";
import type { TestUser } from "../src/auth";
import { hasUser, sessionsOf } from "../src/database";
import { expect, test } from "../src/test";

// The scenario of issue #65, "How to verify", and the other admin routes it closes: the
// administrator manages users, and never gets into another user's session or account.

const LiveSession = Schema.Struct({
  session: Schema.Struct({ token: Schema.String }),
  user: Schema.Struct({ id: Schema.String, email: Schema.String, role: Schema.String }),
});

/** A request context carrying this user's session, speaking to the app as its pages do. */
function asUser(baseURL: string, person: TestUser) {
  return apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState: { cookies: [...person.cookies], origins: [] },
  });
}

/** The session these cookies carry, as better-auth gives it to its own user. */
async function sessionOf(baseURL: string, person: TestUser) {
  const context = await asUser(baseURL, person);

  try {
    return Schema.decodeUnknownSync(LiveSession)(
      await (await context.get("/api/auth/get-session")).json(),
    );
  } finally {
    await context.dispose();
  }
}

test("the administrator's call to impersonate-user is refused, and no session for the target is created", async ({
  app,
  user,
}) => {
  const target = await addUser(app.baseURL, user, {
    name: "Noa Example",
    email: "noa@example.com",
    password: "noa-password-e2e",
  });

  const { user: targetUser } = await sessionOf(app.baseURL, target);
  const before = await sessionsOf(app.database, target.email);
  const asAdmin = await asUser(app.baseURL, user);

  try {
    const answer = await asAdmin.post("/api/auth/admin/impersonate-user", {
      data: { userId: targetUser.id },
    });

    expect(answer.status()).toBe(403);
    expect(await answer.text()).toContain("YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS");

    // The administrator is still themselves, and holds no session of the target's.
    const { cookies } = await asAdmin.storageState();

    expect(cookies.some((cookie) => cookie.name.endsWith("admin_session"))).toBe(false);

    const still = Schema.decodeUnknownSync(LiveSession)(
      await (await asAdmin.get("/api/auth/get-session")).json(),
    );

    expect(still.user.email).toBe(user.email);
  } finally {
    await asAdmin.dispose();
  }

  expect(await sessionsOf(app.database, target.email)).toEqual(before);
  expect(before.impersonated).toBe(0);
});

test("the administrator cannot reach a user's sessions, password, role, e-mail or account", async ({
  app,
  user,
}) => {
  const target = await addUser(app.baseURL, user, {
    name: "Ari Example",
    email: "ari@example.com",
    password: "ari-password-e2e",
  });

  const { session, user: targetUser } = await sessionOf(app.baseURL, target);
  const before = await sessionsOf(app.database, target.email);
  const userId = targetUser.id;
  const takenOver = "ari-taken-over-e2e";
  const asAdmin = await asUser(app.baseURL, user);

  try {
    const refusals = [
      asAdmin.post("/api/auth/admin/list-user-sessions", { data: { userId } }),
      asAdmin.post("/api/auth/admin/revoke-user-session", {
        data: { sessionToken: session.token },
      }),
      asAdmin.post("/api/auth/admin/revoke-user-sessions", { data: { userId } }),
      asAdmin.post("/api/auth/admin/set-user-password", {
        data: { userId, newPassword: takenOver },
      }),
      asAdmin.post("/api/auth/admin/set-role", { data: { userId, role: "admin" } }),
      asAdmin.post("/api/auth/admin/update-user", {
        data: { userId, data: { email: "ari.taken.over@example.com" } },
      }),
      asAdmin.post("/api/auth/admin/update-user", {
        data: { userId, data: { name: "Someone Else" } },
      }),
      asAdmin.post("/api/auth/admin/remove-user", { data: { userId } }),
      asAdmin.get(`/api/auth/admin/get-user?id=${encodeURIComponent(userId)}`),
      asAdmin.get("/api/auth/admin/list-users"),
      // Creating a user stays open, but not as a second administrator.
      asAdmin.post("/api/auth/admin/create-user", {
        data: {
          name: "Eli Example",
          email: "eli@example.com",
          password: "eli-temporary-e2e",
          role: "admin",
        },
      }),
    ];

    for (const answer of await Promise.all(refusals)) {
      expect(answer.status(), answer.url()).toBe(403);
    }
  } finally {
    await asAdmin.dispose();
  }

  // Nothing changed for the user: the same sessions, still alive, the same password, the same
  // e-mail and role.
  expect(await sessionsOf(app.database, target.email)).toEqual(before);
  expect(await hasLiveSession(app.baseURL, target)).toBe(true);
  expect(await signInStatus(app.baseURL, target)).toBe(200);
  expect(await signInStatus(app.baseURL, { email: target.email, password: takenOver })).toBe(401);
  expect(await hasUser(app.database, "ari.taken.over@example.com")).toBe(false);
  expect(await hasUser(app.database, "eli@example.com")).toBe(false);

  const after = await sessionOf(app.baseURL, target);

  expect(after.user.email).toBe(target.email);
  expect(after.user.role).toBe("user");
});
