import { Currency } from "@gousset/core/account-values";
import { CURRENCY_CODES } from "@gousset/ui/lib/money";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { auth } from "@/services";

import { signedIn } from "./mcp";

/** One of the ISO 4217 codes an account's currency is chosen from (`@gousset/currency`). */
export const UserCurrency = Currency.check(
  Schema.makeFilter((code: string) => CURRENCY_CODES.includes(code), {
    message: "A currency is one of the ISO 4217 codes Gousset knows, as EUR.",
  }),
);

/**
 * Keeps the signed-in user's currency on their account: the one their fixed benchmarks are written
 * in. The next page they open reads it back (`getViewer`).
 */
export const setUserCurrency = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ currency: UserCurrency })))
  .handler(({ context, data }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authContext = yield* Effect.promise(() => auth.$context);

        yield* Effect.promise(() =>
          authContext.internalAdapter.updateUser(context.userId, { currency: data.currency }),
        );
      }),
    ),
  );
