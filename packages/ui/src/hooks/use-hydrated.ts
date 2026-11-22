import { useSyncExternalStore } from "react";

const noSubscription = () => () => undefined;

/**
 * False on the server and while the page hydrates, true afterwards (and from the start in a page
 * drawn in the browser alone). A part whose markup would carry a `style` attribute (forbidden by
 * the Content Security Policy, and never fixed by hydration) waits for it.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
