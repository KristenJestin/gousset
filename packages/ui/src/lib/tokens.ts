// The theme's own tokens, as `globals.css` declares them in its `:root { … }` block: the token
// story lists them all, and its browser test checks that none is missing from the page.

export type ThemeToken = { readonly name: string; readonly value: string };

const ROOT_BLOCK = /^:root \{$([\s\S]*?)^\}$/m;
const DECLARATION = /^\s*(--[a-z0-9-]+):\s*([^;]+);/gm;

/** Every custom property of the theme's `:root` block, in the order it declares them. */
export function themeTokens(css: string): ReadonlyArray<ThemeToken> {
  const block = ROOT_BLOCK.exec(css)?.[1];

  if (block === undefined) {
    throw new Error("globals.css has no `:root {` block");
  }

  return [...block.matchAll(DECLARATION)].flatMap(([, name, value]) =>
    name === undefined || value === undefined ? [] : [{ name, value: value.trim() }],
  );
}
