import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Toaster } from "@gousset/ui/components/toaster-stand-in";
import { ThemeProvider } from "@gousset/ui/components/theme-provider";

import { getViewer } from "@/functions/viewer";

import appCss from "../index.css?url";

/** What every route's loader may use: the request's query client. */
type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every navigation asks the server who is looking: the guards of the routes below read it.
  beforeLoad: async () => ({ viewer: await getViewer() }),
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

  return (
    // The saved colour scheme lands on <html> before hydration (ThemeProvider).
    <html lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <Outlet />
          <Toaster />
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
