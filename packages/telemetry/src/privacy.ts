import { Array as Arr, Cause, Exit, Logger, Option, References, Schema, Tracer } from "effect";

import { exportedSpanName, isAllowedAttribute } from "./attributes";

/**
 * What telemetry keeps of an error: its name and, when it has one, its code (a database's
 * `23505`, a system's `ECONNREFUSED`). Never its message, which may quote the data it failed on.
 */
export interface RecordedError {
  readonly name: string;
  /** The error's code, or an empty string. */
  readonly code: string;
}

const Coded = Schema.Struct({ code: Schema.Union([Schema.String, Schema.Number]) });

const codeOf = Schema.decodeUnknownOption(Coded);

/** The first error of a failure, by its name and code; none for an interruption. */
export const recordedError = (cause: Cause.Cause<unknown>): RecordedError | undefined => {
  if (Cause.hasInterruptsOnly(cause)) {
    return undefined;
  }

  const [first] = Cause.prettyErrors(cause);

  if (first === undefined) {
    return undefined;
  }

  return {
    name: first.name,
    code: codeOf(first).pipe(
      Option.map(({ code }) => String(code)),
      Option.getOrElse(() => ""),
    ),
  };
};

/**
 * The same failure, as the exporters may see it: each error reduced to its name and code. Effect's
 * OTLP exporter writes an error's `message` into the span's status and exception event, so the
 * error handed to it carries the code as its `message`: never put the original message there. An
 * interruption is kept as it is, so that the span is exported as interrupted, not as failed.
 */
export const recordedCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> => {
  const recorded = recordedError(cause);

  return recorded === undefined
    ? cause
    : Cause.fail({ name: recorded.name, message: recorded.code });
};

/**
 * Wraps a tracer so that what it exports holds nothing private, whatever API opened the span:
 * - a name outside `SPAN_NAMES` becomes `UNNAMED_SPAN`;
 * - an attribute outside the allowlist is dropped, `Effect.withSpan`'s and `annotateSpans`'
 *   included;
 * - events are dropped: Effect adds them for log lines, whose text is not checked here;
 * - a failure records each error by its name and code only (`recordedCause`).
 */
export const privacyTracer = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const span = tracer.span({ ...options, name: exportedSpanName(options.name) });
      const end = span.end.bind(span);
      const attribute = span.attribute.bind(span);

      // The span itself, so that its identity and its class stay the tracer's.
      span.end = (endTime, exit) => {
        end(endTime, Exit.isFailure(exit) ? Exit.failCause(recordedCause(exit.cause)) : exit);
      };

      span.attribute = (key, value) => {
        if (isAllowedAttribute(key)) {
          attribute(key, value);
        }
      };

      span.event = () => undefined;

      return span;
    },
    context: tracer.context,
  });

/** A value a log line may hold as it is: a string, a count, a flag. */
const LoggedValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);

const asLoggedValue = Schema.decodeUnknownOption(LoggedValue);

export type LoggedValue = typeof LoggedValue.Type;

/** One log line, as Gousset's loggers write it: nothing in it is private by construction. */
export interface PrivateLogEntry {
  readonly date: Date;
  readonly level: string;
  /**
   * The arguments of the log call. Strings, numbers and booleans as they are (a string is the
   * caller's responsibility: ids and counts only); anything else, an error first, reduced to
   * its name and code.
   */
  readonly message: ReadonlyArray<LoggedValue>;
  /** The annotations in the allowlist; the others are dropped. Log spans are never kept. */
  readonly annotations: Readonly<Record<string, LoggedValue>>;
  readonly error: RecordedError | undefined;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
}

/** Each Effect log line as a `PrivateLogEntry`: the one source of every Gousset logger. */
export const privateLogEntries = Logger.make((options): PrivateLogEntry => {
  const span = options.fiber.cache.span;

  const annotations = Object.entries(
    options.fiber.getRef(References.CurrentLogAnnotations),
  ).flatMap(([key, value]) =>
    isAllowedAttribute(key)
      ? asLoggedValue(value).pipe(
          Option.map((logged): [string, LoggedValue] => [key, logged]),
          Option.toArray,
        )
      : [],
  );

  return {
    date: options.date,
    level: options.logLevel,
    message: Arr.ensure(options.message).map((value) =>
      asLoggedValue(value).pipe(
        Option.getOrElse(() => {
          const recorded = recordedError(Cause.fail(value));

          return recorded === undefined ? "" : `${recorded.name} ${recorded.code}`.trim();
        }),
      ),
    ),
    annotations: Object.fromEntries(annotations),
    error: recordedError(options.cause),
    traceId: span?.traceId,
    spanId: span?.spanId,
  };
});
