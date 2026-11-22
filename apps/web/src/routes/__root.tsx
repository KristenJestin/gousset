import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { ClientOnly, HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import appCss from "../index.css?url";
import { Shortcuts, appHotkeys } from "../shortcuts";

// Development only: a production build reads `false` here and drops the import, devtools and all.
const Devtools = import.meta.env.DEV ? lazy(async () => import("../devtools")) : null;

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
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <HotkeysProvider appHotkeys={appHotkeys}>
          <Outlet />
          <Shortcuts />
        </HotkeysProvider>
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
