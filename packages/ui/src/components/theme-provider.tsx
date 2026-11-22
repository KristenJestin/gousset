import { Preferences } from "@ui-sdk/react/preferences";
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { colorScheme, followDarkClass } from "@gousset/ui/lib/color-scheme";

/**
 * The theme around the whole app, at the top of `<body>`: the colour scheme on `<html>` (before
 * the first paint, from the saved choice), `.dark` kept in step with it, and Motion cut entirely
 * when the system asks for reduced motion. `<html>` needs `suppressHydrationWarning`, since the
 * saved choice lands on it before hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  useEffect(() => followDarkClass(document.documentElement), []);

  return (
    <Preferences preferences={[colorScheme]}>
      <MotionConfig reducedMotion="user" skipAnimations={reducedMotion === true}>
        {children}
      </MotionConfig>
    </Preferences>
  );
}
