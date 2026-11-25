import type { UserTransaction } from "@gousset/db/user-data";
import { sql } from "drizzle-orm";

// One user's changes of the categories, and whatever reads the merchants' default categories to
// classify entries (#23), take turns: a default set or changed waits for an import's recognition
// to end, and the other way round, so that neither writes entries into a default the other has
// just replaced.

/** The first key of the lock a user's turn takes, the user's the second. */
const CHANGE_LOCK = "gousset.category.change";

/**
 * Takes the user's turn among the changes of the categories and the classifications by merchant,
 * until the transaction ends. Taken again in the same transaction, it is already held. Take it
 * before any row lock of the transaction, as every taker does, so that none waits for the other.
 */
export const takeCategoryTurn = (transaction: UserTransaction, owner: string) =>
  transaction.execute(
    sql`select pg_advisory_xact_lock(hashtext(${CHANGE_LOCK}), hashtext(${owner}))`,
  );
