import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Investments,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryLineStore,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { goussetServer } from "@gousset/mcp/gousset";
import { callText, connectInProcess } from "@gousset/mcp/test-client";
import { Effect, Layer, Tracer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { mcpCallObserver } from "./mcp-telemetry";

/** A tracer that keeps every span it makes. */
function recording() {
  const spans: Array<Tracer.NativeSpan> = [];

  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);

      spans.push(span);

      return span;
    },
  });

  return { spans, tracer };
}

describe("a call to the MCP door", () => {
  test.each(["2025-11-25", "2026-07-28"] as const)(
    "under %s, yields one span with exactly the tool, the action and the outcome",
    async (revision) => {
      const { spans, tracer } = recording();

      const observe = mcpCallObserver((effect) =>
        Effect.runPromise(effect.pipe(Effect.provideService(Tracer.Tracer, tracer))),
      );

      const client = await connectInProcess(
        goussetServer,
        {
          // The call reaches no import nor export, and reads an empty month.
          run: (effect) =>
            Effect.runPromiseExit(
              Effect.provide(
                effect,
                Layer.mergeAll(
                  memoryAccountStore(),
                  memoryLineStore(),
                  memoryCategoryStore(),
                  Layer.mock(Imports, {}),
                  Layer.mock(ImportProfiles, {}),
                  Layer.mock(DataExport, {}),
                  Layer.mock(Merchants, {}),
                  Layer.mock(Transfers, {}),
                  Layer.mock(Expenses, {}),
                  Layer.mock(UserData, {}),
                  Layer.mock(RuleJobs, {}),
                  Layer.mock(Subscriptions, {}),
                  Layer.mock(Investments, {}),
                  // A month of nothing: the call reads it, and answers.
                  Layer.succeed(MonthFacts, {
                    read: () =>
                      Effect.succeed({
                        accounts: [],
                        categories: [],
                        parts: [],
                        transfers: [],
                        merchants: [],
                        aliases: [],
                        firstDay: null,
                        benefitLines: [],
                        reach: [],
                        charges: [],
                      }),
                  }),
                ),
              ),
            ),
          observe,
        },
        { userId: "ada", canWrite: false, currency: "EUR" },
        revision,
      );

      const { isError } = await callText(client, "month", { action: "summary", month: "2026-10" });

      expect(isError).toBe(false);
      expect(spans.map(({ name }) => name)).toEqual(["mcp tool call"]);
      expect(Object.fromEntries(spans[0]?.attributes ?? [])).toEqual({
        "gousset.mcp.tool": "month",
        "gousset.mcp.action": "summary",
        "gousset.mcp.outcome": "ok",
      });
    },
  );
});
