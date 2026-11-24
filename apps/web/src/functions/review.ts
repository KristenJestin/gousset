import { monthReview, spendingDays, startingPoints, subscriptionCalendar } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { Month } from "@/lib/month";
import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/** The user's counts on the screens that work today: whether they have a line at all. */
export const getStartingPoints = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(startingPoints(context.owner)));

/**
 * The month's review, every block at once (#32), in the user's currency, and its recurring
 * payments' calendar (#34): what the review's page draws on its first paint. A month to come is
 * refused; the page never asks for one.
 */
export const getMonthReview = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ month: Month })))
  .handler(({ data, context }) =>
    runCore(
      Effect.all(
        {
          review: monthReview(context.owner, data.month, context.currency),
          calendar: subscriptionCalendar(context.owner, data.month),
        },
        { concurrency: "unbounded" },
      ),
    ),
  );

/**
 * A row of "where the money goes", day by day against the month before, for its detail: a
 * category's id, a merchant's, or null for the merchants' row of none.
 */
export const getSpendingDays = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        month: Month,
        by: Schema.Literals(["category", "merchant"]),
        id: Schema.NullOr(Schema.String),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(spendingDays(context.owner, data.month, context.currency, data.by, data.id)),
  );
