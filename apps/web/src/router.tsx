import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";

import { routeTree } from "./routeTree.gen";

/**
 * The response's Content Security Policy nonce. The router puts it on its scripts and writes it
 * in `<meta property="csp-nonce">`, where ui-sdk reads it and the router reads it back in the
 * browser.
 */
const getNonce = createIsomorphicFn()
  .server(() => getGlobalStartContext()?.nonce)
  .client(() => undefined);

export const getRouter = () => {
  const router = createTanStackRouter({
    routeTree,
    ssr: { nonce: getNonce() },
    scrollRestoration: true,
    // Load before the click: a link preloads its route on hover or focus.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: () => <div>Not Found</div>,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
