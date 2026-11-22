import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Effect, Option } from "effect";

import { E2E_DAY_COOKIE, e2eClock, today } from "./today";

/**
 * Today as the server sees it, for the harness's probe page (`/e2e/today`); `null` when the
 * harness did not start the app, so that the page does not exist in an installation.
 */
export const e2eServerToday = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      if (Option.isNone(yield* e2eClock)) {
        return null;
      }

      return yield* today(getCookie(E2E_DAY_COOKIE));
    }),
  ),
);
