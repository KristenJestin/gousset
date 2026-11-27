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
  category,
  entry,
  entryPart,
  importFile,
  importProfile,
  importUpload,
  merchant,
  merchantAlias,
  statementImport,
  statementLine,
} from "./ledger";
import { investmentOperation, security } from "./investments";
import { installationSettings } from "./settings";
import { transfer } from "./transfers";

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
  importUpload,
  category,
  entry,
  entryPart,
  transfer,
  merchant,
  merchantAlias,
  security,
  investmentOperation,
};

export { authRelations };
