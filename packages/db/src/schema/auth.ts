import { defineRelationsPart } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
  // When the administrator last gave the user a temporary password (#70), shown to the user on the
  // forced change; cleared once they choose their own.
  passwordResetAt: timestamp("password_reset_at"),
  // The user created by sign-up on a fresh install. Two sign-ups at once could both see no user
  // yet: a unique index lets only one of them be written. That index is not declared here, since
  // `pnpm auth:generate` rewrites this file, but in a custom migration of its own
  // (migrations/*_first_user_index), which regenerating the schema never drops.
  isFirstUser: boolean("is_first_user").default(false).notNull(),
  // The shortcuts made of one character, `?` among them: on by default, turned off in the settings
  // (WCAG 2.2, 2.1.4 Character Key Shortcuts).
  singleKeyShortcuts: boolean("single_key_shortcuts").default(true).notNull(),
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

// The MCP door's authorization server (packages/auth, docs/mcp.md): the JWT plugin's signing keys,
// then @better-auth/mcp's OAuth provider: clients, the `/mcp` resource, tokens and consents.

export const authJwks = pgTable("auth_jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

export const authOauthClient = pgTable(
  "auth_oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
    userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("auth_oauth_client_userId_idx").on(table.userId)],
);

export const authOauthResource = pgTable("auth_oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const authOauthClientResource = pgTable(
  "auth_oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => authOauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("auth_oauth_client_resource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId,
    ),
    index("auth_oauth_client_resource_clientId_idx").on(table.clientId),
    index("auth_oauth_client_resource_resourceId_idx").on(table.resourceId),
  ],
);

export const authOauthRefreshToken = pgTable(
  "auth_oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSession.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at"),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    authTime: timestamp("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("auth_oauth_refresh_token_clientId_idx").on(table.clientId),
    index("auth_oauth_refresh_token_sessionId_idx").on(table.sessionId),
    index("auth_oauth_refresh_token_userId_idx").on(table.userId),
    index("auth_oauth_refresh_token_authorizationCodeId_idx").on(table.authorizationCodeId),
  ],
);

export const authOauthAccessToken = pgTable(
  "auth_oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSession.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => authOauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at"),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("auth_oauth_access_token_clientId_idx").on(table.clientId),
    index("auth_oauth_access_token_sessionId_idx").on(table.sessionId),
    index("auth_oauth_access_token_userId_idx").on(table.userId),
    index("auth_oauth_access_token_authorizationCodeId_idx").on(table.authorizationCodeId),
    index("auth_oauth_access_token_refreshId_idx").on(table.refreshId),
  ],
);

export const authOauthConsent = pgTable(
  "auth_oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("auth_oauth_consent_clientId_idx").on(table.clientId),
    index("auth_oauth_consent_userId_idx").on(table.userId),
  ],
);

export const authOauthClientAssertion = pgTable("auth_oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const authRelations = defineRelationsPart(
  {
    authUser,
    authSession,
    authAccount,
    authVerification,
    authOauthClient,
    authOauthResource,
    authOauthClientResource,
    authOauthRefreshToken,
    authOauthAccessToken,
    authOauthConsent,
  },
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
    authOauthClient: {
      user: r.one.authUser({ from: r.authOauthClient.userId, to: r.authUser.id }),
      resources: r.many.authOauthClientResource({
        from: r.authOauthClient.clientId,
        to: r.authOauthClientResource.clientId,
      }),
      consents: r.many.authOauthConsent({
        from: r.authOauthClient.clientId,
        to: r.authOauthConsent.clientId,
      }),
    },
    authOauthClientResource: {
      client: r.one.authOauthClient({
        from: r.authOauthClientResource.clientId,
        to: r.authOauthClient.clientId,
      }),
      resource: r.one.authOauthResource({
        from: r.authOauthClientResource.resourceId,
        to: r.authOauthResource.identifier,
      }),
    },
    authOauthRefreshToken: {
      client: r.one.authOauthClient({
        from: r.authOauthRefreshToken.clientId,
        to: r.authOauthClient.clientId,
      }),
      user: r.one.authUser({ from: r.authOauthRefreshToken.userId, to: r.authUser.id }),
    },
    authOauthAccessToken: {
      client: r.one.authOauthClient({
        from: r.authOauthAccessToken.clientId,
        to: r.authOauthClient.clientId,
      }),
      user: r.one.authUser({ from: r.authOauthAccessToken.userId, to: r.authUser.id }),
    },
    authOauthConsent: {
      client: r.one.authOauthClient({
        from: r.authOauthConsent.clientId,
        to: r.authOauthClient.clientId,
      }),
      user: r.one.authUser({ from: r.authOauthConsent.userId, to: r.authUser.id }),
    },
  }),
);
