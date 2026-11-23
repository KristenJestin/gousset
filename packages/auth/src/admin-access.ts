import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

/**
 * What the admin plugin allows each role, in place of its defaults. The administrator manages
 * users and never reaches another user's data: their default role could impersonate a user, set
 * a user's password (and so sign in as them), list a user's sessions, change a user's e-mail or
 * remove a user. Only two permissions remain:
 *
 * - `user:create`: the administrator creates the other users (#5);
 * - `user:ban`: a ban shuts a user out, MCP clients included (docs/mcp.md), and gives no access.
 *
 * Every other admin route answers 403, to the administrator as to anyone.
 */
const accessControl = createAccessControl(defaultStatements);

const administrator = accessControl.newRole({ user: ["create", "ban"], session: [] });

const member = accessControl.newRole({ user: [], session: [] });

export const adminAccess = {
  ac: accessControl,
  roles: { admin: administrator, user: member },
};
