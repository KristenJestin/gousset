import { createColorScheme, createLocalStorage } from "@ui-sdk/core";

/**
 * The colour scheme: "system" by default, "light" or "dark" by choice. ui-sdk keeps the choice
 * and puts it on `<html data-color-scheme>`, which `globals.css` maps to `color-scheme`; the
 * choice is saved in this browser and applied before the first paint.
 */
export const colorScheme = createColorScheme({
  storage: createLocalStorage("gousset-color-scheme"),
  global: true,
});

/**
 * Keeps `.dark` on `root` while the scheme shows dark, so code that looks for the class (Bklit's
 * convention) follows the same choice. Returns the function that stops it.
 */
export function followDarkClass(root: HTMLElement): () => void {
  const apply = () => {
    root.classList.toggle("dark", colorScheme.get().resolved === "dark");
  };

  apply();

  return colorScheme.subscribe(apply);
}
