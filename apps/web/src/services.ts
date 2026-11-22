import { createAuth } from "@gousset/auth";
import { createDb } from "@gousset/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
