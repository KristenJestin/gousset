import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { pickLocale } from "@/i18n/messages";
import { auth } from "@/services";

/** Who is looking, in which language, and whether the installation has its administrator yet. */
export const getViewer = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      const locale = pickLocale(getRequestHeader("accept-language"));

      const session = yield* Effect.promise(() =>
        auth.api.getSession({ headers: getRequestHeaders() }),
      );

      if (session) {
        const { user } = session;

        return {
          locale,
          hasUsers: true,
          user: {
            name: user.name,
            email: user.email,
            isAdmin: user.role === "admin",
            mustChangePassword: user.mustChangePassword === true,
          },
        };
      }

      const context = yield* Effect.promise(() => auth.$context);
      const users = yield* Effect.promise(() => context.adapter.count({ model: "user" }));

      return { locale, hasUsers: users > 0, user: null };
    }),
  ),
);

export type Viewer = Awaited<ReturnType<typeof getViewer>>;
