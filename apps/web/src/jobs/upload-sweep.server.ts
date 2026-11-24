import { sweepUploads } from "@gousset/core";
import { authUser } from "@gousset/db/schema/auth";
import { Effect, Schema } from "effect";

import { db, userData } from "../database.server";
import { JobFailed, defineJob } from "./define";

const failed = () => new JobFailed({ code: "QUERY_FAILED", retry: false });

/**
 * Deletes the file uploads (#129) past their expiry, with the bytes they received, every ten
 * minutes: those used are deleted by their import, those of a grant revoked with it, and an
 * unused one lasts no longer than its expiry and one sweep. The app's role reaches no user's
 * table, so each user's are deleted in a transaction of theirs (`UserData`), one after the other;
 * the next sweep makes up for one that failed.
 */
export const uploadSweepJob = defineJob({
  name: "sweep-file-uploads",
  input: Schema.Struct({}),
  steps: ["sweep"],
  retries: { limit: 0, delaySeconds: 0, backoff: false },
  timeoutSeconds: 300,
  schedule: "*/10 * * * *",
  run: () =>
    Effect.gen(function* () {
      const users = yield* Effect.tryPromise({
        try: () => db.select({ id: authUser.id }).from(authUser),
        catch: failed,
      });

      yield* Effect.forEach(
        users,
        (user) => sweepUploads(user.id).pipe(Effect.provide(userData), Effect.mapError(failed)),
        { discard: true },
      );

      return { months: [] };
    }),
});
