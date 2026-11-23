import { motion } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { transition } from "../lib/motion";

/**
 * Its clip, folded: nothing shows, the bottom edge pulled up past the top. Unfolded: the edges
 * stand half the element's size outside it, so that nothing inside is ever cut (a focus ring at
 * its edge). Both in the same units, so that Motion moves between them.
 */
const FOLDED = "inset(-50% -50% 150% -50%)";
const UNFOLDED = "inset(-50% -50% -50% -50%)";

/**
 * Content that unfolds where it appears: it is revealed from its top edge down and fades in, in
 * 250 ms (ease-out); cut under reduced motion, where it simply appears. Its place on the page is
 * taken at once: the clip moves, never its height, so nothing is laid out again on each frame.
 * Content the server rendered (a first visit) is shown as it is: during hydration it reads
 * `false`, and its markup carries no `style` attribute, which the Content Security Policy forbids.
 */
export function Unfold({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const [unfolds] = useState(hydrated);

  if (!unfolds) {
    return <div data-slot="unfold">{children}</div>;
  }

  return (
    <motion.div
      data-slot="unfold"
      initial={{ clipPath: FOLDED, opacity: 0 }}
      animate={{ clipPath: UNFOLDED, opacity: 1 }}
      transition={transition.unfold}
    >
      {children}
    </motion.div>
  );
}
