import { useEffect, useRef, useState } from "react";

/** How long a loading state waits before it shows: a fast answer shows nothing. */
export const SHOW_AFTER_MS = 300;

/** Once shown, how long it stays at least: it never flashes. */
export const SHOW_AT_LEAST_MS = 500;

/**
 * Follows `active` without flashing (docs/design.md, "Loading"): true only once `active` has
 * lasted `SHOW_AFTER_MS`, then kept true for at least `SHOW_AT_LEAST_MS` even if `active` ends
 * sooner.
 */
export function useUnhurried(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active && !shown) {
      const timer = setTimeout(() => {
        shownAt.current = performance.now();
        setShown(true);
      }, SHOW_AFTER_MS);

      return () => clearTimeout(timer);
    }

    if (!active && shown) {
      const left = SHOW_AT_LEAST_MS - (performance.now() - shownAt.current);
      const timer = setTimeout(() => setShown(false), Math.max(0, left));

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [active, shown]);

  return shown;
}
