import { Cause, Exit, Logger, Option, Schema, Tracer } from "effect";

/**
 * What telemetry keeps of an error: its name and, when it has one, its code (a database's
 * `23505`, a system's `ECONNREFUSED`). Never its message, which may quote the data it failed on.
 */
export interface RecordedError {
  readonly name: string;
  readonly message: string;
}

const Coded = Schema.Struct({ code: Schema.Union([Schema.String, Schema.Number]) });

const codeOf = Schema.decodeUnknownOption(Coded);

/**
 * The same failure, with each error reduced to its name and code. A cause that only interrupts is
 * kept as it is: it carries no error.
 */
export const recordedCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> => {
  const [first] = Cause.prettyErrors(cause);

  if (first === undefined) {
    return cause;
  }

  const recorded: RecordedError = {
    name: first.name,
    message: codeOf(first).pipe(
      Option.map(({ code }) => String(code)),
      Option.getOrElse(() => ""),
    ),
  };

  return Cause.fail(recorded);
};

/**
 * Wraps a tracer so that a span ending in failure records the error by its name and code only:
 * Effect's OTLP exporter would otherwise send its message and its stack.
 */
export const privacyTracer = (tracer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const span = tracer.span(options);
      const end = span.end.bind(span);

      // The span itself, so that its identity and its class stay the tracer's; only its end changes.
      span.end = (endTime, exit) => {
        end(endTime, Exit.isFailure(exit) ? Exit.failCause(recordedCause(exit.cause)) : exit);
      };

      return span;
    },
    context: tracer.context,
  });

/** Wraps a logger so that the cause of a log line is reduced to its errors' names and codes. */
export const privacyLogger = <Message, Output>(
  logger: Logger.Logger<Message, Output>,
): Logger.Logger<Message, Output> =>
  Logger.make((options) => logger.log({ ...options, cause: recordedCause(options.cause) }));
