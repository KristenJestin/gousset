import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { mcp } from "@better-auth/mcp";
import type { Database } from "@gousset/db";
import { tables } from "@gousset/db/schema/index";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { admin, jwt } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Option, Schema } from "effect";

import { TOO_MANY_ATTEMPTS } from "./attempt-guard";
import { cimdOptions } from "./cimd";
import { CLIENT_ADDRESS_HEADER } from "./client-address";
import { CONSENT_PATH, McpScope, SIGN_IN_PATH, mcpResourceOf } from "./mcp";

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
} as const;

const SESSION_DAYS = 30;

const passwordsOf = Schema.decodeUnknownOption(
  Schema.Struct({ currentPassword: Schema.String, newPassword: Schema.String }),
);

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
        // The one user created by sign-up; a unique index allows a single one (packages/db).
        isFirstUser: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          returned: false,
        },
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

        if (ctx.path === "/change-password" && refusal === undefined) {
          const userId = ctx.context.session?.user.id;

          if (userId !== undefined) {
            await ctx.context.internalAdapter.updateUser(userId, { mustChangePassword: false });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // The user created by sign-up, on a fresh install, is the first one: the administrator.
            if (ctx?.path !== "/sign-up/email") {
              return;
            }

            return { data: { ...user, role: "admin", isFirstUser: true } };
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      ...(mcpResource === undefined ? [] : mcpPlugins(mcpResource)),
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export type Session = Auth["$Infer"]["Session"];
