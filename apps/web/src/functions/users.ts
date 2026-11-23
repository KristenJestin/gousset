import { listUsers as listAllUsers } from "@gousset/auth/users";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { isAPIError } from "better-auth/api";
import { Effect, Schema } from "effect";

import { auth, db } from "@/services";

/** Only an administrator gets through; a route guard hides the page, this protects the data. */
const adminOnly = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });

  if (session?.user.role !== "admin") {
    throw new Error("Only the administrator manages users.");
  }

  return next();
});

/** Every user of the installation, oldest first. */
export const listUsers = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(() => Effect.runPromise(Effect.promise(() => listAllUsers(db))));

const NewUser = Schema.Struct({
  name: Schema.Trimmed.check(Schema.isNonEmpty()),
  email: Schema.Trimmed.check(Schema.isNonEmpty()),
  password: Schema.String,
});

/** better-auth's refusal code, for the interface to translate. */
const refusalCode = (error: Error) =>
  isAPIError(error) && error.body?.code !== undefined ? String(error.body.code) : "UNKNOWN";

/**
 * The administrator creates a user with a temporary password, which the user must change at
 * their first sign-in.
 */
export const createUser = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator(Schema.toStandardSchemaV1(NewUser))
  .handler(({ data }) =>
    Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          auth.api.createUser({
            body: {
              name: data.name,
              email: data.email,
              password: data.password,
              // No role: naming one needs `user:set-role`, which the administrator does not hold
              // (packages/auth, admin-access.ts); the plugin's default role is `user`.
              data: { mustChangePassword: true },
            },
            headers: getRequestHeaders(),
          }),
        catch: (error) => (isAPIError(error) ? refusalCode(error) : "UNKNOWN"),
      }).pipe(
        Effect.match({
          onSuccess: ({ user }) => ({ created: true as const, name: user.name }),
          onFailure: (code) => ({ created: false as const, code }),
        }),
      ),
    ),
  );
