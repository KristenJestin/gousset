import type { UserTransaction } from "@gousset/db/user-data";
import { sql } from "drizzle-orm";

/** The first key of the lock a user's changes of the subjects take, the user's the second. */
const CHANGE_LOCK = "gousset.subject.change";

/**
 * Takes the user's turn among the changes of the subjects until the transaction ends, so that two
 * moves never make a cycle together, nor two creations pass the limit or share a name, nor a payback
 * line comes to a subject whose option is being turned off (#217).
 */
export const takeSubjectTurn = (transaction: UserTransaction, owner: string) =>
  transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${CHANGE_LOCK}), hashtext(${owner}))`,
  );
