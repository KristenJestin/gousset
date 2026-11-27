import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { Option, Schema } from "effect";

/** Where a worker's app writes its output: kept with the run's results (`startApp`). */
export function appLogFile(outputDir: string, project: string, slot: number): string {
  return join(outputDir, `app-${project}-worker-${slot}.log`);
}

/** How far the log has been written, where a test starts reading it. */
export function appLogSize(logFile: string): number {
  return existsSync(logFile) ? statSync(logFile).size : 0;
}

/** A line of the app's telemetry (packages/telemetry): one JSON object per line. */
const LogLine = Schema.fromJsonString(Schema.Struct({ level: Schema.String }));
const logLine = Schema.decodeUnknownOption(LogLine);

/** The levels a failed test prints: what the app said went wrong, never its ordinary output. */
const PRINTED_LEVELS: ReadonlySet<string> = new Set(["Warn", "Error", "Fatal"]);

/** At most this many lines, the last ones, each cut to this length: a job log stays readable. */
const PRINTED_LINES = 40;
const LINE_KEPT = 2000;

/**
 * What the app logged from `offset` on that a failed test prints (#241): its warnings and errors
 * (a save that lasts, a job's attempt that ended unfinished), and any line that is not its
 * telemetry's (a crash's trace). The job log then shows them, without the run's artifact.
 */
export function appLogWarnings(logFile: string, offset: number): ReadonlyArray<string> {
  const size = appLogSize(logFile);

  if (size <= offset) {
    return [];
  }

  const bytes = Buffer.alloc(size - offset);
  const file = openSync(logFile, "r");

  try {
    readSync(file, bytes, 0, bytes.length, offset);
  } finally {
    closeSync(file);
  }

  const printed = bytes
    .toString("utf8")
    .split("\n")
    .flatMap((line) =>
      Option.match(logLine(line), {
        onNone: () => (line.trim() === "" ? [] : [line]),
        onSome: ({ level }) => (PRINTED_LEVELS.has(level) ? [line] : []),
      }),
    );

  return printed
    .slice(-PRINTED_LINES)
    .map((line) => (line.length > LINE_KEPT ? `${line.slice(0, LINE_KEPT - 1)}…` : line));
}
