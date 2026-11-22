import { Effect, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { ERROR_LIMIT, RESULT_LIMIT } from "./results";
import { callText, connectInProcess } from "./test-client";
import type { Revision } from "./test-client";
import { ToolRefusal, defineTool } from "./tool";
import type { CallOutcome, CallObserver, Caller } from "./tool";

// A tool made for these tests only: one read, one write, a long read, a refusal and a failure, so
// that the framework's rules are proved before the real tools need each of them.
const NoteTitle = Schema.String.check(Schema.isMinLength(1)).annotate({
  identifier: "NoteTitle",
  description: "A note's title, as written.",
});

const NotesInput = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({ action: Schema.Literal("long") }),
  Schema.Struct({ action: Schema.Literal("add"), title: NoteTitle }),
  Schema.Struct({ action: Schema.Literal("refuse"), title: NoteTitle }),
  Schema.Struct({ action: Schema.Literal("break") }),
]);

const notes = defineTool({
  name: "notes",
  title: "Notes",
  description: "Test notes.",
  idempotent: false,
  input: NotesInput,
  example: { action: "add", title: "Groceries" },
  access: { list: "read", long: "read", add: "write", refuse: "read", break: "read" },
  run: (input) => {
    switch (input.action) {
      case "list": {
        return Effect.succeed("Groceries\nRent");
      }

      case "long": {
        return Effect.succeed(
          Array.from({ length: 2000 }, (_, line) => `Line ${line}: ${"x".repeat(20)}`).join("\n"),
        );
      }

      case "add": {
        return Effect.succeed(`Added ${input.title}.`);
      }

      case "refuse": {
        return Effect.fail(
          new ToolRefusal({
            message: `No note is called ${input.title}.`,
            example: 'notes {"action":"list"}',
          }),
        );
      }

      case "break": {
        return Effect.die(new Error("a database connection broke at /srv/secret/path"));
      }
    }
  },
});

const timer = defineTool({
  name: "timer",
  title: "Timer",
  description: "Test timer.",
  idempotent: true,
  input: Schema.Struct({ action: Schema.Literal("show") }),
  example: { action: "show" },
  access: { show: "read" },
  run: () => Effect.succeed("Nothing."),
});

function connect(caller: Caller, revision: Revision, observe?: CallObserver) {
  return connectInProcess(
    { tools: [notes, timer], instructions: "Test instructions.", version: "0.0.0", observe },
    caller,
    revision,
  );
}

const reader: Caller = { userId: "user-1", canWrite: false };
const writer: Caller = { userId: "user-1", canWrite: true };

type Connected = Awaited<ReturnType<typeof connect>>;

function call(client: Connected, args: { [key: string]: string }) {
  return callText(client, "notes", args);
}

describe("both protocol revisions", () => {
  test("list the same tools in the same order", async () => {
    const legacy = await connect(reader, "2025-11-25");
    const modern = await connect(reader, "2026-07-28");

    expect(legacy.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    expect(modern.getNegotiatedProtocolVersion()).toBe("2026-07-28");

    const legacyTools = (await legacy.listTools()).tools;
    const modernTools = (await modern.listTools()).tools;

    expect(legacyTools.map((tool) => tool.name)).toStrictEqual(["notes", "timer"]);
    expect(modernTools).toStrictEqual(legacyTools);
  });

  test("carry the instructions", async () => {
    const legacy = await connect(reader, "2025-11-25");

    expect(legacy.getInstructions()).toBe("Test instructions.");
  });
});

describe("the listing", () => {
  test("states every annotation, openWorldHint false", async () => {
    const client = await connect(reader, "2025-11-25");
    const [listed, shown] = (await client.listTools()).tools;

    expect(listed?.annotations).toStrictEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    expect(shown?.annotations).toStrictEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test("writes named parts once under $defs and leaves bounds to the checks", async () => {
    const client = await connect(reader, "2025-11-25");
    const [listed] = (await client.listTools()).tools;
    const schema = JSON.stringify(listed?.inputSchema);

    expect(listed?.inputSchema.$defs).toHaveProperty("NoteTitle");
    expect(schema).not.toContain("minLength");
    expect(schema).toContain("A note's title, as written.");
    expect(listed?.inputSchema.properties).toHaveProperty("cursor");
  });
});

describe.each(["2025-11-25", "2026-07-28"] as const)("a call under %s", (revision) => {
  test("a read-only token is refused a write, and told how to get it", async () => {
    const client = await connect(reader, revision);
    const refused = await call(client, { action: "add", title: "Groceries" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("allowed to read only");
    expect(refused.text).toContain("Read and write");
  });

  test("a read and write token writes", async () => {
    const client = await connect(writer, revision);

    expect(await call(client, { action: "add", title: "Groceries" })).toStrictEqual({
      text: "Added Groceries.",
      isError: false,
    });
  });

  test("a read-only token reads", async () => {
    const client = await connect(reader, revision);

    expect(await call(client, { action: "list" })).toStrictEqual({
      text: "Groceries\nRent",
      isError: false,
    });
  });
});

describe("errors", () => {
  test("wrong arguments say what is wrong, with a valid call", async () => {
    const client = await connect(writer, "2025-11-25");
    const wrong = await call(client, { action: "add", title: "" });

    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("The arguments of notes are not valid");
    expect(wrong.text).toContain('A valid call: notes {"action":"add","title":"Groceries"}');
    expect(wrong.text.length).toBeLessThan(ERROR_LIMIT);
  });

  test("an unknown action is refused with a valid call", async () => {
    const client = await connect(writer, "2025-11-25");
    const wrong = await call(client, { action: "delete" });

    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("A valid call:");
  });

  test("a refusal keeps the tool's own words and example", async () => {
    const client = await connect(reader, "2025-11-25");
    const refused = await call(client, { action: "refuse", title: "Taxes" });

    expect(refused).toStrictEqual({
      text: 'No note is called Taxes.\nA valid call: notes {"action":"list"}',
      isError: true,
    });
  });

  test("a failure carries no trace nor detail", async () => {
    const client = await connect(reader, "2025-11-25");
    const failed = await call(client, { action: "break" });

    expect(failed.isError).toBe(true);
    expect(failed.text).toContain("an error on its side");
    expect(failed.text).not.toContain("/srv/secret/path");
    expect(failed.text).not.toContain("at ");
  });
});

describe("a long result", () => {
  test("is paged, each part under the limit, with the next call written in full", async () => {
    const client = await connect(reader, "2025-11-25");
    const parts: Array<string> = [];
    let next: { [key: string]: string } | undefined = { action: "long" };

    while (next !== undefined) {
      const { text, isError } = await call(client, next);

      expect(isError).toBe(false);
      expect(text.length).toBeLessThanOrEqual(RESULT_LIMIT);
      parts.push(text);

      const written = /Read on with: notes (\{.*\})\)$/.exec(text)?.[1];

      next =
        written === undefined
          ? undefined
          : Schema.decodeUnknownSync(
              Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
            )(written);
    }

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.at(-1)).toContain("the last.");
    expect(parts.join("\n")).toContain("Line 1999:");
  });

  test("a cursor past the end is refused, saying how to start again", async () => {
    const client = await connect(reader, "2025-11-25");
    const wrong = await call(client, { action: "long", cursor: "99" });

    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("without a cursor");
  });
});

describe("telemetry", () => {
  test("observes the tool, the action and the outcome, never an argument nor a result", async () => {
    const seen: Array<{ tool: string; action: string; outcome: CallOutcome }> = [];

    const observe: CallObserver = (call, run) =>
      run((action, outcome) => {
        seen.push({ tool: call.tool, action, outcome });
      });

    const client = await connect(reader, "2025-11-25", observe);

    await call(client, { action: "list" });
    await call(client, { action: "add", title: "Groceries" });
    await call(client, { action: "refuse", title: "Taxes" });
    await call(client, { action: "break" });
    await call(client, { action: "nope" });

    expect(seen).toStrictEqual([
      { tool: "notes", action: "list", outcome: "ok" },
      { tool: "notes", action: "add", outcome: "forbidden" },
      { tool: "notes", action: "refuse", outcome: "refused" },
      { tool: "notes", action: "break", outcome: "failed" },
      { tool: "notes", action: "unknown", outcome: "invalid" },
    ]);
  });
});
