import { AsyncLocalStorage } from "node:async_hooks";

import { Effect, Option } from "effect";
import type { Tracer } from "effect";

import type { SpanAttributes } from "./attributes";

/** `Effect.withSpan`, with attributes held to the allowlist. */
export const withSpan =
  (name: string, attributes: SpanAttributes, kind: "internal" | "server" = "internal") =>
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

const KNOWN_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

/** The method as the semantic conventions record it: a known method, or `_OTHER`. */
const recordedMethod = (method: string): string => {
  const upper = method.toUpperCase();

  return KNOWN_METHODS.has(upper) ? upper : "_OTHER";
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

/** The span of one server function, named by its name in the code. */
export const serverFunctionSpan =
  (name: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    self.pipe(withSpan("server function", { "gousset.server_function": name }));
