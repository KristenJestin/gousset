import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);

  media.addEventListener("change", onChange);

  return () => {
    media.removeEventListener("change", onChange);
  };
}

/**
 * Whether the system asks for reduced motion, following a change while the page is open. Motion's
 * own `useReducedMotion` reads it once, at mount. Motion on the server and before hydration: full.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
