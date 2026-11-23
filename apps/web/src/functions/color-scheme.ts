import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { auth } from "@/services";

import { signedIn } from "./mcp";

/** The colour schemes a user can keep on their account. */
export const ColorSchemeChoice = Schema.Literals(["system", "light", "dark"]);

export type ColorSchemeChoice = typeof ColorSchemeChoice.Type;

/**
 * Keeps the signed-in user's colour scheme on their account: the next page they open, on any
 * browser, reads it back (`getViewer`) and paints in it from the start.
 */
export const setColorScheme = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ scheme: ColorSchemeChoice })))
  .handler(({ context, data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authContext = yield* Effect.promise(() => auth.$context);

        yield* Effect.promise(() =>
          authContext.internalAdapter.updateUser(context.userId, { colorScheme: data.scheme }),
        );
      }),
    ),
  );
