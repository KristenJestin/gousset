import { useSyncExternalStore } from "react";

// Tailwind's `lg`: from there a list has room for a panel beside it.
const LARGE = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(LARGE);

  media.addEventListener("change", onChange);

  return () => media.removeEventListener("change", onChange);
}

/**
 * Whether the screen is at least Tailwind's `lg` wide (1024 px), following a change; a large
 * screen on the server and while the page hydrates, then the browser's own answer.
 */
export function useLargeScreen() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(LARGE).matches,
    () => true,
  );
}
