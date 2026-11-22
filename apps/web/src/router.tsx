import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
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
  // One client per router, so per request on the server: a user's data never reaches another's
  // page.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The server rendered the page with its data: the browser does not ask for it again at
        // once, nor when the window comes back into focus within the minute.
        staleTime: 60_000,
        // An error shows in its block after one more try, not after several seconds.
        retry: 1,
      },
    },
  });

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    ssr: { nonce: getNonce() },
    scrollRestoration: true,
    // Load before the click: a link preloads its route on hover or focus.
    defaultPreload: "intent",
    // TanStack Query decides when data is fresh, not the router's own cache.
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: () => <div>Not Found</div>,
  });

  // The server's queries travel with the page and fill the browser's client before it renders.
  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
