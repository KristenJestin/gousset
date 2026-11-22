import { TanStackDevtools } from "@tanstack/react-devtools";
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools";
import { pacerDevtoolsPlugin } from "@tanstack/react-pacer-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

/**
 * TanStack's devtools, one panel for each library. Loaded only in development: the root imports
 * this module behind `import.meta.env.DEV`, so the production bundle holds none of it.
 *
 * Every panel is listed here. Query's (`ReactQueryDevtoolsPanel`, already a dependency) joins the
 * list with the app's QueryClient (issue #9): it needs one to show.
 */
export default function Devtools() {
  return (
    <TanStackDevtools
      plugins={[
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
        pacerDevtoolsPlugin(),
        hotkeysDevtoolsPlugin(),
      ]}
    />
  );
}
