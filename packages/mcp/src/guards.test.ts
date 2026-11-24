import {
  DataExport,
  FixtureLedger,
  ImportProfiles,
  Imports,
  memoryAccountStore,
  memoryLineStore,
} from "@gousset/core";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "./gousset";
import { connectInProcess } from "./test-client";

// The budget of docs/mcp.md ("The budget"). When a guard fails, nobody trims a description to make
// room: the maintainer decides.
const MAX_TOOLS = 15;
const MAX_LISTING_CHARACTERS = 30_000;
const MAX_DESCRIPTION_CHARACTERS = 4000;
const MAX_INSTRUCTION_WORDS = 600;

const reader = { userId: "guard", canWrite: false };

async function listing() {
  const client = await connectInProcess(
    goussetServer,
    {
      // Listing calls no tool: the imports and the export are never reached.
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              FixtureLedger,
              memoryAccountStore(),
              memoryLineStore(),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              Layer.mock(DataExport, {}),
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
