import { createAuth } from "@gousset/auth";
import { FixtureLedger, Today } from "@gousset/core";
import type { Ledger } from "@gousset/core";
import { createDb } from "@gousset/db";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, ManagedRuntime } from "effect";

import { ENV } from "./env.server";
import { E2E_DAY_COOKIE, today } from "./lib/today";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

/**
 * Gousset's logic (`@gousset/core`) runs on one runtime for the whole process, so that the server
 * functions and the MCP door read and change the same ledger.
 */
const core = ManagedRuntime.make(FixtureLedger);

/**
 * Runs core logic for the current request. Core reads today from the server's own `today`, which
 * the end-to-end harness can fix: one source for every page and tool.
 */
export function runCore<A, E>(effect: Effect.Effect<A, E, Ledger>): Promise<A> {
  const day = today(getCookie(E2E_DAY_COOKIE)).pipe(Effect.orDie);

  return core.runPromise(Effect.provideService(effect, Today, { day }));
}
