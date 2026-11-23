import { createAuth } from "@gousset/auth";
import {
  DatabaseAccountStore,
  FixtureLedger,
  Today,
  importProfilesLayer,
  importsLayer,
} from "@gousset/core";
import type { AccountStore, ImportProfiles, Imports, Ledger } from "@gousset/core";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { db, userData } from "./database.server";
import { ENV } from "./env.server";
import { importJobs } from "./jobs/import-jobs.server";
import { E2E_DAY_COOKIE, today } from "./lib/today";

export { db } from "./database.server";

export const auth = createAuth(ENV, db);

/**
 * What Gousset's logic needs: the made-up month (v0.1), the user's accounts in the database, the
 * imports (#20) and their profiles (#19).
 */
export type CoreServices = Ledger | AccountStore | Imports | ImportProfiles;

/**
 * Gousset's logic (`@gousset/core`) runs on one runtime for the whole process, so that the server
 * functions and the MCP door read and change the same ledger and the same accounts, and import
 * through the same queue.
 */
const core = ManagedRuntime.make(
  Layer.mergeAll(
    FixtureLedger,
    Layer.provide(DatabaseAccountStore, userData),
    importsLayer.pipe(Layer.provide(Layer.mergeAll(userData, importJobs))),
    importProfilesLayer.pipe(Layer.provide(userData)),
  ),
);

/**
 * Runs core logic for the current request. Core reads today from the server's own `today`, which
 * the end-to-end harness can fix: one source for every page and tool.
 */
export function runCore<A, E>(effect: Effect.Effect<A, E, CoreServices>): Promise<A> {
  const day = today(getCookie(E2E_DAY_COOKIE)).pipe(Effect.orDie);

  return core.runPromise(Effect.provideService(effect, Today, { day }));
}
