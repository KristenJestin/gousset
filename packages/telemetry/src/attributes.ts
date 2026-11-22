/**
 * Every attribute key a span, or a log line's annotation, may carry. Each holds an identifier, a
 * count, a status or a value from a closed set: never an amount, a label, a merchant, an IBAN or a
 * file name, so that a trace can go to a third party without revealing anything
 * (docs/architecture.md, "Telemetry").
 *
 * A new key is added here, where a reviewer reads it. Any other key is dropped when the span or
 * the log line is exported (`privacyTracer`, `privateLogEntries`); the types of `withSpan` and
 * `annotate` refuse it already.
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

/** Whether a key is in the allowlist. */
export const isAllowedAttribute = (key: string): boolean => allowed.has(key);

/** The keys among `keys` that the allowlist does not hold, in their order. */
export const disallowedAttributes = (keys: Iterable<string>): ReadonlyArray<string> =>
  Array.from(keys).filter((key) => !allowed.has(key));

/**
 * Every name a span may take: a name built from data could carry it to the collector. A span
 * named otherwise is exported as `UNNAMED_SPAN`. A new kind of span (a call to `/mcp`, a job)
 * adds its name here.
 */
export const SPAN_NAMES = [
  // A request, by its method (`requestSpan`).
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
  "_OTHER",
  // A server function (`serverFunctionSpan`), its name in an attribute.
  "server function",
] as const;

export type SpanName = (typeof SPAN_NAMES)[number];

export const UNNAMED_SPAN = "unnamed";

const names = new Set<string>(SPAN_NAMES);

/** The name a span is exported under: its own when the list holds it, `UNNAMED_SPAN` otherwise. */
export const exportedSpanName = (name: string): string => (names.has(name) ? name : UNNAMED_SPAN);
