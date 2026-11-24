import { startingPoints } from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/** The user's counts on the screens that work today, which the review leads to until it ships. */
export const getStartingPoints = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(startingPoints(context.owner)));
