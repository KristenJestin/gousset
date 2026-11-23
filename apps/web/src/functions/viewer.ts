import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { monthOfDay } from "@/lib/month";
import { E2E_DAY_COOKIE, today } from "@/lib/today";
import { auth } from "@/services";

/**
 * Who is looking, whether the installation has its administrator yet, and, signed in, the current
 * month on the server's clock: the one a month's screen shows when its address names none.
 */
export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      const session = yield* Effect.promise(() =>
        auth.api.getSession({ headers: getRequestHeaders() }),
      );

      if (session) {
        const { user } = session;
        const day = yield* today(getCookie(E2E_DAY_COOKIE));

        return {
          hasUsers: true,
          currentMonth: monthOfDay(day),
          user: {
            name: user.name,
            email: user.email,
            isAdmin: user.role === "admin",
            mustChangePassword: user.mustChangePassword === true,
            singleKeyShortcuts: user.singleKeyShortcuts !== false,
          },
        };
      }

      const context = yield* Effect.promise(() => auth.$context);
      const users = yield* Effect.promise(() => context.adapter.count({ model: "user" }));

      return { hasUsers: users > 0, user: null };
    }),
  ),
);

export type Viewer = Awaited<ReturnType<typeof getViewer>>;
