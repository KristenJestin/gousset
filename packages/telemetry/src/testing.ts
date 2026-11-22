import { createServer } from "node:http";
import { text } from "node:stream/consumers";

import { Schema } from "effect";

/**
 * A local OTLP/HTTP collector for tests: it answers every export with 200 and keeps what it was
 * sent, so that a test reads the spans the app exported. Never used outside tests.
 */

const Attribute = Schema.Struct({ key: Schema.String });

const ExportedSpan = Schema.Struct({
  name: Schema.String,
  traceId: Schema.String,
  attributes: Schema.Array(Attribute),
  events: Schema.Array(Schema.Struct({ name: Schema.String, attributes: Schema.Array(Attribute) })),
});

const TracesExport = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(ExportedSpan) })),
    }),
  ),
});

const decodeTraces = Schema.decodeUnknownSync(Schema.fromJsonString(TracesExport));

export type ExportedSpan = typeof ExportedSpan.Type;

export interface ReceivedExport {
  /** `/v1/traces`, `/v1/logs` or `/v1/metrics`. */
  readonly path: string;
  readonly body: string;
}

export interface OtlpReceiver {
  /** The base URL to give `OTEL_EXPORTER_OTLP_ENDPOINT`. */
  readonly url: string;
  /** Every export received, in order. */
  readonly received: () => ReadonlyArray<ReceivedExport>;
  /** Every span of every trace export received. */
  readonly spans: () => ReadonlyArray<ExportedSpan>;
  readonly close: () => Promise<void>;
}

/** What a TCP server listening on a port says of its address. */
const ListeningAddress = Schema.Struct({ port: Schema.Number });

/** Starts a receiver on a free port of 127.0.0.1. */
export const startOtlpReceiver = async (): Promise<OtlpReceiver> => {
  const received: Array<ReceivedExport> = [];

  const server = createServer((request, response) => {
    void text(request).then((body) => {
      received.push({ path: request.url ?? "", body });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = Schema.decodeUnknownSync(ListeningAddress)(server.address());

  return {
    url: `http://127.0.0.1:${port}`,
    received: () => received.slice(),
    spans: () =>
      received.flatMap(({ path, body }) =>
        path === "/v1/traces"
          ? decodeTraces(body).resourceSpans.flatMap(({ scopeSpans }) =>
              scopeSpans.flatMap(({ spans }) => spans),
            )
          : [],
      ),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};
