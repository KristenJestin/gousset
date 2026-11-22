import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";

import { ENV } from "./env.server";
import { createNonce, securityHeaders } from "./security";

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
    // Server functions only: a page may be opened from a link on another site, and better-auth
    // checks the origin of its own requests.
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    securityMiddleware,
  ],
}));
