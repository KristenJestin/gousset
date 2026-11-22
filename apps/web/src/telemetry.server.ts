import { layer } from "@gousset/telemetry";
import { ManagedRuntime } from "effect";

/**
 * The server's telemetry, built once on the first request: OTLP export when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set, JSON logs on standard output always. Anything that opens a
 * span outside Effect (a request, a server function, a call to `/mcp`) runs it here, so that its
 * spans share this tracer and nest under the request's span.
 */
export const telemetry = ManagedRuntime.make(layer);
