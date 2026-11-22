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
 * `nonce` is the response's Content Security Policy nonce, which the inline script that applies
 * the saved choice must carry.
 *
 * Reduced motion is set in a layout effect: on a hydrated page it runs before any element's
 * entry animation (those start in passive effects), so the first render is already right.
 */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  useLayoutEffect(() => followReducedMotion(document.documentElement), []);
  useEffect(() => followDarkClass(document.documentElement), []);

  return (
    <Preferences
      preferences={[colorScheme]}
      nonce={nonce}
      // Preferences writes `display: contents` as a style attribute, which the Content Security
      // Policy blocks in the server's HTML (a nonce cannot cover an attribute): a class says it.
      className="contents"
      // oxlint-disable-next-line shadcn/no-inline-styles -- removes Preferences' own inline style, sets none.
      style={{ display: undefined }}
    >
      {children}
    </Preferences>
  );
}
