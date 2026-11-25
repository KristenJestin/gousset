import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";

import type { Database } from "./index";
import { authUser } from "./schema/auth";

/**
 * The role a user's transaction acts as, which row-level security restricts, and the setting its
 * policies read (`packages/db/src/schema/ledger.ts`; the role is made by a migration).
 */
export const USER_ROLE = "gousset_user";
export const USER_SETTING = "gousset.user_id";

/** A transaction opened for one user: every query in it reads and writes that user's rows only. */
export type UserTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A query of a user's transaction failed. Only Postgres's code (SQLSTATE) is kept, never its
 * message, which may quote a row: `42501` for a row of another user's, `23503` for a reference
 * to one, `UNKNOWN` when the failure carries no code.
 */
export class QueryFailed extends Schema.TaggedError<QueryFailed>()("QueryFailed", {
  code: Schema.String,
}) {}

// Drizzle wraps the driver's error, keeping it as the cause.
const SqlState = Schema.Struct({ code: Schema.String });
const sqlState = Schema.decodeUnknownOption(SqlState);
const wrappedSqlState = Schema.decodeUnknownOption(Schema.Struct({ cause: SqlState }));

/**
 * The one door to a user's tables (docs/data-model.md, "Ownership and isolation"). Every server
 * function, MCP tool and job that works for a user goes through it; a query on those tables
 * elsewhere runs as the app's own role, `gousset_app`, which has no grant on them, and fails.
 */
export class UserData extends Context.Service<
  UserData,
  {
    /**
     * Runs `work` in one transaction that acts as `gousset_user` for `owner`: it sees, changes and
     * deletes that user's rows only, and writes a row in no other user's name. Both settings end
     * with the transaction, so a pooled connection never carries a user into the next one. An
     * empty owner sees no row at all.
     */
    readonly transaction: <A>(
      owner: string,
      work: (transaction: UserTransaction) => Promise<A>,
    ) => Effect.Effect<A, QueryFailed>;
    /**
     * The same, read only, and seeing one snapshot of the data throughout (`repeatable read`):
     * what several queries read together (an export) stays consistent while an import writes.
     */
    readonly snapshot: <A>(
      owner: string,
      work: (transaction: UserTransaction) => Promise<A>,
    ) => Effect.Effect<A, QueryFailed>;
    /**
     * The same, once per user: it marks the user's default categories as named
     * (`auth_user.default_categories_settled`, as the app's role) before acting as the user, and
     * runs `work` only when the mark was not set yet; none otherwise. Two at once: the second waits
     * for the first's row, then finds it marked and runs nothing.
     */
    readonly settlingDefaultNames: <A>(
      owner: string,
      work: (transaction: UserTransaction) => Promise<A>,
    ) => Effect.Effect<Option.Option<A>, QueryFailed>;
  }
>()("@gousset/db/UserData") {}

type TransactionConfig = Parameters<Database["transaction"]>[1];

const SNAPSHOT: TransactionConfig = { isolationLevel: "repeatable read", accessMode: "read only" };

/** From here on, the transaction acts as `gousset_user` for `owner`. */
async function actAs(transaction: UserTransaction, owner: string): Promise<void> {
  await transaction.execute(sql`set local role ${sql.identifier(USER_ROLE)}`);
  await transaction.execute(sql`select set_config(${USER_SETTING}, ${owner}, true)`);
}

/** A transaction's failure, as Postgres's code alone. */
function attempt<A>(work: () => Promise<A>): Effect.Effect<A, QueryFailed> {
  return Effect.tryPromise({
    try: work,
    catch: (error) =>
      new QueryFailed({
        code: sqlState(error).pipe(
          Option.orElse(() => Option.map(wrappedSqlState(error), (wrapped) => wrapped.cause)),
          Option.match({ onNone: () => "UNKNOWN", onSome: (state) => state.code }),
        ),
      }),
  });
}

/** `UserData` on the app's database. */
export function userDataLayer(db: Database): Layer.Layer<UserData> {
  const run = <A>(
    owner: string,
    work: (transaction: UserTransaction) => Promise<A>,
    config?: TransactionConfig,
  ) =>
    attempt(() =>
      db.transaction(async (transaction) => {
        await actAs(transaction, owner);

        return work(transaction);
      }, config),
    );

  return Layer.succeed(UserData, {
    transaction: (owner, work) => run(owner, work),
    snapshot: (owner, work) => run(owner, work, SNAPSHOT),
    settlingDefaultNames: (owner, work) =>
      attempt(() =>
        db.transaction(async (transaction) => {
          const marked = await transaction
            .update(authUser)
            .set({ defaultCategoriesSettled: true })
            .where(and(eq(authUser.id, owner), eq(authUser.defaultCategoriesSettled, false)))
            .returning({ id: authUser.id });

          if (marked.length === 0) {
            return Option.none();
          }

          await actAs(transaction, owner);

          return Option.some(await work(transaction));
        }),
      ),
  });
}
