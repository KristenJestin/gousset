/** What the authorization server adds to sign a query it sends to the sign-in page. */
const SIGNING_PARAMETERS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];

/**
 * The MCP client's authorization the sign-in page was opened for, as a query to give
 * `/api/auth/oauth2/authorize` again once the user can go on (after changing a temporary
 * password): the client's own parameters, without the server's signature of them, which a fresh
 * request to authorize does not carry. `undefined` when the page was opened for no client.
 */
export function authorizationToResume(search: string): string | undefined {
  const query = new URLSearchParams(search);

  if (query.get("client_id") === null) {
    return undefined;
  }

  for (const name of SIGNING_PARAMETERS) {
    query.delete(name);
  }

  return query.toString();
}

/** Where the browser goes to resume that authorization. */
export const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
