import {
  Cause,
  ConfigProvider,
  Data,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Tracer,
} from "effect";
import { TestConsole } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import {
  ALLOWED_SPAN_ATTRIBUTES,
  disallowedAttributes,
  fromPromise,
  layer,
  privacyTracer,
  requestSpan,
  serverFunctionSpan,
  underActiveSpan,
} from "./index";
import { startOtlpReceiver } from "./testing";

/** What a failure may say and telemetry must never repeat: a label, an amount, a file name. */
const PRIVATE = "Lunch at Chez Martine, 12.40 EUR, from statement-2026-10.csv";

class ImportFailed extends Data.TaggedError("ImportFailed")<{
  readonly message: string;
  readonly code: string;
}> {}

/** A tracer that keeps every span it makes and the exit each one ended with. */
const recording = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const exits: Array<Exit.Exit<unknown, unknown>> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);

      span.end = (endTime, exit) => {
        exits.push(exit);
        end(endTime, exit);
      };

      spans.push(span);

      return span;
    },
  });

  return { spans, exits, tracer };
};

/** A page, then a server function that fails on private data: the spans Gousset opens today. */
const requests = Effect.all(
  [
    Effect.succeed({ response: { status: 200 } }).pipe(
      requestSpan({ method: "get", handler: "router" }),
    ),
    Effect.fail(new ImportFailed({ message: PRIVATE, code: "23505" })).pipe(
      serverFunctionSpan("importStatement"),
      Effect.as({ response: { status: 200 } }),
      requestSpan({ method: "POST", handler: "serverFn" }),
      Effect.exit,
    ),
  ],
  { concurrency: 1 },
);

const configured = (variables: Record<string, string>) =>
  layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(variables))));

describe("span attributes", () => {
  test("every attribute of Gousset's spans is in the allowlist", async () => {
    const { spans, tracer } = recording();

    await Effect.runPromise(requests.pipe(Effect.provideService(Tracer.Tracer, tracer)));

    expect(spans.map(({ name }) => name)).toEqual(["GET", "POST", "server function"]);
    expect(
      disallowedAttributes(spans.flatMap(({ attributes }) => Array.from(attributes.keys()))),
    ).toEqual([]);
  });

  test("an attribute outside the allowlist is caught", async () => {
    const { spans, tracer } = recording();

    await Effect.runPromise(
      Effect.void.pipe(
        Effect.withSpan("categorise", {
          attributes: { "gousset.request.handler": "router", "merchant.name": PRIVATE },
        }),
        Effect.provideService(Tracer.Tracer, tracer),
      ),
    );

    expect(
      disallowedAttributes(spans.flatMap(({ attributes }) => Array.from(attributes.keys()))),
    ).toEqual(["merchant.name"]);
    expect(ALLOWED_SPAN_ATTRIBUTES).not.toContain("merchant.name");
  });
});

describe("nesting", () => {
  test("a server function's span nests under its request's, across two runPromise calls", async () => {
    const { spans, tracer } = recording();

    // As TanStack Start's middlewares do: the request's `next()` leaves Effect, and the server
    // function's middleware comes back to it in a runPromise of its own.
    const run = async <A, E>(self: Effect.Effect<A, E>) =>
      Effect.runPromise(underActiveSpan(self).pipe(Effect.provideService(Tracer.Tracer, tracer)));

    await run(
      fromPromise(async () =>
        run(
          fromPromise(async () => ({ response: { status: 200 } })).pipe(
            serverFunctionSpan("importStatement"),
          ),
        ),
      ).pipe(requestSpan({ method: "POST", handler: "serverFn" })),
    );

    const [request, serverFunction] = spans;

    expect(serverFunction?.traceId).toBe(request?.traceId);
    expect(
      serverFunction?.parent.pipe(
        Option.map(({ spanId }) => spanId),
        Option.getOrUndefined,
      ),
    ).toBe(request?.spanId);
  });
});

describe("errors", () => {
  test("a failed span records the error by its name and code, not its message", async () => {
    const { exits, tracer } = recording();

    await Effect.runPromise(
      requests.pipe(Effect.provideService(Tracer.Tracer, privacyTracer(tracer))),
    );

    const recorded = exits.flatMap((exit) =>
      Exit.isFailure(exit) ? Cause.prettyErrors(exit.cause, { includeCauseInStack: true }) : [],
    );

    expect(recorded.map(({ name, message }) => ({ name, message }))).toEqual([
      { name: "ImportFailed", message: "23505" },
      { name: "ImportFailed", message: "23505" },
    ]);
    expect(JSON.stringify(recorded.map(({ stack }) => stack))).not.toContain("Chez Martine");
  });

  test("a rejected promise reaches the caller untouched", async () => {
    const rejection = new ImportFailed({ message: PRIVATE, code: "23505" });

    await expect(
      Effect.runPromise(
        fromPromise(async () => {
          throw rejection;
        }).pipe(serverFunctionSpan("importStatement")),
      ),
    ).rejects.toBe(rejection);
  });
});

const LogLine = Schema.fromJsonString(
  Schema.Struct({ level: Schema.String, traceId: Schema.String, spanId: Schema.String }),
);

describe("logs", () => {
  test("without an endpoint, logs are JSON lines on standard output tied to their trace", async () => {
    const program = Effect.gen(function* () {
      const span = yield* Effect.currentSpan;

      yield* Effect.logError(
        "import failed",
        Cause.fail(new ImportFailed({ message: PRIVATE, code: "23505" })),
      );

      return span;
    }).pipe(Effect.withSpan("import"));

    const [span, lines] = await Effect.runPromise(
      Effect.all([program, TestConsole.logLines]).pipe(
        Effect.provide(Layer.mergeAll(configured({}), TestConsole.layer)),
      ),
    );

    const written = Schema.decodeUnknownSync(Schema.Array(Schema.String))(lines);

    expect(written).toHaveLength(1);
    expect(Schema.decodeUnknownSync(LogLine)(written[0])).toEqual({
      level: "ERROR",
      traceId: span.traceId,
      spanId: span.spanId,
    });
    expect(written[0]).not.toContain("Chez Martine");
  });
});

describe("export", () => {
  test("with an endpoint, traces and logs reach the collector, with nothing private", async () => {
    const receiver = await startOtlpReceiver();

    try {
      const runtime = ManagedRuntime.make(
        configured({ OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url }).pipe(
          Layer.provide(TestConsole.layer),
        ),
      );

      await runtime.runPromise(
        requests.pipe(
          Effect.tap(() =>
            Effect.logError(
              "import failed",
              Cause.fail(new ImportFailed({ message: PRIVATE, code: "23505" })),
            ),
          ),
          Effect.withSpan("import"),
        ),
      );
      await runtime.dispose();

      const spans = receiver.spans();

      expect(spans.map(({ name }) => name).toSorted()).toEqual([
        "GET",
        "POST",
        "import",
        "server function",
      ]);
      expect(new Set(spans.map(({ traceId }) => traceId)).size).toBe(1);
      expect(
        disallowedAttributes(spans.flatMap(({ attributes }) => attributes.map(({ key }) => key))),
      ).toEqual([]);
      expect(receiver.received().map(({ path }) => path)).toContain("/v1/logs");

      for (const { body } of receiver.received()) {
        expect(body).not.toContain("Chez Martine");
      }
    } finally {
      await receiver.close();
    }
  });

  test("without an endpoint, nothing is sent", async () => {
    const receiver = await startOtlpReceiver();

    try {
      // Only OTEL_EXPORTER_OTLP_ENDPOINT turns telemetry on; a signal's own variable does not.
      const runtime = ManagedRuntime.make(
        configured({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${receiver.url}/v1/traces` }).pipe(
          Layer.provide(TestConsole.layer),
        ),
      );

      await runtime.runPromise(requests.pipe(Effect.withSpan("import")));
      await runtime.dispose();

      expect(receiver.received()).toEqual([]);
    } finally {
      await receiver.close();
    }
  });
});
