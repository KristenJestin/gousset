import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

// The OAuth provider's plugin carries the authorization request (`oauth_query`) of the page's
// address through sign-in and consent, so that an MCP client's authorization resumes after them.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
