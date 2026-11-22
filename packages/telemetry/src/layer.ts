import { Config, Duration, Effect, Formatter, Layer, Logger, Tracer } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  OtlpExporter,
  OtlpMetrics,
  OtlpResource,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";
import type { OtlpLogger } from "effect/observability";

import { privacyTracer, privateLogEntries } from "./privacy";
import type { LoggedValue, PrivateLogEntry } from "./privacy";

const SERVICE_NAME = "gousset";

const resource = { serviceName: SERVICE_NAME };

/** One JSON line per log on standard output, with the trace and the span it was written in. */
const stdoutLogger = Logger.withConsoleLog(
  Logger.map(privateLogEntries, (entry) => Formatter.formatJson(entry)),
);

/** OTLP's severity numbers, by Effect's log level. */
const SEVERITY = {
  All: 0,
  None: 0,
  Trace: 1,
  Debug: 5,
  Info: 9,
  Warn: 13,
  Error: 17,
  Fatal: 21,
} as const;

const severityOf = (level: string): (typeof SEVERITY)[keyof typeof SEVERITY] =>
  Object.entries(SEVERITY).find(([name]) => name === level)?.[1] ?? 0;

const NANOS_PER_MILLI = 1_000_000n;

const logRecord = (entry: PrivateLogEntry) => {
  const time = String(BigInt(entry.date.getTime()) * NANOS_PER_MILLI);
  const attributes: Array<[string, LoggedValue]> = Object.entries(entry.annotations);

  if (entry.error !== undefined) {
    attributes.push(["exception.type", entry.error.name]);
  }

  if (entry.error !== undefined && entry.error.code !== "") {
    attributes.push(["exception.code", entry.error.code]);
  }

  return {
    timeUnixNano: time,
    observedTimeUnixNano: time,
    severityNumber: severityOf(entry.level),
    severityText: entry.level,
    body: OtlpResource.unknownToAttributeValue(
      entry.message.length === 1 ? entry.message[0] : entry.message,
    ),
    attributes: OtlpResource.entriesToAttributes(attributes),
    droppedAttributesCount: 0,
    traceId: entry.traceId?.padStart(32, "0"),
    spanId: entry.spanId,
  };
};

type LogRecord = ReturnType<typeof logRecord>;

/**
 * Log lines over OTLP, written by Gousset from `PrivateLogEntry` rather than by Effect's
 * `OtlpLogger`, which exports every annotation, log span and error message as it is.
 */
const otlpLogger = (url: string) =>
  Effect.gen(function* () {
    const serialization = yield* OtlpSerialization.OtlpSerialization;
    const otelResource = yield* OtlpResource.fromConfig(resource);

    const exporter = yield* OtlpExporter.make({
      label: "GoussetLogger",
      url,
      headers: undefined,
      exportInterval: Duration.seconds(1),
      maxBatchSize: 1000,
      shutdownTimeout: Duration.seconds(3),
      body: (records: Array<LogRecord>) => {
        const data: OtlpLogger.LogsData = {
          resourceLogs: [
            {
              resource: otelResource,
              scopeLogs: [{ scope: { name: SERVICE_NAME }, logRecords: records }],
            },
          ],
        };

        return [serialization.logs(data), Effect.void] as const;
      },
    });

    return Logger.map(privateLogEntries, (entry) => exporter.push(logRecord(entry)));
  });

/** Every span ends through `privacyTracer`, whatever tracer is installed. */
const privateTracer = Layer.effect(Tracer.Tracer, Effect.map(Effect.tracer, privacyTracer));

/**
 * Gousset's telemetry. Off while `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or empty: logs go to
 * standard output and nothing leaves the server. Set, traces, metrics and logs are exported over
 * OTLP/HTTP to that collector, chosen by whoever installs Gousset, and logs still go to standard
 * output, so that `docker compose logs` keeps working. These loggers replace Effect's own, which
 * would write log lines into span events.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const endpoint = (yield* Config.String("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
      Config.withDefault(""),
    ))
      .trim()
      .replace(/\/+$/, "");

    if (endpoint === "") {
      return Layer.mergeAll(privateTracer, Logger.layer([stdoutLogger]));
    }

    const exporting = Layer.mergeAll(
      OtlpTracer.layer({ url: `${endpoint}/v1/traces`, resource }),
      OtlpMetrics.layer({ url: `${endpoint}/v1/metrics`, resource }),
      Logger.layer([stdoutLogger, otlpLogger(`${endpoint}/v1/logs`)]).pipe(
        Layer.provideMerge(OtlpExporter.layerFlusher),
      ),
    ).pipe(Layer.provide(Layer.mergeAll(OtlpSerialization.layerJson, FetchHttpClient.layer)));

    return privateTracer.pipe(Layer.provideMerge(exporting));
  }).pipe(Effect.orDie),
);
