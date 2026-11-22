import { request } from "@playwright/test";
import type { Cookie } from "@playwright/test";
import { Schema } from "effect";

/**
 * How the harness signs a user up, in one place so that the auth ticket (#5) can change it.
 *
 * It assumes what the starter's better-auth gives today: e-mail and password sign-up is open to
 * anyone at `POST /api/auth/sign-up/email` with `{ name, email, password }`, signs the new user in
 * at once (a session cookie in the answer), and checks the request's `Origin` against
 * `BETTER_AUTH_URL`. Sign-in is `POST /api/auth/sign-in/email` with `{ email, password }`.
 */
export const SIGN_UP_PATH = "/api/auth/sign-up/email";
export const SIGN_IN_PATH = "/api/auth/sign-in/email";

/** A made-up user, signed up through the app; `cookies` carry its session. */
export type TestUser = {
  name: string;
  email: string;
  password: string;
  cookies: ReadonlyArray<Cookie>;
};

const SignedUp = Schema.Struct({
  user: Schema.Struct({ email: Schema.String }),
});

/** A made-up person per worker and role: `@example.com` only, never a real address. */
export function madeUpUser(role: "first" | "second", slot: number) {
  const name = role === "first" ? "Alex Example" : "Sam Example";
  const local = role === "first" ? "alex" : "sam";

  return {
    name,
    email: `${local}.worker${slot}@example.com`,
    password: `e2e-${local}-password-${slot}`,
  };
}

/** Tries to sign in with an e-mail and a password, and gives the HTTP status the app answers. */
export async function signInStatus(
  baseURL: string,
  credentials: { email: string; password: string },
): Promise<number> {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });

  try {
    const response = await context.post(SIGN_IN_PATH, {
      data: { email: credentials.email, password: credentials.password },
    });

    return response.status();
  } finally {
    await context.dispose();
  }
}

export async function signUp(
  baseURL: string,
  person: { name: string; email: string; password: string },
): Promise<TestUser> {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });

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
