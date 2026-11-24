import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
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
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "./gousset";
import { connectInProcess } from "./test-client";

// The budget of docs/mcp.md ("The budget"). When a guard fails, nobody trims a description to make
// room: the maintainer decides. The listing's cap was raised from 30,000 (about ten tools of up to
// 4,000 each), then raised from 40,000 for #32 and #35 by the lead, under the owner's delegation,
// pending his confirmation.
const MAX_TOOLS = 15;
const MAX_LISTING_CHARACTERS = 44_000;
const MAX_DESCRIPTION_CHARACTERS = 4000;
const MAX_INSTRUCTION_WORDS = 600;

const reader = { userId: "guard", canWrite: false, currency: "EUR" };

async function listing() {
  const client = await connectInProcess(
    goussetServer,
    {
      // Listing calls no tool: the imports, the export and the rules are never reached.
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
              Layer.mock(MonthFacts, {}),
            ),
          ),
        ),
    },
    reader,
    "2025-11-25",
  );

  return (await client.listTools()).tools;
}

describe("the budget", () => {
  test(`at most ${MAX_TOOLS} tools`, async () => {
    expect((await listing()).length).toBeLessThanOrEqual(MAX_TOOLS);
  });

  test(`at most ${MAX_LISTING_CHARACTERS} characters of definitions in the listing`, async () => {
    const size = JSON.stringify(await listing()).length;

    expect(size).toBeLessThanOrEqual(MAX_LISTING_CHARACTERS);
  });

  test(`every description under ${MAX_DESCRIPTION_CHARACTERS} characters`, async () => {
    for (const tool of await listing()) {
      expect(tool.description?.length ?? 0, tool.name).toBeLessThan(MAX_DESCRIPTION_CHARACTERS);
    }
  });

  test("every tool has a title, a description and its annotations", async () => {
    for (const tool of await listing()) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf("boolean");
      expect(tool.annotations?.idempotentHint, tool.name).toBeTypeOf("boolean");
      expect(tool.annotations?.destructiveHint, tool.name).toBe(!tool.annotations?.readOnlyHint);
    }
  });
});

describe("the instructions", () => {
  const { instructions } = goussetServer;

  test(`are under ${MAX_INSTRUCTION_WORDS} words`, () => {
    expect(instructions.split(/\s+/).filter(Boolean).length).toBeLessThan(MAX_INSTRUCTION_WORDS);
  });

  test("name only tools that exist, and every tool", async () => {
    const named = new Set([...instructions.matchAll(/`([a-z_]+)`/g)].map(([, name]) => name));
    const tools = new Set((await listing()).map((tool) => tool.name));

    expect(named).toStrictEqual(tools);
  });
});
