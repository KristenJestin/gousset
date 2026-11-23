import { createAuth } from "@gousset/auth";
import {
  DatabaseAccountStore,
  DatabaseCategoryStore,
  DatabaseLineStore,
  FixtureLedger,
  Today,
  dataExportLayer,
  expensesLayer,
  importProfilesLayer,
  importsLayer,
  merchantsLayer,
  transfersLayer,
} from "@gousset/core";
import type {
  AccountStore,
  CategoryStore,
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Ledger,
  LineStore,
  Merchants,
  Transfers,
} from "@gousset/core";
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
 * imports (#20) and their profiles (#19), the export (#22), every line searched across accounts
 * (#21), the transfers between accounts (#26), the merchants (#24), the categories (#23), and the
 * expenses made of several lines (#27).
 */
export type CoreServices =
  | Ledger
  | AccountStore
  | Imports
  | ImportProfiles
  | DataExport
  | LineStore
  | Transfers
  | Merchants
  | CategoryStore
  | Expenses;

/**
 * Gousset's logic (`@gousset/core`) runs on one runtime for the whole process, so that the server
 * functions and the MCP door read and change the same ledger and the same accounts, and import
 * through the same queue.
 */
const core = ManagedRuntime.make(
  Layer.mergeAll(
    FixtureLedger,
    Layer.provide(DatabaseAccountStore, userData),
    Layer.provide(DatabaseLineStore, userData),
    Layer.provide(DatabaseCategoryStore, userData),
    importsLayer.pipe(Layer.provide(Layer.mergeAll(userData, importJobs))),
    importProfilesLayer.pipe(Layer.provide(userData)),
    dataExportLayer.pipe(Layer.provide(userData)),
    transfersLayer.pipe(Layer.provide(userData)),
    merchantsLayer.pipe(Layer.provide(userData)),
    expensesLayer.pipe(Layer.provide(userData)),
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
