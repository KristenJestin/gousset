-- At most one user created by sign-up: two sign-ups at once on a fresh install could both see no
-- user yet, and only one of them may be written. Kept out of the Drizzle schema on purpose:
-- packages/db/src/schema/auth.ts is rewritten by `pnpm auth:generate`, which knows nothing of it.
CREATE UNIQUE INDEX "auth_user_one_first_user" ON "auth_user" ("is_first_user") WHERE "is_first_user";
