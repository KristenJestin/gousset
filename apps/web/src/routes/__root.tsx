import type { QueryClient } from "@tanstack/react-query";
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Toaster } from "@gousset/ui/components/toaster";
import { ThemeProvider } from "@gousset/ui/components/theme-provider";
import { THEME_COLORS, themeColorMetas } from "@gousset/ui/lib/theme-color";

import { getViewer } from "@/functions/viewer";

import appCss from "../index.css?url";
import { Shortcuts } from "../shortcuts";

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
  head: ({ match }) => {
    const chosen = match.context.viewer.user?.colorScheme;

    return {
      meta: [
        {
          // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- HTML names it "utf-8".
          charSet: "utf-8",
        },
        {
          // The page reaches the screen's edges, under an installed app's home indicator: what
          // runs along an edge keeps clear of it (`pb-safe` and the like, globals.css).
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        {
          title: m.appName(),
        },
        // The browser's bars take the page's background: the system's scheme's, or the scheme
        // the account keeps from the first paint (`followThemeColor` keeps them in step after).
        ...themeColorMetas().map((meta) =>
          chosen === undefined || chosen === "system"
            ? meta
            : { ...meta, content: THEME_COLORS[chosen] },
        ),
        // Installed on a phone's home screen (the manifest, below): its own window and its name.
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: m.appName() },
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
    };
  },

  component: RootDocument,
});

function RootDocument() {
  // The response's CSP nonce: the request's on the server, read back from the page in the browser.
  const nonce = useRouter().options.ssr?.nonce;
  const { viewer } = Route.useRouteContext();

  return (
    // The saved colour scheme, the account's once signed in, lands on <html> before hydration
    // (ThemeProvider). The language is
    // the request's on the server (src/server.ts), the same cookie or browser's in the page.
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          nonce={nonce}
          accountScheme={viewer.user?.colorScheme}
          accountOwner={viewer.user?.email}
        >
          <Shortcuts singleKeyShortcuts={viewer.user?.singleKeyShortcuts ?? true}>
            <Outlet />
          </Shortcuts>
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
