import { createAuth } from "@gousset/auth";
import { DatabaseAccountStore, FixtureLedger, Today } from "@gousset/core";
import type { AccountStore, Ledger } from "@gousset/core";
import { createDb } from "@gousset/db";
import { userDataLayer } from "@gousset/db/user-data";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { ENV } from "./env.server";
import { E2E_DAY_COOKIE, today } from "./lib/today";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

/** What Gousset's logic needs: the made-up month (v0.1) and the user's accounts in the database. */
export type CoreServices = Ledger | AccountStore;

/**
 * Gousset's logic (`@gousset/core`) runs on one runtime for the whole process, so that the server
 * functions and the MCP door read and change the same ledger and the same accounts.
 */
const core = ManagedRuntime.make(
  Layer.mergeAll(FixtureLedger, Layer.provide(DatabaseAccountStore, userDataLayer(db))),
);

/**
 * Runs core logic for the current request. Core reads today from the server's own `today`, which
 * the end-to-end harness can fix: one source for every page and tool.
 */
export function runCore<A, E>(effect: Effect.Effect<A, E, CoreServices>): Promise<A> {
  const day = today(getCookie(E2E_DAY_COOKIE)).pipe(Effect.orDie);

  return core.runPromise(Effect.provideService(effect, Today, { day }));
}
