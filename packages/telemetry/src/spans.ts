import { AsyncLocalStorage } from "node:async_hooks";

import { Effect, Option } from "effect";
import type { Tracer } from "effect";

import { SPAN_NAMES } from "./attributes";
import type { SpanAttributes, SpanName } from "./attributes";

/** `Effect.withSpan`, with its name from `SPAN_NAMES` and its attributes from the allowlist. */
export const withSpan =
  (name: SpanName, attributes: SpanAttributes, kind: "internal" | "server" = "internal") =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.withSpan(self, name, { attributes, kind });

/** Adds attributes, held to the allowlist, to the current span. */
export const annotate = (attributes: SpanAttributes): Effect.Effect<void> =>
  Effect.annotateCurrentSpan(attributes);

/**
 * The span the current asynchronous work runs in, for work that leaves Effect (a middleware's
 * `next()`) and comes back to it in another `runPromise`.
 */
const activeSpan = new AsyncLocalStorage<Tracer.AnySpan>();

/**
 * A promise as an effect whose failure is what the promise rejected with, untouched, so that a
 * caller outside Effect gets back the very value it would have caught (TanStack's redirects
 * included). Spans opened while it runs, through `underActiveSpan`, nest under the current span.
 */
export const fromPromise = <A>(run: () => PromiseLike<A>) =>
  Effect.flatMap(Effect.option(Effect.currentSpan), (span) =>
    Effect.tryPromise({
      try: async () => (Option.isSome(span) ? activeSpan.run(span.value, run) : run()),
      catch: (cause) => cause,
    }),
  );

/**
 * The effect, under the span of the `fromPromise` it is called from, if any. Read when called, so
 * call it where the effect is handed to `runPromise`.
 */
export const underActiveSpan = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
  const parent = activeSpan.getStore();

  return parent === undefined ? self : Effect.withParentSpan(self, parent);
};

/** The method as the semantic conventions record it: a known method, or `_OTHER`. */
const recordedMethod = (method: string): SpanName => {
  const upper = method.toUpperCase();

  return (
    SPAN_NAMES.find(
      (name) => name === upper && name !== "server function" && name !== "mcp tool call",
    ) ?? "_OTHER"
  );
};

/** The request a server span is opened for: never its URL, its headers or its body. */
export interface IncomingRequest {
  readonly method: string;
  /** Which of TanStack Start's handlers serves it. */
  readonly handler: "router" | "serverFn";
}

/**
 * The span of one request to the server, named after its method (the URL may hold a token or a
 * search, and is never recorded), with the status it answered.
 */
export const requestSpan =
  (request: IncomingRequest) =>
  <A extends { readonly response: { readonly status: number } }, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => {
    const method = recordedMethod(request.method);

    return self.pipe(
      Effect.tap((result) => annotate({ "http.response.status_code": result.response.status })),
      withSpan(
        method,
        { "http.request.method": method, "gousset.request.handler": request.handler },
        "server",
      ),
    );
  };

/** Sets attributes, held to the allowlist, on a span from outside Effect. */
const setAttributes = (span: Tracer.Span, attributes: SpanAttributes) => {
  for (const [key, value] of Object.entries(attributes)) {
    span.attribute(key, value);
  }
};

/**
 * The span of one call to an MCP tool: its tool, then, reported by the call once known, its action
 * and how it ended. The span's own duration is the call's. Never an argument nor a result.
 */
export const mcpToolCall = <A>(
  tool: string,
  run: (report: (action: string, outcome: string) => void) => PromiseLike<A>,
) =>
  Effect.flatMap(Effect.currentSpan, (span) =>
    fromPromise(() =>
      run((action, outcome) =>
        setAttributes(span, { "gousset.mcp.action": action, "gousset.mcp.outcome": outcome }),
      ),
    ),
  ).pipe(withSpan("mcp tool call", { "gousset.mcp.tool": tool }));

/** The span of one server function, named by its name in the code. */
export const serverFunctionSpan =
  (name: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    self.pipe(withSpan("server function", { "gousset.server_function": name }));
