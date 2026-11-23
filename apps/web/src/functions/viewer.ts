import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { monthOfDay } from "@/lib/month";
import { E2E_DAY_COOKIE, localDay, today } from "@/lib/today";
import { auth } from "@/services";

import { ColorSchemeChoice } from "./color-scheme";

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
            // One of the three, whatever the column holds: it goes into the page's inline script.
            colorScheme: Schema.is(ColorSchemeChoice)(user.colorScheme)
              ? user.colorScheme
              : "system",
            isAdmin: user.role === "admin",
            mustChangePassword: user.mustChangePassword === true,
            // The day the password was reset, on the server's calendar: the same text on the
            // server and in the browser, whatever their time zones.
            passwordResetOn: user.passwordResetAt ? localDay(user.passwordResetAt) : null,
            // By the administrator, or from the server when the administrator's was recovered.
            passwordResetFromServer: user.passwordResetBy === "server",
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
