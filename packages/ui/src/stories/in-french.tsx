import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Sets `<html lang="fr">` while its story shows, as the app does for a French reader, and puts
 * the page's language back after: the ui's texts and the amounts' formats follow it.
 */
export function InFrench({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;

    root.lang = "fr";

    return () => {
      root.lang = before;
    };
  }, []);

  return children;
}
