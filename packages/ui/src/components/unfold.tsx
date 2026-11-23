import { motion } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { transition } from "../lib/motion";
import { cn } from "../lib/utils";

/**
 * Content that unfolds where it appears: its height grows from nothing and it fades in, in
 * 250 ms (ease-out); cut under reduced motion, where it simply appears. Content the server
 * rendered (a first visit) is shown as it is: during hydration it reads `false`, and its markup
 * carries no `style` attribute, which the Content Security Policy forbids. It clips its content
 * only while it unfolds, so a focus ring inside is never cut afterwards.
 */
export function Unfold({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const [unfolds] = useState(hydrated);
  const [settled, setSettled] = useState(false);

  if (!unfolds) {
    return <div data-slot="unfold">{children}</div>;
  }

  return (
    <motion.div
      data-slot="unfold"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={transition.unfold}
      onAnimationComplete={() => setSettled(true)}
      className={cn(!settled && "overflow-hidden")}
    >
      {children}
    </motion.div>
  );
}
