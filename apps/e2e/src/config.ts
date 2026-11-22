import { Schema } from "effect";

/**
 * What the harness reads from its environment. Everything has a default for a local run against
 * `pnpm db:start`; CI sets its own.
 */
const HarnessEnvironment = Schema.Struct({
  /**
   * A Postgres 18 server the harness may create and drop databases on, through any database of
   * it. Every database it makes is named `gousset_e2e_*`.
   */
  E2E_DATABASE_URL: Schema.optional(Schema.NonEmptyString),
  /** Taken when `E2E_DATABASE_URL` is not set, as the CI job sets it for its Postgres service. */
  DATABASE_URL: Schema.optional(Schema.NonEmptyString),
  /**
   * The app image to test instead of the built server: each worker runs it with
   * `docker run --network host`, against its own database.
   */
  E2E_APP_IMAGE: Schema.optional(Schema.NonEmptyString),
  CI: Schema.optional(Schema.String),
});

const environment = Schema.decodeUnknownSync(HarnessEnvironment)({
  E2E_DATABASE_URL: process.env.E2E_DATABASE_URL || undefined,
  DATABASE_URL: process.env.DATABASE_URL || undefined,
  E2E_APP_IMAGE: process.env.E2E_APP_IMAGE || undefined,
  CI: process.env.CI,
});

/** The password of `docker-compose.yml`'s Postgres, the one `pnpm db:start` runs. */
const LOCAL_DATABASE_URL = "postgresql://postgres:password@localhost:5432/postgres";

export const harness = {
  databaseUrl: environment.E2E_DATABASE_URL ?? environment.DATABASE_URL ?? LOCAL_DATABASE_URL,
  appImage: environment.E2E_APP_IMAGE,
  inCi: environment.CI !== undefined && environment.CI !== "" && environment.CI !== "false",
};
