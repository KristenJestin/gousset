import { TanStackDevtools } from "@tanstack/react-devtools";
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools";
import { pacerDevtoolsPlugin } from "@tanstack/react-pacer-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { m } from "@gousset/i18n/messages";

import { JobsPanel } from "./components/jobs-panel";

/**
 * TanStack's devtools, one panel for each library, and Gousset's own for its background jobs.
 * Loaded only in development: the root imports this module behind `import.meta.env.DEV`, so the
 * production bundle holds none of it. Query's panel reads the app's QueryClient from its provider,
 * set up with the router (`router.tsx`).
 */
export default function Devtools() {
  return (
    <TanStackDevtools
      plugins={[
        { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
        pacerDevtoolsPlugin(),
        hotkeysDevtoolsPlugin(),
        { name: m.jobsPanelTitle(), render: <JobsPanel /> },
      ]}
    />
  );
}
