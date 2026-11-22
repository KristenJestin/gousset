import { createAuth } from "@gousset/auth";
import { FixtureLedger } from "@gousset/core";
import { createDb } from "@gousset/db";
import { ManagedRuntime } from "effect";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

/** The services Gousset's logic runs with, built once: the MCP tools read the same store. */
export const runtime = ManagedRuntime.make(FixtureLedger);
