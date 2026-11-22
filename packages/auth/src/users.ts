import type { Database } from "@gousset/db";
import { authUser } from "@gousset/db/schema/auth";
import { asc } from "drizzle-orm";

/** Every user of the installation, oldest first, with what the administrator needs to see. */
export async function listUsers(database: Database) {
  const users = await database
    .select({
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      mustChangePassword: authUser.mustChangePassword,
    })
    .from(authUser)
    .orderBy(asc(authUser.createdAt));

  return users.map(({ role, ...user }) => ({ ...user, isAdmin: role === "admin" }));
}
