import { request } from "@playwright/test";
import type { APIResponse, Cookie } from "@playwright/test";
import { Schema } from "effect";

/**
 * How the harness gets its users, the way the app gives them (#5):
 *
 * - the first user of an installation signs up at `POST /api/auth/sign-up/email`
 *   (`{ name, email, password }`), is signed in at once and is the administrator; sign-up is closed
 *   after that;
 * - the administrator creates every other user with a temporary password
 *   (`POST /api/auth/admin/create-user`), which the user changes at the first sign-in
 *   (`POST /api/auth/change-password`) before anything else.
 *
 * better-auth checks each request's `Origin` against `BETTER_AUTH_URL`.
 */
export const SIGN_UP_PATH = "/api/auth/sign-up/email";
export const SIGN_IN_PATH = "/api/auth/sign-in/email";
export const CREATE_USER_PATH = "/api/auth/admin/create-user";
export const CHANGE_PASSWORD_PATH = "/api/auth/change-password";

/** A made-up user of the app; `cookies` carry its session. */
export type TestUser = {
  name: string;
  email: string;
  password: string;
  cookies: ReadonlyArray<Cookie>;
};

type Person = { name: string; email: string; password: string };

const SignedUp = Schema.Struct({
  user: Schema.Struct({ email: Schema.String }),
});

/** A made-up person per worker and role: `@example.com` only, never a real address. */
export function madeUpUser(role: "first" | "second", slot: number): Person {
  const name = role === "first" ? "Alex Example" : "Sam Example";
  const local = role === "first" ? "alex" : "sam";

  return {
    name,
    email: `${local}.worker${slot}@example.com`,
    password: `e2e-${local}-password-${slot}`,
  };
}

/**
 * A made-up person for one test alone, named by `local` ("jules" is Jules Example): a test that
 * changes what an account keeps, like its colour scheme, uses one, so that the worker's shared
 * users stay as every other test expects them. Each test picks a name no other test uses.
 */
export function personOfItsOwn(local: string): Person {
  const name = `${local.charAt(0).toUpperCase()}${local.slice(1)} Example`;

  return { name, email: `${local}@example.com`, password: `e2e-${local}-password` };
}

/** A request context speaking to the app as its own pages do. */
function appRequest(baseURL: string, headers: Record<string, string> = {}) {
  return request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL, ...headers } });
}

async function ensureOk(answer: Promise<APIResponse>, what: string) {
  const response = await answer;

  if (!response.ok()) {
    throw new Error(`${what} answered ${response.status()}.`);
  }
}

/**
 * Tries to sign in with an e-mail and a password, and gives the HTTP status the app answers.
 * `forwardedFor` sends an `X-Forwarded-For`, which the app must not trust from a client.
 */
export async function signInStatus(
  baseURL: string,
  credentials: { email: string; password: string },
  forwardedFor?: string,
): Promise<number> {
  const context = await appRequest(
    baseURL,
    forwardedFor === undefined ? {} : { "X-Forwarded-For": forwardedFor },
  );

  try {
    const response = await context.post(SIGN_IN_PATH, {
      data: { email: credentials.email, password: credentials.password },
    });

    return response.status();
  } finally {
    await context.dispose();
  }
}

/** The first user of an installation, through sign-up: the administrator. */
export async function signUp(baseURL: string, person: Person): Promise<TestUser> {
  const context = await appRequest(baseURL);

  try {
    const response = await context.post(SIGN_UP_PATH, { data: person });

    if (!response.ok()) {
      throw new Error(`Sign-up of ${person.email} answered ${response.status()}.`);
    }

    const answer = Schema.decodeUnknownSync(SignedUp)(await response.json());

    if (answer.user.email !== person.email) {
      throw new Error(`Sign-up answered for ${answer.user.email}, not ${person.email}.`);
    }

    const { cookies } = await context.storageState();

    return { ...person, cookies };
  } finally {
    await context.dispose();
  }
}

/**
 * The administrator creates a user whose password is temporary, as the users page does: the user
 * must change it at the first sign-in.
 */
export async function createUser(baseURL: string, admin: TestUser, person: Person): Promise<void> {
  const asAdmin = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState: { cookies: [...admin.cookies], origins: [] },
  });

  try {
    await ensureOk(
      asAdmin.post(CREATE_USER_PATH, {
        data: { ...person, data: { mustChangePassword: true } },
      }),
      `Creating ${person.email}`,
    );
  } finally {
    await asAdmin.dispose();
  }
}

/**
 * A session of its own for a user already created: for a test that ends its session (signs out),
 * which must never end the worker's shared one (`userPage`, `secondUserPage`).
 */
export async function signIn(baseURL: string, person: TestUser): Promise<TestUser> {
  const context = await appRequest(baseURL);

  try {
    await ensureOk(
      context.post(SIGN_IN_PATH, { data: { email: person.email, password: person.password } }),
      `Signing in ${person.email}`,
    );

    const { cookies } = await context.storageState();

    return { ...person, cookies };
  } finally {
    await context.dispose();
  }
}

const LiveSession = Schema.Struct({ session: Schema.Struct({ id: Schema.String }) });

/** Whether the session these cookies carry is still alive on the app. */
export async function hasLiveSession(baseURL: string, person: TestUser): Promise<boolean> {
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState: { cookies: [...person.cookies], origins: [] },
  });

  try {
    const answer = await context.get("/api/auth/get-session");

    // better-auth answers `null` for a session it no longer knows.
    return answer.ok() && Schema.is(LiveSession)(await answer.json());
  } finally {
    await context.dispose();
  }
}

/**
 * Another user of the installation: created by the administrator with a temporary password, then
 * signed in once to change it, as the app asks at the first sign-in.
 */
export async function addUser(baseURL: string, admin: TestUser, person: Person): Promise<TestUser> {
  const temporary = `${person.password}-temporary`;

  await createUser(baseURL, admin, { ...person, password: temporary });

  const asUser = await appRequest(baseURL);

  try {
    await ensureOk(
      asUser.post(SIGN_IN_PATH, { data: { email: person.email, password: temporary } }),
      `Signing in ${person.email}`,
    );
    await ensureOk(
      asUser.post(CHANGE_PASSWORD_PATH, {
        data: {
          currentPassword: temporary,
          newPassword: person.password,
          revokeOtherSessions: true,
        },
      }),
      `Changing the password of ${person.email}`,
    );

    const { cookies } = await asUser.storageState();

    return { ...person, cookies };
  } finally {
    await asUser.dispose();
  }
}
