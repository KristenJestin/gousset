import {
  authAccount,
  authJwks,
  authOauthAccessToken,
  authOauthClient,
  authOauthClientAssertion,
  authOauthClientResource,
  authOauthConsent,
  authOauthRefreshToken,
  authOauthResource,
  authRelations,
  authSession,
  authUser,
  authVerification,
} from "./auth";
import {
  account,
  accountBalance,
  importFile,
  importProfile,
  statementImport,
  statementLine,
} from "./ledger";
import { installationSettings } from "./settings";

/** Every table, named once for Drizzle's relations and better-auth's adapter. */
export const tables = {
  authAccount,
  authSession,
  authUser,
  authVerification,
  authJwks,
  authOauthClient,
  authOauthResource,
  authOauthClientResource,
  authOauthRefreshToken,
  authOauthAccessToken,
  authOauthConsent,
  authOauthClientAssertion,
  installationSettings,
  account,
  accountBalance,
  statementLine,
  statementImport,
  importFile,
  importProfile,
};

export { authRelations };
