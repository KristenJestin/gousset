import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { Cause, Data, Effect, Exit, Option, Schema } from "effect";

import { listedInputSchema } from "./listing";
import { errorText, pageOf } from "./results";

/** What an action does to the user's data: a write needs the write scope. */
export type Access = "read" | "write";

/** Who calls, as the door verified it from their token. */
export type Caller = {
  readonly userId: string;
  /** The token was granted the write scope on the consent page. */
  readonly canWrite: boolean;
  /**
   * The grant (the user's consent to the client) the token came with: a file upload belongs to
   * it (#129). The door always gives it; a test of a tool that makes none may leave it out.
   */
  readonly grantId?: string;
  /** The app's own address (`https://gousset.example.com`), which a file upload's starts with. */
  readonly origin?: string;
};

/**
 * A refusal a tool answers with: what is wrong and what to do instead. `example` is a valid call
 * when the fix is a different argument.
 */
export class ToolRefusal extends Data.TaggedError("ToolRefusal")<{
  readonly message: string;
  readonly example?: string;
}> {}

/** How a call ended, for its span: never its arguments nor its result (docs/mcp.md, rule 16). */
export type CallOutcome = "ok" | "refused" | "invalid" | "forbidden" | "failed";

/**
 * Observes one call: the tool, the action (once the arguments name a valid one) and how it ended.
 * The door gives it a span per call; tests give it a recorder.
 */
export type CallObserver = <A>(
  call: { readonly tool: string },
  run: (report: (action: string, outcome: CallOutcome) => void) => Promise<A>,
) => Promise<A>;

export const unobserved: CallObserver = (_call, run) => run(() => undefined);

/**
 * Runs a tool's effect with the services it needs (`R`): the app's runtime, the same one its
 * server functions use, so that both read the same store.
 */
export type Runner<R> = <A, E>(effect: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E>>;

/** Runs an effect that needs no service. */
export const runAlone: Runner<never> = (effect) => Effect.runPromiseExit(effect);

/**
 * A family tool (docs/mcp.md, "Tools"): one concept, its actions behind `action`.
 *
 * - `description` says what it does, when to use it rather than another tool, its effects and
 *   refusals, the important part first, with a valid call where an argument is easy to get wrong.
 * - `input` is an Effect `Schema.Struct` with an `action` field; fields named with an
 *   `identifier` annotation are listed once under `$defs`.
 * - `access` says, per action, whether it reads or writes: a write is refused to a token without
 *   the write scope, and the annotations follow from it.
 * - `run` calls the packages, no logic of its own, and answers text: names, not ids.
 */
export type ToolSpec<Input extends { readonly action: string }, Encoded, R> = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Repeating a call with the same arguments changes nothing more. */
  readonly idempotent: boolean;
  readonly input: Schema.Codec<Input, Encoded>;
  /** A valid call, written in the errors that come from wrong arguments. */
  readonly example: Encoded;
  readonly access: { readonly [A in Input["action"]]: Access };
  readonly run: (input: Input, caller: Caller) => Effect.Effect<string, ToolRefusal, R>;
};

/** A tool as the server lists and calls it, its input's types erased; `R`, the services it needs. */
export type Tool<R = never> = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
  readonly inputSchema: ReturnType<typeof listedInputSchema>;
  readonly register: (
    server: McpServer,
    caller: Caller,
    observe: CallObserver,
    run: Runner<R>,
  ) => void;
};

const WRITE_REFUSED =
  "This action writes to your Gousset data, and this connection was allowed to read only. To allow writes, disconnect Gousset in your MCP client (or revoke the client in Gousset, Settings, Connected clients), connect again, and choose Read and write on Gousset's consent page.";

const FAILED =
  "Gousset could not answer this call: an error on its side. Try again; if it keeps failing, tell the administrator of this Gousset installation.";

const Cursor = Schema.Struct({ cursor: Schema.optional(Schema.String) });

type CallResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (body: string): CallResult => ({ content: [{ type: "text", text: body }] });

const error = (body: string): CallResult => ({
  content: [{ type: "text", text: body }],
  isError: true,
});

export function defineTool<Input extends { readonly action: string }, Encoded, R = never>(
  spec: ToolSpec<Input, Encoded, R>,
): Tool<R> {
  const accesses: ReadonlyArray<Access> = Object.values(spec.access);
  const readOnly = accesses.every((access) => access === "read");
  const inputSchema = listedInputSchema(spec.input);
  const encode = Schema.encodeSync(spec.input);
  const callOf = (encoded: Encoded) => `${spec.name} ${JSON.stringify(encoded)}`;
  const example = callOf(spec.example);

  // The SDK gets the listed JSON Schema and a pass-through check: arguments are decoded below, so
  // that a wrong argument gets Gousset's own error, with a valid call.
  const sdkSchema: StandardSchemaWithJSON = {
    "~standard": {
      version: 1,
      vendor: "gousset",
      validate: (value) => ({ value }),
      jsonSchema: { input: () => inputSchema, output: () => inputSchema },
    },
  };

  const decode = Schema.decodeUnknownExit(spec.input);
  const cursorOf = Schema.decodeUnknownOption(Cursor);

  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: spec.idempotent,
      openWorldHint: false,
    },
    inputSchema,
    register: (server, caller, observe, run) => {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: sdkSchema,
          annotations: {
            readOnlyHint: readOnly,
            destructiveHint: !readOnly,
            idempotentHint: spec.idempotent,
            openWorldHint: false,
          },
        },
        (args) =>
          observe({ tool: spec.name }, async (report) => {
            const decoded = decode(args);

            if (Exit.isFailure(decoded)) {
              report("unknown", "invalid");

              const issue = Cause.squash(decoded.cause);

              return error(
                errorText(
                  `The arguments of ${spec.name} are not valid: ${issue instanceof Error ? issue.message : "they do not match its input schema"}.`,
                  example,
                ),
              );
            }

            const input = decoded.value;
            const action: Input["action"] = input.action;

            if (spec.access[action] === "write" && !caller.canWrite) {
              report(action, "forbidden");

              return error(errorText(WRITE_REFUSED, undefined));
            }

            const cursor = Option.flatMap(cursorOf(args), ({ cursor: given }) =>
              Option.fromUndefinedOr(given),
            );

            const answered = await run(spec.run(input, caller));

            if (Exit.isSuccess(answered)) {
              const page = pageOf(answered.value, Option.getOrUndefined(cursor), (next) =>
                callOf({ ...encode(input), cursor: next }),
              );

              if ("outOfRange" in page) {
                report(action, "invalid");

                return error(
                  errorText(
                    `This cursor is past the end: the result has ${page.outOfRange} part(s). Make the call again without a cursor to start from the first.`,
                    example,
                  ),
                );
              }

              report(action, "ok");

              return text(page.text);
            }

            const refusal = Cause.findErrorOption(answered.cause);

            if (Option.isSome(refusal)) {
              report(action, "refused");

              return error(errorText(refusal.value.message, refusal.value.example));
            }

            report(action, "failed");

            return error(FAILED);
          }),
      );
    },
  };
}
