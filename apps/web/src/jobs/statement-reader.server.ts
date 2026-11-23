import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { ReadFailed, StatementReader, inlineStatementReader } from "@gousset/core";
import { ReadOutcome } from "@gousset/core/read";
import type { ReadRequest, ReadStatement } from "@gousset/core/read";
import { Effect, Layer, Schema } from "effect";

/**
 * The worker thread's program (`read-statement.worker.ts`), bundled next to the server's entry
 * (`.output/server/index.mjs`) by `pnpm build`. Development has none: the readers run in the
 * app's thread there.
 */
export const READER_FILE = "read-statement.mjs";

/** How long a file may take to read: past it, the thread is stopped and the import fails. */
const READ_TIMEOUT_MS = 60_000;

/** A heap of its own, so that a crafted file runs the thread out of memory, not the app. */
const READER_HEAP_MB = 512;

const decodeOutcome = Schema.decodeUnknownEffect(ReadOutcome);

const failed = (code: string) => new ReadFailed({ code, line: null });

function builtReader(): string | undefined {
  const entry = process.argv[1];

  if (entry === undefined) {
    return undefined;
  }

  // Absolute: a Worker refuses a relative path, and the entry may be given as one
  // (`node .output/server/index.mjs`).
  const path = resolve(dirname(entry), READER_FILE);

  return existsSync(path) ? path : undefined;
}

/**
 * Reads one file in a thread of its own, which ends with it: the readers are synchronous, and a
 * crafted file would otherwise hold every request of the app while it is read.
 */
function readInWorker(
  path: string,
  request: ReadRequest,
): Effect.Effect<ReadStatement, ReadFailed> {
  return Effect.callback<ReadOutcome, ReadFailed>((resume) => {
    const worker = new Worker(path, {
      workerData: request,
      resourceLimits: { maxOldGenerationSizeMb: READER_HEAP_MB },
    });

    let answered = false;

    const answer = (outcome: Effect.Effect<ReadOutcome, ReadFailed>) => {
      if (answered) {
        return;
      }

      answered = true;
      clearTimeout(timer);
      void worker.terminate();
      resume(outcome);
    };

    const timer = setTimeout(() => answer(Effect.fail(failed("READ_TIMEOUT"))), READ_TIMEOUT_MS);

    worker.once("message", (message) => {
      answer(decodeOutcome(message).pipe(Effect.mapError(() => failed("READ_CRASHED"))));
    });

    worker.once("error", () => answer(Effect.fail(failed("READ_CRASHED"))));
    worker.once("exit", () => answer(Effect.fail(failed("READ_CRASHED"))));

    // The job stopped (the app stops, the attempt timed out): the thread goes with it.
    return Effect.sync(() => {
      answered = true;
      clearTimeout(timer);
      void worker.terminate();
    });
  }).pipe(
    Effect.flatMap((outcome) =>
      "statement" in outcome
        ? Effect.succeed(outcome.statement)
        : Effect.fail(new ReadFailed(outcome.failed)),
    ),
  );
}

/** Where the import job reads its files: a worker thread once built, this thread in development. */
export const statementReader = Layer.suspend(() => {
  const path = builtReader();

  return path === undefined
    ? inlineStatementReader
    : Layer.succeed(StatementReader, { read: (request) => readInWorker(path, request) });
});
