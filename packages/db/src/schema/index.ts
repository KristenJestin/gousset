import { account, authRelations, session, user, verification } from "./auth";

/** Every table, named once for Drizzle's relations and better-auth's adapter. */
export const tables = { account, session, user, verification };

export { authRelations };
