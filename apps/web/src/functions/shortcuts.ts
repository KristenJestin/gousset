import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { auth } from "@/services";

import { signedIn } from "./mcp";

/**
 * Turns the signed-in user's single-key shortcuts on or off, kept on their account: the next page
 * they open, on any device, reads it back (`getViewer`).
 */
export const setSingleKeyShortcuts = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ on: Schema.Boolean })))
  .handler(({ context, data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authContext = yield* Effect.promise(() => auth.$context);

        yield* Effect.promise(() =>
          authContext.internalAdapter.updateUser(context.userId, { singleKeyShortcuts: data.on }),
        );
      }),
    ),
  );
