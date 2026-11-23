import { createAuth } from "@gousset/auth";
import { FixtureLedger, Today, dataExportLayer, importsLayer } from "@gousset/core";
import type { DataExport, Imports, Ledger } from "@gousset/core";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, Layer, ManagedRuntime } from "effect";

import { db, userData } from "./database.server";
import { ENV } from "./env.server";
import { importJobs } from "./jobs/import-jobs.server";
import { E2E_DAY_COOKIE, today } from "./lib/today";

export { db } from "./database.server";

export const auth = createAuth(ENV, db);

/**
 * Gousset's logic (`@gousset/core`) runs on one runtime for the whole process, so that the server
 * functions and the MCP door read and change the same ledger, and import through the same queue.
 */
const core = ManagedRuntime.make(
  Layer.mergeAll(
    FixtureLedger,
    importsLayer.pipe(Layer.provide(Layer.mergeAll(userData, importJobs))),
    dataExportLayer.pipe(Layer.provide(userData)),
  ),
);

/** What core logic may need: the made-up ledger (v0.1), the imports (#20) and the export (#22). */
export type CoreServices = Ledger | Imports | DataExport;

/**
 * Runs core logic for the current request. Core reads today from the server's own `today`, which
 * the end-to-end harness can fix: one source for every page and tool.
 */
export function runCore<A, E>(effect: Effect.Effect<A, E, CoreServices>): Promise<A> {
  const day = today(getCookie(E2E_DAY_COOKIE)).pipe(Effect.orDie);

  return core.runPromise(Effect.provideService(effect, Today, { day }));
}
