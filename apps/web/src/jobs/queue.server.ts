import { annotate, withSpan } from "@gousset/telemetry";
import { Context, Effect, Layer, Option, PubSub, Schedule, Schema } from "effect";
import { PgBoss } from "pg-boss";
import type { JobResult, JobWithMetadata } from "pg-boss";

import { telemetry } from "../telemetry.server";
import { HEARTBEAT_SECONDS, JobFailed, JobProgress, sendOptions } from "./define";
import type { JobDefinition } from "./define";
import {
  FAILURES,
  JobOutput,
  attemptEnded,
  attemptStarted,
  stepReported,
  viewOfRecord,
} from "./view";
import type { AttemptOutcome, JobView } from "./view";

/** The database did not answer pg-boss: the job could not be sent or read. Retry later. */
export class JobQueueUnavailable extends Schema.TaggedError<JobQueueUnavailable>()(
  "JobQueueUnavailable",
  {},
) {}

/** The schema pg-boss keeps its tables in, apart from Gousset's own. */
const BOSS_SCHEMA = "pgboss";

/**
 * How long a stop waits for the attempts under way before pg-boss fails them, to be retried by the
 * next start: within the 10 seconds `docker stop` gives the app.
 */
const STOP_GRACE_MS = 5000;

/**
 * How long the view of an attempt that ended stays in memory: long past the moment pg-boss writes
 * the end on its row, so that a page never reads the row as it was before.
 */
const ENDED_KEPT_MS = 60_000;

/** How many changes a stream that stops reading may hold before the oldest go. */
const CHANGES_KEPT = 256;

/** pg-boss's job ids. */
const isJobId = (id: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);

/** How many jobs the development panel lists. */
const LISTED_JOBS = 20;

/** What every job carries in pg-boss: whose it is, and its input as its definition encodes it. */
const Owned = Schema.Struct({ owner: Schema.String });

const ownerOf = Schema.decodeUnknownOption(Owned);
const outputOf = Schema.decodeUnknownOption(JobOutput);

/** A job's row as pg-boss reads it, with what Gousset decodes of it. */
type Found = { readonly owner: string; readonly view: JobView; readonly createdOn: Date };

function found(row: JobWithMetadata<object>): Found | null {
  const owned = ownerOf(row.data);

  if (Option.isNone(owned)) {
    return null;
  }

  return {
    owner: owned.value.owner,
    createdOn: row.createdOn,
    view: viewOfRecord({
      id: row.id,
      name: row.name,
      state: row.state,
      retryCount: row.retryCount,
      retryLimit: row.retryLimit,
      output: Option.getOrNull(outputOf(row.output)),
    }),
  };
}

/** A job's data in pg-boss: whose it is, and its input as its definition encodes it. */
const envelopeOf = <Input, Encoded>(definition: JobDefinition<Input, Encoded>) =>
  Schema.Struct({ owner: Schema.String, input: definition.input });

/** An input that does not decode: no attempt will do better. */
const invalidInput = () => new JobFailed({ code: "INVALID_INPUT", retry: false });

/** A job as pg-boss hands it to a worker: its data is decoded by its definition. */
type ClaimedRow = JobWithMetadata<object>;

/**
 * A definition, made ready for the queue: its name, its options, and one attempt of a job it
 * claimed, its input decoded on the way. Definitions of every input type sit in one list as this.
 */
export type RegisteredJob = {
  readonly name: string;
  readonly options: ReturnType<typeof sendOptions>;
  readonly attempt: (claimed: ClaimedRow) => Effect.Effect<AttemptOutcome, never, JobProgress>;
};

/** A definition, ready for the queue (`JobQueue.layer`). */
export function register<Input, Encoded>(definition: JobDefinition<Input, Encoded>): RegisteredJob {
  const envelope = envelopeOf(definition);

  return {
    name: definition.name,
    options: sendOptions(definition),
    attempt: (claimed) =>
      Schema.decodeUnknownEffect(envelope)(claimed.data).pipe(
        Effect.mapError(invalidInput),
        Effect.flatMap(({ owner, input }) =>
          definition.run(input, owner, { last: claimed.retryCount >= claimed.retryLimit }),
        ),
        Effect.map((touched): AttemptOutcome => ({ touched })),
        Effect.catchTag("JobFailed", (failed) =>
          Effect.succeed({ failure: failed.code, retry: failed.retry }),
        ),
        Effect.catchDefect(() => Effect.succeed({ failure: FAILURES.unexpected, retry: true })),
      ),
  };
}

/** What pg-boss keeps of an attempt's end: the output Gousset decodes, never a message. */
function resultOf(id: string, outcome: AttemptOutcome): JobResult {
  if ("touched" in outcome) {
    return { id, status: "completed", output: { touched: outcome.touched } };
  }

  // A failure not worth another attempt fails the job at once (no dead letter queue is set).
  return {
    id,
    status: outcome.retry ? "failed" : "deadletter",
    output: { failure: outcome.failure },
  };
}

/** How an attempt ended, for its span: from a closed set. */
function outcomeName(view: JobView, interrupted: boolean): string {
  return interrupted ? "interrupted" : view.phase;
}

/**
 * The job queue: pg-boss, in the app's process, on the app's database (docs/architecture.md,
 * "Background jobs"). Sending a job, reading where one stands, and the views of the attempts this
 * process runs, pushed as they change to the pages that follow them.
 */
export class JobQueue extends Context.Service<
  JobQueue,
  {
    /** Sends a job for `owner`; its id, which the page follows. */
    readonly send: <Input, Encoded>(
      definition: JobDefinition<Input, Encoded>,
      owner: string,
      input: Input,
    ) => Effect.Effect<string, JobQueueUnavailable | JobFailed>;
    /** Where a job stands, or `null` when `owner` has no job with this id. */
    readonly view: (
      id: string,
      owner: string,
    ) => Effect.Effect<JobView | null, JobQueueUnavailable>;
    /** The last jobs of `owner`, newest first (the development panel). */
    readonly list: (owner: string) => Effect.Effect<ReadonlyArray<JobView>, JobQueueUnavailable>;
    /** Every change of an attempt this process runs, whoever's job it is. */
    readonly changes: PubSub.PubSub<JobView>;
  }
>()("@gousset/web/JobQueue") {
  /**
   * The queue for `definitions`, started when the layer is built (pg-boss installs or migrates its
   * schema, then each job's worker starts), stopped when it is released.
   */
  static readonly layer = (connectionString: string, jobs: ReadonlyArray<RegisteredJob>) =>
    Layer.effect(
      JobQueue,
      Effect.gen(function* () {
        const registered = new Map(jobs.map((job) => [job.name, job]));
        // Each stream reads every change and keeps its job's: one that stops reading loses the
        // oldest, which its next read of the row makes up for, rather than holding them all.
        const changes = yield* PubSub.sliding<JobView>(CHANGES_KEPT);

        // The views of the attempts this process runs, and of those that ended moments ago.
        const live = new Map<string, { owner: string; view: JobView; endedAt: number | null }>();

        // A database that does not answer at boot (a compose start where it comes up late) is
        // waited for: a failed start would otherwise stay failed in the runtime until a restart.
        const startBoss = Effect.tryPromise({
          try: async () => {
            const created = new PgBoss({
              connectionString,
              schema: BOSS_SCHEMA,
              application_name: "gousset-jobs",
              // A worker gone silent (a crash) is found within two passes: its attempt is retried.
              superviseIntervalSeconds: HEARTBEAT_SECONDS,
              monitorIntervalSeconds: HEARTBEAT_SECONDS,
              // Gousset opens its own spans; pg-boss's would go to OpenTelemetry's global
              // provider, which nothing registers.
              openTelemetry: { enabled: false },
            });

            // An `error` event nobody listens to would end the process.
            created.on("error", (error) => {
              telemetry.runFork(Effect.logError("The job queue reported an error", error));
            });

            try {
              return await created.start();
            } catch (error) {
              // Its pool closed before the next try opens another.
              await created.stop({ graceful: false }).catch(() => undefined);
              throw error;
            }
          },
          catch: () => new JobQueueUnavailable(),
        });

        const boss = yield* Effect.acquireRelease(
          startBoss.pipe(
            Effect.tapError(() =>
              Effect.sync(() =>
                telemetry.runFork(
                  Effect.logWarning("The job queue cannot reach the database yet: it tries again."),
                ),
              ),
            ),
            Effect.retry(
              Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("30 seconds")]),
            ),
          ),
          (started) =>
            Effect.promise(async () => started.stop({ graceful: true, timeout: STOP_GRACE_MS })),
        );

        const forget = (now: number) => {
          for (const [id, entry] of live) {
            if (entry.endedAt !== null && now - entry.endedAt > ENDED_KEPT_MS) {
              live.delete(id);
            }
          }
        };

        const show = (id: string, owner: string, view: JobView, ended: boolean) =>
          Effect.gen(function* () {
            const now = Date.now();

            forget(now);
            live.set(id, { owner, view, endedAt: ended ? now : null });
            yield* PubSub.publish(changes, view);
          });

        const attempt = (job: RegisteredJob, claimed: JobWithMetadata<object>) =>
          Effect.gen(function* () {
            const owner = Option.match(ownerOf(claimed.data), {
              onNone: () => "",
              onSome: ({ owner: whose }) => whose,
            });

            let view = attemptStarted(claimed);

            yield* show(claimed.id, owner, view, false);

            const progress = {
              step: (step: string, counts?: { done: number; total?: number }) =>
                Effect.suspend(() => {
                  view = stepReported(view, step, counts);

                  return show(claimed.id, owner, view, false);
                }),
            };

            const outcome = yield* job.attempt(claimed).pipe(
              Effect.provideService(JobProgress, progress),
              Effect.onInterrupt(() =>
                Effect.suspend(() => {
                  view = attemptEnded(view, { failure: FAILURES.interrupted, retry: true });

                  return show(claimed.id, owner, view, true).pipe(
                    Effect.andThen(annotate({ "gousset.job.outcome": outcomeName(view, true) })),
                  );
                }),
              ),
            );

            view = attemptEnded(view, outcome);
            yield* show(claimed.id, owner, view, true);
            yield* annotate({ "gousset.job.outcome": outcomeName(view, false) });

            return outcome;
          }).pipe(
            withSpan("job", {
              "gousset.job.name": job.name,
              "gousset.job.id": claimed.id,
              "gousset.job.attempt": claimed.retryCount + 1,
            }),
          );

        for (const job of registered.values()) {
          yield* Effect.tryPromise({
            try: async () => {
              await boss.createQueue(job.name);
              await boss.work(
                job.name,
                {
                  batchSize: 1,
                  includeMetadata: true,
                  perJobResults: true,
                  pollingIntervalSeconds: 1,
                },
                async (claimed: Array<JobWithMetadata<object>>) =>
                  Promise.all(
                    claimed.map(async (one) =>
                      telemetry
                        .runPromise(attempt(job, one), { signal: one.signal })
                        // Stopped by pg-boss (a stop, a timeout): it has failed the job already.
                        .catch(() => ({ failure: FAILURES.interrupted, retry: true }))
                        .then((outcome) => resultOf(one.id, outcome)),
                    ),
                  ),
              );
            },
            catch: () => new JobQueueUnavailable(),
          });
        }

        const findRow = (id: string) =>
          Effect.tryPromise({
            try: async () => {
              for (const name of registered.keys()) {
                const [row] = await boss.findJobs<object>(name, { id });

                if (row !== undefined) {
                  return found(row);
                }
              }

              return null;
            },
            catch: () => new JobQueueUnavailable(),
          });

        return {
          changes,

          send: <Input, Encoded>(
            definition: JobDefinition<Input, Encoded>,
            owner: string,
            input: Input,
          ) =>
            Effect.gen(function* () {
              const job = registered.get(definition.name);

              if (job === undefined) {
                return yield* Effect.die(`The job ${definition.name} is not registered.`);
              }

              const data = yield* Schema.encodeEffect(envelopeOf(definition))({
                owner,
                input,
              }).pipe(Effect.mapError(invalidInput));

              const id = yield* Effect.tryPromise({
                try: async () => boss.send(job.name, data, job.options),
                catch: () => new JobQueueUnavailable(),
              });

              return id ?? (yield* new JobQueueUnavailable());
            }),

          view: (id: string, owner: string) =>
            Effect.gen(function* () {
              forget(Date.now());

              const known = live.get(id);

              if (known !== undefined) {
                return known.owner === owner ? known.view : null;
              }

              // pg-boss's ids are UUIDs: anything else is no job, not a query Postgres refuses.
              if (!isJobId(id)) {
                return null;
              }

              const row = yield* findRow(id);

              // An attempt that started while the row was read is newer than the row.
              const started = live.get(id);

              if (started !== undefined) {
                return started.owner === owner ? started.view : null;
              }

              return row !== null && row.owner === owner ? row.view : null;
            }),

          list: (owner: string) =>
            Effect.tryPromise({
              try: async () => {
                const rows = await Promise.all(
                  [...registered.keys()].map(async (name) =>
                    boss.findJobs<object>(name, { data: { owner } }),
                  ),
                );

                return rows
                  .flat()
                  .flatMap((row) => {
                    const one = found(row);

                    return one === null ? [] : [one];
                  })
                  .toSorted((a, b) => b.createdOn.getTime() - a.createdOn.getTime())
                  .slice(0, LISTED_JOBS)
                  .map((one) => live.get(one.view.id)?.view ?? one.view);
              },
              catch: () => new JobQueueUnavailable(),
            }),
        };
      }),
    );
}
