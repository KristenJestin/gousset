import type { QueryClient } from "@tanstack/react-query";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Toaster } from "@gousset/ui/components/toaster-stand-in";
import { ThemeProvider } from "@gousset/ui/components/theme-provider";

import { getViewer } from "@/functions/viewer";

import appCss from "../index.css?url";
import { Shortcuts, appHotkeys } from "../shortcuts";

// Development only: a production build reads `false` here and drops the import, devtools and all.
const Devtools = import.meta.env.DEV ? lazy(async () => import("../devtools")) : null;

/** What every route's loader may use: the request's query client. */
type RouterContext = { queryClient: QueryClient };

/** Whose data each query client holds: the e-mail of the user it was filled for. */
const ownerOf = new WeakMap<QueryClient, string | null>();

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every navigation asks the server who is looking: the guards of the routes below read it.
  beforeLoad: async ({ context: { queryClient } }) => {
    const viewer = await getViewer();
    const owner = viewer.user?.email ?? null;

    // Signing out, or in as someone else, without a reload: nothing cached for the previous user
    // may show to the next one.
    if (ownerOf.has(queryClient) && ownerOf.get(queryClient) !== owner) {
      queryClient.clear();
    }

    ownerOf.set(queryClient, owner);

    return { viewer };
  },
  head: () => ({
    meta: [
      {
        // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML names it "utf-8".
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Gousset",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  const locale = Route.useRouteContext({ select: (context) => context.viewer.locale });
  // The response's CSP nonce: the request's on the server, read back from the page in the browser.
  const nonce = useRouter().options.ssr?.nonce;

  return (
    // The saved colour scheme lands on <html> before hydration (ThemeProvider).
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider nonce={nonce}>
          <HotkeysProvider appHotkeys={appHotkeys}>
            <Outlet />
            <Shortcuts />
          </HotkeysProvider>
          <Toaster />
        </ThemeProvider>
        {Devtools === null ? null : (
          <ClientOnly>
            <Suspense>
              <Devtools />
            </Suspense>
          </ClientOnly>
        )}
        <Scripts />
      </body>
    </html>
  );
}
