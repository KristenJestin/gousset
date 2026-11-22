import { authAccount, authRelations, authSession, authUser, authVerification } from "./auth";

/** Every table, named once for Drizzle's relations and better-auth's adapter. */
export const tables = { authAccount, authSession, authUser, authVerification };

export { authRelations };
