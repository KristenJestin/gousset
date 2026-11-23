import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { mcp } from "@better-auth/mcp";
import { copyDefaultCategories, setLanguageOf } from "@gousset/core/default-categories";
import type { Database } from "@gousset/db";
import { tables } from "@gousset/db/schema/index";
import { userDataLayer } from "@gousset/db/user-data";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { admin, jwt } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Effect, Option, Schema } from "effect";

import { adminAccess } from "./admin-access";
import { TOO_MANY_ATTEMPTS } from "./attempt-guard";
import { cimdOptions } from "./cimd";
import { CLIENT_ADDRESS_HEADER } from "./client-address";
import { CONSENT_PATH, ISSUED_AT_MS_CLAIM, McpScope, SIGN_IN_PATH, mcpResourceOf } from "./mcp";
import { alignTokensWithConsents, currentGrant, revokeAllClients } from "./mcp-door";
import { isMetadataDocumentClient, redirectBoundToClient, withReadForWrite } from "./mcp-guards";
import { clearTemporaryPassword } from "./password-reset";

export { guardAttempt } from "./attempt-guard";

export {
  createIgnoredForwardWarning,
  resolveClientAddress,
  withClientAddress,
} from "./client-address";

export { createSignInLimits } from "./sign-in-attempts";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  /** Left out in development only: better-auth refuses to start without it in production. */
  BETTER_AUTH_SECRET?: string | undefined;
};

/** The codes of Gousset's own refusals, which the interface translates. */
export const AuthErrorCode = {
  signUpClosed: "SIGN_UP_CLOSED",
  tooManyAttempts: TOO_MANY_ATTEMPTS,
  passwordUnchanged: "PASSWORD_UNCHANGED",
  passwordChangeRequired: "PASSWORD_CHANGE_REQUIRED",
} as const;

/**
 * The only routes a session with a temporary password reaches: signing in and out, reading the
 * session (the pages' guard sends it to the change), and the change itself. Everything else waits
 * for a password only the user knows: the administrator chose the temporary one (#70).
 */
const OPEN_WHILE_TEMPORARY = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/get-session",
  "/change-password",
]);

const SESSION_DAYS = 30;

const passwordsOf = Schema.decodeUnknownOption(
  Schema.Struct({ currentPassword: Schema.String, newPassword: Schema.String }),
);

/** What the authorize endpoint's guard reads of its query. */
const authorizeQueryOf = Schema.decodeUnknownOption(
  Schema.Struct({
    client_id: Schema.String,
    redirect_uri: Schema.optional(Schema.String),
    prompt: Schema.optional(Schema.String),
    scope: Schema.optional(Schema.String),
  }),
);

/** A session's user and the one flag the hooks read of it. */
const flaggedSessionOf = Schema.decodeUnknownOption(
  Schema.Struct({
    user: Schema.Struct({ mustChangePassword: Schema.optional(Schema.NullOr(Schema.Boolean)) }),
  }),
);

/** Who changes their password, and the reset their temporary one came from, if any. */
const changerOf = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.String,
    passwordResetAt: Schema.optional(
      Schema.NullOr(Schema.Union([Schema.Date, Schema.String, Schema.Number])),
    ),
  }),
);

/** The user an administrator's action is about (a ban). */
const targetUserOf = Schema.decodeUnknownOption(Schema.Struct({ userId: Schema.String }));

/**
 * The admin plugin's routes after which a user's MCP clients lose their access. The administrator's
 * password reset is Gousset's own (password-reset.ts), which revokes them itself.
 */
const CUTTING_ADMIN_ACTIONS = new Set(["/admin/ban-user"]);

/**
 * The MCP door's authorization server (docs/mcp.md): OAuth 2.1 with tokens bound to the `/mcp`
 * resource and signed by the JWT plugin, clients identified by their Client ID Metadata Document,
 * no dynamic client registration. Its tables carry the `auth_` prefix like the others.
 */
function mcpPlugins(resource: string) {
  return [
    jwt({ schema: { jwks: { modelName: "authJwks" } } }),
    mcp({
      resource,
      loginPage: SIGN_IN_PATH,
      consentPage: CONSENT_PATH,
      scopes: [McpScope.read, McpScope.write, "offline_access"],
      // Clients come from their metadata documents (CIMD), never from a user: the endpoints that
      // create, change or list OAuth clients and resources are closed to everyone.
      clientPrivileges: () => false,
      resourcePrivileges: () => false,
      // When the token was minted, to the millisecond: the door refuses one older than the consent.
      customAccessTokenClaims: () => ({ [ISSUED_AT_MS_CLAIM]: Date.now() }),
      schema: {
        oauthClient: { modelName: "authOauthClient" },
        oauthResource: { modelName: "authOauthResource" },
        oauthClientResource: { modelName: "authOauthClientResource" },
        oauthRefreshToken: { modelName: "authOauthRefreshToken" },
        oauthAccessToken: { modelName: "authOauthAccessToken" },
        oauthConsent: { modelName: "authOauthConsent" },
        oauthClientAssertion: { modelName: "authOauthClientAssertion" },
      },
    }),
    cimd(cimdOptions),
  ];
}

export function createAuth(env: AuthConfig, database: Database) {
  const mcpResource = mcpResourceOf(env.BETTER_AUTH_URL);

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: tables,
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    user: {
      modelName: "authUser",
      additionalFields: {
        mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
        // When the administrator last reset the password; cleared by the user's own change.
        passwordResetAt: { type: "date", required: false, input: false },
        // Who gave the temporary password: the administrator, or the server's recovery (#79).
        passwordResetBy: { type: ["administrator", "server"], required: false, input: false },
        // The colour scheme the user chose, kept on the account: the user's menu and the settings
        // change it through the app's own server function (apps/web, functions/color-scheme.ts).
        colorScheme: {
          type: ["system", "light", "dark"],
          required: false,
          defaultValue: "system",
          input: false,
        },
        // The one user created by sign-up; a unique index allows a single one (packages/db).
        isFirstUser: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          returned: false,
        },
        // Whether the shortcuts made of one character fire: the user turns them off in the
        // settings, through the app's own server function (apps/web, functions/shortcuts.ts).
        singleKeyShortcuts: { type: "boolean", required: false, defaultValue: true, input: false },
        // The user's currency (ISO 4217): the one fixed benchmarks are written in, and a new
        // account's by default. The settings change it through the app's own server function
        // (apps/web, functions/currency.ts).
        currency: { type: "string", required: false, defaultValue: "EUR", input: false },
      },
    },
    session: {
      modelName: "authSession",
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    account: { modelName: "authAccount" },
    // `storeInDatabase` is better-auth's default (no secondary storage here): written out so that
    // the options' type matches what @better-auth/mcp's `requireMcpAuth` reads of them.
    verification: { modelName: "authVerification", storeInDatabase: false },
    // better-auth's own limit counts every request, successful or not, per address it reads from
    // `X-Forwarded-For`. Gousset counts failed attempts at a password instead, around this handler
    // (attempt-guard.ts), from the address the app resolves from the connection (client-address.ts).
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
      // HttpOnly and SameSite=Lax always; Secure whenever the app is served over HTTPS. A Secure
      // cookie would never come back over plain HTTP, so forcing it would lock such a setup out.
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!OPEN_WHILE_TEMPORARY.has(ctx.path)) {
          // The hook's session is typed loosely: the flag is read through a schema.
          const session = flaggedSessionOf(await getSessionFromCtx(ctx));

          if (Option.isSome(session) && isHeldForPasswordChange(session.value)) {
            throw new APIError("FORBIDDEN", {
              code: AuthErrorCode.passwordChangeRequired,
              message: "Change your temporary password first.",
            });
          }
        }

        if (ctx.path === "/sign-up/email") {
          // Sign-up exists only to create the first user, the administrator. Two sign-ups at once
          // may both get past this count: the unique index on the first user stops the second.
          const users = await ctx.context.adapter.count({ model: "user" });

          if (users > 0) {
            throw new APIError("FORBIDDEN", {
              code: AuthErrorCode.signUpClosed,
              message: "Sign-up is closed: ask the administrator for an account.",
            });
          }
        }

        if (ctx.path === "/oauth2/authorize") {
          const query = authorizeQueryOf(ctx.query);

          if (Option.isSome(query)) {
            const {
              client_id: clientId,
              redirect_uri: redirectUri,
              prompt = "",
              scope,
            } = query.value;

            // A metadata document may name any redirect: only its own site or the user's machine
            // is accepted, so that a look-alike name cannot send the code elsewhere.
            if (
              isMetadataDocumentClient(clientId) &&
              !redirectBoundToClient(clientId, redirectUri)
            ) {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_request",
                error_description:
                  "redirect_uri must be on the client_id's origin, or http on a loopback address",
              });
            }

            // A silent authorization redirects without showing anything: only for a signed-in user
            // who already allowed this client, never as a redirect from Gousset to anyone.
            if (prompt.split(" ").includes("none")) {
              const session = await getSessionFromCtx(ctx);

              const allowed =
                session !== null &&
                (await currentGrant(database, session.user.id, clientId)) !== undefined;

              if (!allowed) {
                throw new APIError("BAD_REQUEST", {
                  error: "interaction_required",
                  error_description: "the user must sign in and allow this client first",
                });
              }
            }

            const widened = withReadForWrite(scope);

            if (widened !== scope) {
              return { context: { query: { ...ctx.query, scope: widened } } };
            }
          }
        }

        if (ctx.path === "/change-password") {
          const passwords = passwordsOf(ctx.body);

          if (
            Option.isSome(passwords) &&
            passwords.value.newPassword === passwords.value.currentPassword
          ) {
            throw new APIError("BAD_REQUEST", {
              code: AuthErrorCode.passwordUnchanged,
              message: "The new password must differ from the current one.",
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const refusal = isAPIError(returned) ? returned : undefined;

        if (refusal !== undefined) {
          return;
        }

        if (ctx.path === "/change-password") {
          // The session as the change found it, read from the database before the new password.
          const changer = changerOf(ctx.context.session?.user);

          if (Option.isSome(changer)) {
            const { id, passwordResetAt } = changer.value;

            await clearTemporaryPassword(
              database,
              id,
              passwordResetAt === undefined || passwordResetAt === null
                ? null
                : new Date(passwordResetAt),
            );
            // A new password ends what the old one allowed, MCP clients included.
            await revokeAllClients(database, id);
          }
        }

        if (CUTTING_ADMIN_ACTIONS.has(ctx.path)) {
          const target = targetUserOf(ctx.body);

          if (Option.isSome(target)) {
            await revokeAllClients(database, target.value.userId);
          }
        }

        if (ctx.path === "/oauth2/consent") {
          const userId = (await getSessionFromCtx(ctx))?.user.id;

          // Allowing a client again, read only this time, takes write back from its tokens.
          if (userId !== undefined) {
            await alignTokensWithConsents(database, userId);
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // The administrator knows the temporary password: the user replaces it first, whatever
            // the request says (`input: false` does not hold on the admin plugin's `data`).
            if (ctx?.path === "/admin/create-user") {
              return { data: { ...user, mustChangePassword: true } };
            }

            // The user created by sign-up, on a fresh install, is the first one: the administrator.
            if (ctx?.path !== "/sign-up/email") {
              return;
            }

            return { data: { ...user, role: "admin", isFirstUser: true } };
          },
          // Every user starts with the default categories, in the language the request's browser
          // prefers (French or English): at sign-up the user's own; for a user the administrator
          // creates, the administrator's. From then on the names are the user's. Runs once the
          // user's row is committed, as `gousset_user` for that user, as `UserData` does.
          after: async (user, ctx) => {
            const header =
              ctx?.headers?.get("accept-language") ?? ctx?.request?.headers.get("accept-language");

            await Effect.runPromise(
              copyDefaultCategories(user.id, setLanguageOf(header)).pipe(
                Effect.provide(userDataLayer(database)),
              ),
            );
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"], ...adminAccess }),
      ...(mcpResource === undefined ? [] : mcpPlugins(mcpResource)),
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export type Session = Auth["$Infer"]["Session"];

/**
 * Whether a session is held until its user changes a temporary password: it then opens nothing but
 * that change, on the server as on the pages (#70). No session at all is not held: each caller
 * refuses it in its own words.
 */
export function isHeldForPasswordChange(
  session: { user: { mustChangePassword?: boolean | null } } | null,
): boolean {
  return session?.user.mustChangePassword === true;
}
