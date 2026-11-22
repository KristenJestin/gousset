import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@gousset/ui/components/theme-provider";

import appCss from "../index.css?url";

export const Route = createRootRoute({
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
  return (
    // The saved colour scheme lands on <html> before hydration (ThemeProvider).
    <html lang="en" suppressHydrationWarning>
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
