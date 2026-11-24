import {
  DataExport,
  ImportProfiles,
  Imports,
  memoryAccountStore,
  memoryLineStore,
} from "@gousset/core";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { callText, connectInProcess } from "../test-client";

// Until the review reads the user's own lines (v0.4), month answers that it is not available yet,
// with no figure and no name (#126).

async function month(args: { [key: string]: string }) {
  const client = await connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              memoryAccountStore(),
              memoryLineStore(),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              Layer.mock(DataExport, {}),
            ),
          ),
        ),
    },
    { userId: "ada", canWrite: false },
    "2025-11-25",
  );

  return callText(client, "month", args);
}

describe("month, until the review ships", () => {
  test.each(["summary", "review", "days"])(
    "%s says the review is not available yet, and where the user's money is read today",
    async (action) => {
      const { text, isError } = await month({ action });

      expect(isError).toBe(false);
      expect(text).toContain("The monthly review is not available yet");
      expect(text).toContain('accounts {"action":"list"}');
      expect(text).toContain('lines {"action":"search"');
    },
  );

  test("gives no figure and no name, whatever the month or the row asked for", async () => {
    const { text, isError } = await month({
      action: "days",
      month: "2026-10",
      by: "category",
      row: "Groceries",
    });

    expect(isError).toBe(false);
    expect(text).not.toMatch(/\d+\.\d\d/);
    expect(text).not.toContain("EUR");
    expect(text).not.toContain("Groceries");
    expect(text).not.toContain("October");
  });

  test("an unknown action is refused with a valid call", async () => {
    const { text, isError } = await month({ action: "forecast" });

    expect(isError).toBe(true);
    expect(text).toContain('month {"action":"summary"}');
  });
});
