import { Preferences } from "@ui-sdk/react/preferences";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { usePrefersReducedMotion } from "@gousset/ui/hooks/use-prefers-reduced-motion";
import { colorScheme, followDarkClass } from "@gousset/ui/lib/color-scheme";

/**
 * The theme around the whole app, at the top of `<body>`: the colour scheme on `<html>` (before
 * the first paint, from the saved choice), `.dark` kept in step with it, and Motion cut entirely
 * when the system asks for reduced motion, from the moment it asks. `<html>` needs `suppressHydrationWarning`, since the
 * saved choice lands on it before hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => followDarkClass(document.documentElement), []);

  return (
    <Preferences preferences={[colorScheme]}>
      <MotionConfig
        reducedMotion={reducedMotion ? "always" : "never"}
        skipAnimations={reducedMotion}
      >
        {children}
      </MotionConfig>
    </Preferences>
  );
}
