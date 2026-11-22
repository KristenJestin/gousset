import { defineRelationsPart } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

// better-auth's tables carry an `auth_` prefix: its `account` would collide with bank accounts.
// The keys of `tables` (authUser…) are the model names better-auth is given (packages/auth).

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  // better-auth's admin plugin: "admin" for the first user, "user" for the others.
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  // Set when the administrator creates the user with a temporary password.
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  // The user created by sign-up on a fresh install. Two sign-ups at once could both see no user
  // yet: a unique index lets only one of them be written. That index is not declared here, since
  // `pnpm auth:generate` rewrites this file, but in a custom migration of its own
  // (migrations/*_first_user_index), which regenerating the schema never drops.
  isFirstUser: boolean("is_first_user").default(false).notNull(),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("auth_session_userId_idx").on(table.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("auth_account_userId_idx").on(table.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const authRelations = defineRelationsPart(
  { authUser, authSession, authAccount, authVerification },
  (r) => ({
    authUser: {
      sessions: r.many.authSession({
        from: r.authUser.id,
        to: r.authSession.userId,
      }),
      accounts: r.many.authAccount({
        from: r.authUser.id,
        to: r.authAccount.userId,
      }),
    },
    authSession: {
      user: r.one.authUser({
        from: r.authSession.userId,
        to: r.authUser.id,
      }),
    },
    authAccount: {
      user: r.one.authUser({
        from: r.authAccount.userId,
        to: r.authUser.id,
      }),
    },
  }),
);
