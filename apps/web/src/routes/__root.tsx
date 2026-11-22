import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@gousset/ui/components/theme-provider";

import { getViewer } from "@/functions/viewer";

import appCss from "../index.css?url";

export const Route = createRootRoute({
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
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
