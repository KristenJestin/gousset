import { fromPromise, requestSpan, serverFunctionSpan, underActiveSpan } from "@gousset/telemetry";
import { createMiddleware, createStart } from "@tanstack/react-start";

import { telemetry } from "./telemetry.server";

/** A span for every request to the server: pages, server routes and server functions alike. */
const traceRequest = createMiddleware().server(async ({ request, handlerType, next }) =>
  telemetry.runPromise(
    underActiveSpan(
      fromPromise(async () => next()).pipe(
        requestSpan({ method: request.method, handler: handlerType }),
      ),
    ),
  ),
);

/** A span for every server function, under its request's span. */
const traceServerFunction = createMiddleware({ type: "function" }).server(
  async ({ serverFnMeta, next }) =>
    telemetry.runPromise(
      underActiveSpan(fromPromise(async () => next()).pipe(serverFunctionSpan(serverFnMeta.name))),
    ),
);

export const startInstance = createStart(() => ({
  requestMiddleware: [traceRequest],
  functionMiddleware: [traceServerFunction],
}));
