import { fromPromise, requestSpan, serverFunctionSpan, underActiveSpan } from "@gousset/telemetry";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";

import { ENV } from "./env.server";
import { createNonce, securityHeaders } from "./security";
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

/** Security headers on every response, and the nonce the page's scripts and styles carry. */
const securityMiddleware = createMiddleware().server(({ next }) => {
  const nonce = createNonce();

  setResponseHeaders(
    securityHeaders({
      nonce,
      strict: import.meta.env.PROD,
      https: ENV.BETTER_AUTH_URL.startsWith("https://"),
    }),
  );

  return next({ context: { nonce } });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // First, so that the request's span covers the others, refusals included.
    traceRequest,
    // Server functions only: a page may be opened from a link on another site, and better-auth
    // checks the origin of its own requests.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    securityMiddleware,
  ],
  functionMiddleware: [traceServerFunction],
}));
