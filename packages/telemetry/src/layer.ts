import { Config, Effect, Formatter, Layer, Logger, Tracer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Otlp } from "effect/observability";

import { privacyLogger, privacyTracer } from "./privacy";

const SERVICE_NAME = "gousset";

/** One JSON line per log on standard output, with the trace and the span it was written in. */
const stdoutLogger = Logger.withConsoleLog(
  Logger.make((options) => {
    const span = options.fiber.cache.span;

    return Formatter.formatJson({
      ...Logger.formatStructured.log(options),
      traceId: span?.traceId,
      spanId: span?.spanId,
    });
  }),
);

/** Every span ends through `privacyTracer`, whatever tracer is installed. */
const privateTracer = Layer.effect(Tracer.Tracer, Effect.map(Effect.tracer, privacyTracer));

/** Every logger writes through `privacyLogger`, whatever loggers are installed. */
const privateLoggers = Layer.effect(
  Logger.CurrentLoggers,
  Effect.map(
    Effect.service(Logger.CurrentLoggers),
    (loggers) => new Set(Array.from(loggers, privacyLogger)),
  ),
);

const privacy = Layer.mergeAll(privateTracer, privateLoggers);

const stdout = Logger.layer([stdoutLogger]);

/**
 * Gousset's telemetry. Off while `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or empty: logs go to
 * standard output and nothing leaves the server. Set, traces, metrics and logs are exported over
 * OTLP/HTTP to that collector, chosen by whoever installs Gousset, and logs still go to standard
 * output, so that `docker compose logs` keeps working.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const endpoint = (yield* Config.String("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
      Config.withDefault(""),
    )).trim();

    if (endpoint === "") {
      return privacy.pipe(Layer.provide(stdout));
    }

    const otlp = Otlp.layerJson({
      baseUrl: endpoint,
      resource: { serviceName: SERVICE_NAME },
      loggerMergeWithExisting: true,
    }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(stdout));

    return privacy.pipe(Layer.provideMerge(otlp));
  }).pipe(Effect.orDie),
);
