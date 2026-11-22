import { Preferences } from "@ui-sdk/react/preferences";
import { useEffect, useLayoutEffect } from "react";
import type { ReactNode } from "react";

import { colorScheme, followDarkClass } from "@gousset/ui/lib/color-scheme";
import { followReducedMotion } from "@gousset/ui/lib/reduced-motion";

/**
 * The theme around the whole app, at the top of `<body>`: the colour scheme on `<html>` (before
 * the first paint, from the saved choice), `.dark` kept in step with it, and every Motion
 * animation skipped while the system asks for reduced motion. `<html>` needs
 * `suppressHydrationWarning`, since the saved choice lands on it before hydration.
 *
 * Reduced motion is set in a layout effect: on a hydrated page it runs before any element's
 * entry animation (those start in passive effects), so the first render is already right.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => followReducedMotion(document.documentElement), []);
  useEffect(() => followDarkClass(document.documentElement), []);

  return <Preferences preferences={[colorScheme]}>{children}</Preferences>;
}
