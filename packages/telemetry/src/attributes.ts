/**
 * Every attribute key a span may carry. Each holds an identifier, a count, a status or a value
 * from a closed set: never an amount, a label, a merchant, an IBAN or a file name, so that a trace
 * can go to a third party without revealing anything (docs/architecture.md, "Telemetry").
 *
 * A new key is added here, where a reviewer reads it; the test of this package and the end-to-end
 * collector scenario fail on any span attribute that is not in this list.
 */
export const ALLOWED_SPAN_ATTRIBUTES = [
  // HTTP, after the OpenTelemetry semantic conventions; the method is reduced to a known set.
  "http.request.method",
  "http.response.status_code",
  // Which of TanStack Start's handlers served the request: "router" (a page, a server route) or
  // "serverFn".
  "gousset.request.handler",
  // A server function's name in the code, never its arguments.
  "gousset.server_function",
  // Added by Effect's OTLP exporter to a span whose fiber was interrupted.
  "effect.fiber.interrupted",
] as const;

export type AllowedSpanAttribute = (typeof ALLOWED_SPAN_ATTRIBUTES)[number];

/** The attributes of a span, typed so that a key outside the allowlist does not compile. */
export type SpanAttributes = Partial<Record<AllowedSpanAttribute, string | number | boolean>>;

const allowed = new Set<string>(ALLOWED_SPAN_ATTRIBUTES);

/** The keys among `keys` that the allowlist does not hold, in their order. */
export const disallowedAttributes = (keys: Iterable<string>): ReadonlyArray<string> =>
  Array.from(keys).filter((key) => !allowed.has(key));
