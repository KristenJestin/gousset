import {
  approveLine as approveCoreLine,
  currentMonth,
  linesToReview,
  monthSummary,
  spending,
} from "@gousset/core";
import { Month, SpendingGroup } from "@gousset/core/values";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { devLatency } from "@/lib/dev-latency";
import { auth, runCore } from "@/services";

/** Only a signed-in user reads data, and only their own: the session says whose. */
export const signedIn = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });

  if (!session) {
    throw new Error("Sign in to read your data.");
  }

  return next({ context: { owner: session.user.id } });
});

/** In development, the latency `GOUSSET_DEV_LATENCY_MS` asks for (`@/lib/dev-latency`). */
export const slowedInDevelopment = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    await Effect.runPromise(devLatency);

    return next();
  },
);

const MonthInput = Schema.toStandardSchemaV1(Schema.Struct({ month: Month }));

/** Today's month, as the server sees it: the month a page opens on when none is asked for. */
export const getCurrentMonth = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(() => runCore(currentMonth));

/** The month in one bar: received, spent, set aside, left. */
export const getMonthSummary = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(MonthInput)
  .handler(({ data, context }) => runCore(monthSummary(context.owner, data.month)));

/** Where the month's money went, by category or by merchant. */
export const getSpending = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ month: Month, by: SpendingGroup })))
  .handler(({ data, context }) => runCore(spending(context.owner, data.month, data.by)));

/** The month's lines waiting in the review. */
export const getLinesToReview = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(MonthInput)
  .handler(({ data, context }) => runCore(linesToReview(context.owner, data.month)));

/**
 * Approves what the rules proposed for a line. A refusal comes back as a code for the interface
 * to translate: the line was reviewed elsewhere meanwhile, or it does not exist.
 */
export const approveLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: Schema.String })))
  .handler(({ data, context }) =>
    runCore(
      approveCoreLine(context.owner, data.lineId).pipe(
        Effect.map(() => ({ approved: true as const })),
        Effect.catchTags({
          LineAlreadyReviewed: () =>
            Effect.succeed({ approved: false as const, code: "LINE_ALREADY_REVIEWED" }),
          LineNotFound: () => Effect.succeed({ approved: false as const, code: "LINE_NOT_FOUND" }),
        }),
      ),
    ),
  );
