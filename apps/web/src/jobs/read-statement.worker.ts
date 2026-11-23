import { parentPort, workerData } from "node:worker_threads";

import { ReadRequest, readOutcome } from "@gousset/core/read";
import { Effect, Schema } from "effect";

// The worker thread an import reads its file in (`statement-reader.server.ts`): one file, one
// thread, which posts the outcome back and ends. Built apart, next to the server's entry
// (`pnpm build`, `build:reader`), so that it holds the readers and nothing of the app.

const request = Schema.decodeUnknownSync(ReadRequest)(workerData);

parentPort?.postMessage(Effect.runSync(readOutcome(request)));
