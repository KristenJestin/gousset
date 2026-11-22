import { HotkeysProvider } from "@tanstack/react-hotkeys";
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { ThemeProvider } from "@gousset/ui/components/theme-provider";

import { getViewer } from "@/functions/viewer";

import appCss from "../index.css?url";
import { Shortcuts, appHotkeys } from "../shortcuts";

// Development only: a production build reads `false` here and drops the import, devtools and all.
const Devtools = import.meta.env.DEV ? lazy(async () => import("../devtools")) : null;

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
        title: m.appName(),
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // The brand (brand/README.md): the tab, the iOS home screen and the installed app.
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  // The response's CSP nonce: the request's on the server, read back from the page in the browser.
  const nonce = useRouter().options.ssr?.nonce;

  return (
    // The saved colour scheme lands on <html> before hydration (ThemeProvider). The language is
    // the request's on the server (src/server.ts), the same cookie or browser's in the page.
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider nonce={nonce}>
          <HotkeysProvider appHotkeys={appHotkeys}>
            <Outlet />
            <Shortcuts />
          </HotkeysProvider>
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
