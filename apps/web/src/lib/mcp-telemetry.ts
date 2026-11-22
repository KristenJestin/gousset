import type { CallObserver } from "@gousset/mcp/tool";
import { mcpToolCall, underActiveSpan } from "@gousset/telemetry";
import type { Effect } from "effect";

/** Runs an effect with the app's telemetry, as `telemetry.runPromise` does. */
type RunWithTelemetry = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/**
 * Each call to an MCP tool in a span of its own, under its request's: the tool, the action, how
 * it ended, and its duration; never an argument nor a result (docs/mcp.md, rule 16).
 */
export const mcpCallObserver =
  (run: RunWithTelemetry): CallObserver =>
  (call, served) =>
    run(underActiveSpan(mcpToolCall(call.tool, served)));
